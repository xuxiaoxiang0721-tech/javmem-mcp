// javmem's local store: one SQLite file per Bot (or per person), holding what was said in past conversations and what
// was inherited from other tools (javmem-inherit), with a full-text index. Chinese, Japanese and Korean text is
// indexed as pairs of neighbouring characters (游泳课 -> 游泳 泳课), so two-character words are found inside a sentence;
// other text by words. Needs node:sqlite (Node 22.5 or later) with FTS5, which Node ships.
// Writers (the DSH plugin's indexer, javmem-inherit, javmem-feed) open it read-write; local-mcp.js and javis-mcp.js
// (with JAVIS_BACKEND=graphiti) open it read-only. The episodes table records which stretches of which conversation
// went to a store that extracts facts (feed.js), under that store's own id, and episode_nodes which entities it
// found in each; spend counts the tokens used per day.
'use strict';

const fs = require('fs');
const path = require('path');

let sqlite = null;
function DatabaseSync() {
  if (!sqlite) {
    // node:sqlite prints an experimental warning once per process; the rest of that process's warnings stay as they are.
    const emit = process.emitWarning;
    process.emitWarning = (w, ...rest) => (String(w).includes('SQLite') ? undefined : emit.call(process, w, ...rest));
    try { sqlite = require('node:sqlite'); } finally { process.emitWarning = emit; }
  }
  return sqlite.DatabaseSync;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, title TEXT, origin TEXT NOT NULL, read_to INTEGER NOT NULL DEFAULT 0,
  first_time TEXT, last_time TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, session TEXT NOT NULL, seq INTEGER NOT NULL, role TEXT NOT NULL, time TEXT,
  text TEXT NOT NULL, origin TEXT NOT NULL, UNIQUE (session, seq));
CREATE INDEX IF NOT EXISTS messages_time ON messages (time);
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(grams, content='', tokenize='unicode61');
CREATE TABLE IF NOT EXISTS episodes (
  uuid TEXT PRIMARY KEY, backend TEXT NOT NULL, grp TEXT NOT NULL DEFAULT '', session TEXT NOT NULL,
  seq_from INTEGER NOT NULL, seq_to INTEGER NOT NULL, count INTEGER NOT NULL, chars INTEGER NOT NULL, first_time TEXT,
  name TEXT, source TEXT NOT NULL DEFAULT 'message', body TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
  tries INTEGER NOT NULL DEFAULT 0, sent_at TEXT, done_at TEXT, tier TEXT, tokens INTEGER, guid TEXT);
CREATE INDEX IF NOT EXISTS episodes_state ON episodes (backend, grp, state);
CREATE INDEX IF NOT EXISTS episodes_guid ON episodes (guid);
CREATE INDEX IF NOT EXISTS episodes_cover ON episodes (backend, grp, session, seq_from);
CREATE TABLE IF NOT EXISTS episode_nodes (node TEXT NOT NULL, episode TEXT NOT NULL, name TEXT, PRIMARY KEY (node, episode));
CREATE TABLE IF NOT EXISTS spend (
  day TEXT NOT NULL, backend TEXT NOT NULL, tokens INTEGER NOT NULL DEFAULT 0, segments INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, backend));
