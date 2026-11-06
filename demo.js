// The demo backend. With MEMV2_URL=demo or JAVIS_URL=demo, memv2-mcp.js and javis-mcp.js send their requests here
// instead of to a running memv2 or Javis. It answers from demo/data.json in the shapes those services use, with
// simple matching (Latin words and pairs of Chinese characters), so every tool can be tried with nothing installed.
// Everything in demo/ is made up: a fictional 小明, his daughter 小雨, his colleague 老陈 and four past conversations.
'use strict';

const fs = require('fs');
const path = require('path');

let cache = null;

function data() {
  if (cache) return cache;
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'demo', 'data.json'), 'utf8'));
  const sessions = new Map(d.sessions.map((s) => [s.id, s]));
  // memv2 keeps every message as a raw record, keyed <session id>-<message number>.
  const records = new Map();
  for (const s of d.sessions) {
    s.messages.forEach((m, i) => {
      const key = `${s.id}-${i + 1}`;
      records.set(key, { key, session: s, ...m });
    });
  }
  const entities = new Map(d.javis.entities.map((e) => [e.uuid, e]));
  const episodes = new Map(d.javis.episodes.map((e) => {
    const s = sessions.get(e.session);
    const content = e.messages.map((n) => `${s.messages[n - 1].role}: ${s.messages[n - 1].content}`).join('\n');
    return [e.uuid, { ...e, content }];
  }));
  cache = { d, sessions, records, entities, episodes };
  return cache;
}

// The words of a text: Latin words, and each pair of Chinese characters (one character alone stays itself).
function grams(text) {
  const s = String(text || '').toLowerCase();
  const out = new Set(s.match(/[a-z0-9]+/g) || []);
  for (const run of s.match(/[一-鿿]+/g) || []) {
    if (run.length === 1) out.add(run);
    for (let i = 0; i + 1 < run.length; i += 1) out.add(run.slice(i, i + 2));
  }
  return out;
}

function score(query, text) {
  const have = grams(text);
  let n = 0;
  for (const g of grams(query)) if (have.has(g)) n += 1;
  return n;
}

const ranked = (list, query, textOf) => list.map((x) => [score(query, textOf(x)), x])
  .filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]).map(([, x]) => x);

// ---- memv2: POST /api/v1/recall, /api/v1/search, /api/v1/query (raw); GET /api/v1/records/<key> ----

// A namespace asked for: that namespace, plus the shared area unless include_master is false.
const inScope = (namespace, payload) => !payload.namespace || namespace === payload.namespace
  || (namespace === 'shared' && payload.include_master !== false);

const memv2Item = (it) => ({
  item_id: it.item_id, fact: it.fact, date: it.date, namespace: it.namespace, status: it.status,
  core_sources: [{ core_record_key: it.record }],
});

/** One memv2 request; answers { status, body } like memv2's HTTP interface. */
function memv2(method, urlPath, payload = {}) {
  const { d, records } = data();
  const ok = (body) => ({ status: 200, body: { ...body, demo: true } });
  if (method === 'GET' && urlPath.startsWith('/api/v1/records/')) {
    const r = records.get(decodeURIComponent(urlPath.slice('/api/v1/records/'.length)));
    if (!r) return { status: 404, body: null };
    return ok({ record_key: r.key, source: r.session.provider, title: r.session.title, namespace: r.session.namespace,
      role: r.role, occurred_at: r.timestamp, text: r.content });
  }
  if (method !== 'POST') return { status: 404, body: { error: 'not_found' } };
  const items = d.memv2.items.filter((it) => inScope(it.namespace, payload));
  const limit = Number.isInteger(payload.limit) ? payload.limit : 20;
  if (urlPath === '/api/v1/recall') {
    return ok({ semantic: { items: ranked(items.filter((it) => it.status === 'active'), payload.query, (it) => it.fact).map(memv2Item) } });
  }
  if (urlPath === '/api/v1/search') {
    let list = items.filter((it) => payload.include_superseded === true || it.status === 'active');
    if (payload.time_from) list = list.filter((it) => it.date >= String(payload.time_from).slice(0, 10));
    if (payload.time_to) list = list.filter((it) => it.date <= String(payload.time_to).slice(0, 10));
    list = payload.entity
      ? list.filter((it) => it.fact.includes(payload.entity)).sort((a, b) => a.date.localeCompare(b.date))
      : ranked(list, payload.query, (it) => it.fact);
    return ok({ semantic: { items: list.slice(0, limit).map(memv2Item) } });
  }
  if (urlPath === '/api/v1/query' && payload.mode === 'raw') {
    // Like memv2's own raw search: the query matches as one string.
    const q = String(payload.query || '').trim().toLowerCase();
    const hits = [];
    for (const r of records.values()) {
      const at = q ? r.content.toLowerCase().indexOf(q) : -1;
      if (at >= 0 && inScope(r.session.namespace, payload)) {
        hits.push({ record_key: r.key, text: r.content, role: r.role, occurred_at: r.timestamp, match_range: [at, at + q.length] });
      }
    }
    return ok({ items: hits.slice(0, limit) });
  }
  return { status: 404, body: { error: 'not_found' } };
}