`;

// Scripts written without spaces between words.
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;
const WORD = /[\p{L}\p{N}]+/gu;

/** The index terms of a text: neighbouring pairs of CJK characters (a lone one stays itself), other words lower-cased. */
function grams(text) {
  const out = [];
  const s = String(text || '').normalize('NFKC').toLowerCase();
  let last = 0;
  for (const m of s.matchAll(CJK)) {
    for (const w of s.slice(last, m.index).match(WORD) || []) out.push(w);
    const run = [...m[0]];
    if (run.length === 1) out.push(run[0]);
    for (let i = 0; i + 1 < run.length; i += 1) out.push(run[i] + run[i + 1]);
    last = m.index + m[0].length;
  }
  for (const w of s.slice(last).match(WORD) || []) out.push(w);
  return out;
}

/**
 * An FTS5 query from a user's query. Keywords (the default): each space-separated term becomes a phrase of its grams,
 * and any (or, with all, every) term must match. loose: any single gram of the whole text matches, for a sentence
 * in natural language; the ranking puts the messages that share the most, and the rarest, first.
 */
function ftsQuery(query, all = false, loose = false) {
  if (loose) {
    const unique = [...new Set(grams(query))].slice(0, 96);
    return unique.length ? unique.map((g) => `"${g}"`).join(' OR ') : null;
  }
  const phrases = String(query || '').split(/\s+/).map((t) => grams(t)).filter((g) => g.length)
    .map((g) => `"${g.join(' ')}"`);
  return phrases.length ? phrases.join(all ? ' AND ' : ' OR ') : null;
}

const day = (t) => (typeof t === 'string' && t ? t.slice(0, 10) : '');

class LocalStore {
  /** file: the store's path; readonly: open without writing (a missing file is an error then). */
  constructor(file, { readonly = false } = {}) {
    this.file = file;
    this.readonly = readonly;
    if (!readonly) fs.mkdirSync(path.dirname(file), { recursive: true });
    const Db = DatabaseSync();
    this.db = readonly ? new Db(file, { readOnly: true }) : new Db(file);
    if (!readonly) {
      this.db.exec('PRAGMA journal_mode = WAL');
      this.db.exec(SCHEMA);
      try { fs.chmodSync(file, 0o600); } catch { /* not every system has modes */ }
    }
    this.db.exec('PRAGMA busy_timeout = 5000');
  }

  close() {
    try { this.db.close(); } catch { /* closed */ }
  }

  meta(key, value) {
    if (value === undefined) return this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value;
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
    return value;
  }

  /** How far a session has been read (events seen), 0 when it is new. */
  readTo(sessionId) {
    return this.db.prepare('SELECT read_to FROM sessions WHERE id = ?').get(sessionId)?.read_to || 0;
  }

  /**
   * Adds one session's new messages ({ seq, role, time, text }) and records how far it was read. A message already
   * there (same session and seq) is kept as it was. Returns how many were added.
   */
  add(session, messages, readTo) {
    let added = 0;
    const insert = this.db.prepare('INSERT OR IGNORE INTO messages (session, seq, role, time, text, origin) VALUES (?, ?, ?, ?, ?, ?)');
    const index = this.db.prepare('INSERT INTO messages_fts (rowid, grams) VALUES (?, ?)');
    this.db.exec('BEGIN');
    try {
      for (const m of messages) {
        const text = String(m.text || '').trim();
        if (!text) continue;
        const r = insert.run(session.id, m.seq, m.role, m.time || null, text, session.origin);
        if (r.changes) {
          index.run(r.lastInsertRowid, grams(text).join(' '));
          added += 1;
        }
      }
      const times = messages.map((m) => m.time).filter(Boolean).sort();
      this.db.prepare(`INSERT INTO sessions (id, title, origin, read_to, first_time, last_time, note) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title = COALESCE(excluded.title, title), read_to = MAX(read_to, excluded.read_to),
          first_time = COALESCE(MIN(first_time, excluded.first_time), first_time, excluded.first_time),
          last_time = COALESCE(MAX(last_time, excluded.last_time), last_time, excluded.last_time),
          note = COALESCE(excluded.note, note)`)
        .run(session.id, session.title || null, session.origin, readTo ?? 0, times[0] || null, times[times.length - 1] || null, session.note || null);
      this.meta('updated', new Date().toISOString());
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return added;
  }

  rows(sql, ...args) {
    return this.db.prepare(sql).all(...args);
  }

  /**
   * Ranked full-text search: { limit, all (every term must match), loose (any piece of a sentence), from, to (dates),
   * origin ('session' | 'inherited') }.
   */
  search(query, { limit = 8, all = false, loose = false, from, to, origin } = {}) {
    const q = ftsQuery(query, all, loose);
    if (!q) return [];
    const where = ['messages_fts MATCH ?'];
    const args = [q];
    if (from) { where.push('m.time >= ?'); args.push(from); }
    if (to) { where.push('m.time <= ?'); args.push(`${to}￿`); }
    if (origin === 'session') where.push("m.origin = 'session'");
    if (origin === 'inherited') where.push("m.origin LIKE 'inherited:%'");
    args.push(limit);
    return this.rows(`SELECT m.*, s.title, s.note, bm25(messages_fts) AS score FROM messages_fts
      JOIN messages m ON m.id = messages_fts.rowid JOIN sessions s ON s.id = m.session
      WHERE ${where.join(' AND ')} ORDER BY score, m.time DESC LIMIT ?`, ...args);
  }

  /** Messages holding the exact text (case-insensitive), newest first, or oldest first with byTime. */
  literal(text, { limit = 8, byTime = false } = {}) {
    const needle = String(text || '').trim().toLowerCase();
    if (!needle) return [];
    return this.rows(`SELECT m.*, s.title, s.note FROM messages m JOIN sessions s ON s.id = m.session
      WHERE instr(lower(m.text), ?) > 0 ORDER BY m.time ${byTime ? 'ASC' : 'DESC'} LIMIT ?`, needle, limit);
  }

  message(id) {
    return this.db.prepare('SELECT m.*, s.title, s.note FROM messages m JOIN sessions s ON s.id = m.session WHERE m.id = ?').get(id);
  }

  /** A stretch of one session: messages from `offset` (0-based, in seq order), at most `limit`. */
  page(sessionId, offset = 0, limit = 6) {
    const s = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!s) return null;
    const total = this.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE session = ?').get(sessionId).n;
    const messages = this.rows('SELECT * FROM messages WHERE session = ? ORDER BY seq LIMIT ? OFFSET ?', sessionId, limit, offset);
    return { session: s, messages, total, next: offset + messages.length < total ? offset + messages.length : null };
  }

  /** The position of a message within its session (for reading around it). */
  position(id) {
    const m = this.db.prepare('SELECT session, seq FROM messages WHERE id = ?').get(id);
    if (!m) return null;
    const before = this.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE session = ? AND seq < ?').get(m.session, m.seq).n;
    return { session: m.session, index: before };
  }

  hasTable(name) {
    return !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  }

  // ---- Episodes: stretches of conversations sent to a store that extracts facts (feed.js) ----

  /**
   * Where the given episodes came from, by the id their store gave them (guid) or javmem's own:
   * [{ uuid (the id asked for), session, seq_from, seq_to, body, first_time, title, origin, note }].
   */
  episodeSessions(uuids) {
    if (!uuids.length || !this.hasTable('episodes')) return [];
    const q = this.db.prepare(`SELECT e.session, e.seq_from, e.seq_to, e.body, e.first_time, s.title, s.origin, s.note
      FROM episodes e JOIN sessions s ON s.id = e.session WHERE e.guid = ? OR e.uuid = ? LIMIT 1`);
    return uuids.map((u) => {
      const r = q.get(String(u), String(u));
      return r ? { uuid: String(u), ...r } : null;
    }).filter(Boolean);
  }

  /** Episodes as their store got them: [{ uuid, content, valid_at }]. */
  episodeTexts(uuids) {
    return this.episodeSessions(uuids).map((e) => ({ uuid: e.uuid, content: e.body, valid_at: e.first_time || null }));
  }

  /** Messages that no episode of this store (backend and group) covers yet, by session and order. */
  unfed(backend, grp = '', limit = 5000) {
    return this.rows(`SELECT m.*, s.title, s.note FROM messages m JOIN sessions s ON s.id = m.session
      WHERE NOT EXISTS (SELECT 1 FROM episodes e WHERE e.backend = ? AND e.grp = ? AND e.session = m.session
        AND m.seq BETWEEN e.seq_from AND e.seq_to)
      ORDER BY m.session, m.seq LIMIT ?`, backend, grp, limit);
  }

  addEpisode(e) {
    return this.db.prepare(`INSERT OR IGNORE INTO episodes (uuid, backend, grp, session, seq_from, seq_to, count, chars,
      first_time, name, source, body, state, tier) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
      .run(e.uuid, e.backend, e.grp || '', e.session, e.seq_from, e.seq_to, e.count, e.chars, e.first_time || null,
        e.name || null, e.source || 'message', e.body, e.tier || null).changes;
  }

  episodesIn(backend, grp, state, limit = 100) {
    return this.rows(`SELECT * FROM episodes WHERE backend = ? AND grp = ? AND state = ?
      ORDER BY first_time, session, seq_from LIMIT ?`, backend, grp || '', state, limit);
  }

  setEpisode(uuid, fields) {
    const keys = Object.keys(fields).filter((k) => ['state', 'tries', 'sent_at', 'done_at', 'tier', 'tokens', 'guid'].includes(k));
    if (!keys.length) return;
    this.db.prepare(`UPDATE episodes SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE uuid = ?`)
      .run(...keys.map((k) => fields[k]), uuid);
  }

  /** Records which entities (people, things) the store found in an episode: [{ uuid, name }]. */
  addEpisodeNodes(episode, nodes) {
    const q = this.db.prepare('INSERT OR IGNORE INTO episode_nodes (node, episode, name) VALUES (?, ?, ?)');
    for (const n of nodes) if (n && n.uuid) q.run(String(n.uuid), String(episode), n.name == null ? null : String(n.name));
  }

  /** The episodes an entity was found in, newest first. */
  nodeEpisodes(node, limit = 10) {
    if (!this.hasTable('episode_nodes')) return [];
    return this.rows(`SELECT n.episode FROM episode_nodes n LEFT JOIN episodes e ON e.uuid = n.episode WHERE n.node = ?
      ORDER BY e.first_time DESC LIMIT ?`, String(node), limit).map((r) => r.episode);
  }

  /** How many episodes of one store and group its store has finished (to size a listing of them). */
  doneCount(backend, grp = '') {
    return this.episodeCounts(backend, grp).done;
  }

  /** { pending, sent, done, failed } for one store and group. */
  episodeCounts(backend, grp = '') {
    const out = { pending: 0, sent: 0, done: 0, failed: 0 };
    if (!this.hasTable('episodes')) return out;
    for (const r of this.rows('SELECT state, COUNT(*) AS n FROM episodes WHERE backend = ? AND grp = ? GROUP BY state', backend, grp || '')) {
      out[r.state] = r.n;
    }
    return out;
  }

  /** Tokens and segments spent on one day (YYYY-MM-DD, local time) for one store. */
  spend(day, backend) {
    if (!this.hasTable('spend')) return { tokens: 0, segments: 0 };
    return this.db.prepare('SELECT tokens, segments FROM spend WHERE day = ? AND backend = ?').get(day, backend)
      || { tokens: 0, segments: 0 };
  }

  addSpend(day, backend, tokens, segments = 0) {
    this.db.prepare(`INSERT INTO spend (day, backend, tokens, segments) VALUES (?, ?, ?, ?)
      ON CONFLICT(day, backend) DO UPDATE SET tokens = tokens + excluded.tokens, segments = segments + excluded.segments`)
      .run(day, backend, Math.max(0, Math.round(tokens)), segments);
  }

  stats() {
    const one = (sql) => this.db.prepare(sql).get().n;
    return {
      sessions: one("SELECT COUNT(*) AS n FROM sessions WHERE origin = 'session'"),
      messages: one("SELECT COUNT(*) AS n FROM messages WHERE origin = 'session'"),
      inheritedPackages: one("SELECT COUNT(*) AS n FROM sessions WHERE origin LIKE 'inherited:%'"),
      inherited: one("SELECT COUNT(*) AS n FROM messages WHERE origin LIKE 'inherited:%'"),
      updated: this.meta('updated') || null,
    };
  }
}

module.exports = { LocalStore, grams, ftsQuery, day };