// ---- Javis: its MCP tools search_memory, get_entity, find_sessions, get_conversation, get_episodes ----

const JAVIS_TOOLS = ['search_memory', 'get_entity', 'find_sessions', 'get_conversation', 'get_episodes']
  .map((name) => ({ name, description: `demo ${name}`, inputSchema: { type: 'object' } }));

const factOut = (f) => ({
  uuid: f.uuid, fact: f.fact, source_node_uuid: f.source, target_node_uuid: f.target,
  valid_at: f.valid_at, invalid_at: f.invalid_at || null, expired_at: null, episodes: f.episodes,
});

function sourcesOf(facts) {
  const { sessions, episodes } = data();
  const ids = [...new Set(facts.flatMap((f) => f.episodes))];
  return ids.map((id) => {
    const s = sessions.get(episodes.get(id).session);
    return { episode_uuid: id, sessions: [{ id: s.id, title: s.title, provider: s.provider }] };
  });
}

const javisTools = {
  search_memory({ query, limit = 8, include_history = false }) {
    const { d, entities } = data();
    const names = (f) => `${f.fact} ${entities.get(f.source)?.name || ''} ${entities.get(f.target)?.name || ''}`;
    const facts = ranked(d.javis.facts.filter((f) => include_history || !f.invalid_at), query, names).slice(0, limit);
    return { facts: facts.map(factOut), sources: sourcesOf(facts) };
  },
  get_entity({ entity_uuid, limit = 15 }) {
    const { d, entities } = data();
    const e = entities.get(entity_uuid);
    if (!e) throw new Error('entity not found');
    const facts = d.javis.facts.filter((f) => f.source === e.uuid || f.target === e.uuid).slice(0, limit);
    return {
      entity: { uuid: e.uuid, name: e.name, summary: e.summary },
      facts: facts.map((f) => {
        const other = entities.get(f.source === e.uuid ? f.target : f.source);
        return { ...factOut(f), other_entity: { uuid: other.uuid, name: other.name } };
      }),
      sources: sourcesOf(facts),
    };
  },
  find_sessions({ query, limit = 8 }) {
    const words = [...new Set(String(query || '').toLowerCase().split(/\s+/).filter(Boolean))];
    const found = [];
    for (const s of data().sessions.values()) {
      for (const m of s.messages) {
        const n = words.filter((w) => m.content.toLowerCase().includes(w)).length;
        if (n) found.push([n, { session_id: s.id, title: s.title, provider: s.provider, role: m.role, timestamp: m.timestamp, excerpt: m.content.slice(0, 600) }]);
      }
    }
    return { matches: found.sort((a, b) => b[0] - a[0]).slice(0, limit).map(([, m]) => m) };
  },
  get_conversation({ session_id, offset = 0, limit = 6 }) {
    const s = data().sessions.get(session_id);
    if (!s) throw new Error('session not found');
    const page = s.messages.slice(offset, offset + limit);
    return {
      session: { id: s.id, title: s.title, provider: s.provider, first_time: s.messages[0].timestamp, last_time: s.messages[s.messages.length - 1].timestamp },
      messages: page.map((m) => ({ role: m.role, timestamp: m.timestamp, content: m.content })),
      next_offset: offset + limit < s.messages.length ? offset + limit : null,
    };
  },
  get_episodes({ episode_uuids = [] }) {
    const { episodes } = data();
    return { episodes: episode_uuids.map((u) => episodes.get(u)).filter(Boolean).map((e) => ({ uuid: e.uuid, content: e.content, valid_at: e.valid_at })) };
  },
};

/** One JSON-RPC request to the demo Javis; answers its result like Javis's MCP endpoint (tool errors as isError). */
function javis(method, params = {}) {
  if (method === 'tools/list') return { tools: JAVIS_TOOLS };
  if (method !== 'tools/call') throw new Error(`Method not found: ${method}`);
  const tool = javisTools[params.name];
  if (!tool) return { isError: true, content: [{ type: 'text', text: `Error executing tool ${params.name}: unknown tool` }] };
  try {
    return { content: [{ type: 'text', text: JSON.stringify(tool(params.arguments || {})) }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: `Error executing tool ${params.name}: ${err.message}` }] };
  }
}

const DIR = path.join(__dirname, 'demo');

module.exports = { memv2, javis, DIR };
