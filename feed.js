#!/usr/bin/env node
// feed.js (command javmem-feed): sends what javmem's local store holds (a Bot's own conversations, memory inherited
// from other AIs) to a store that extracts facts from it, so that store has something to find. Here: the official
// Graphiti MCP server (JAVIS_BACKEND=graphiti in javis-mcp.js reads it back).
// Extraction costs model tokens, so the feeder is careful with it:
//   - a conversation goes in once it has settled (enough new messages, or quiet for a while), in stretches of a few
//     messages (an "episode"); each stretch goes in once, as the store's episodes table records;
//   - only a few episodes are in flight at a time; an episode counts as done when Graphiti lists it (it saves an
//     episode once it has finished with it, under an id of its own, so ours carry unique names), and is sent again
//     (at most three times) when Graphiti seems to have lost it (its queue is in memory: a restart empties it);
//   - a day's budget of tokens per store: Graphiti does not report what it used, so each episode counts as a fixed
//     number of tokens (tokensPerSegment); at the budget it stops, and goes on the next day where it stopped.
// Output: counts only, never the text.
'use strict';

const fs = require('fs');
const { LocalStore } = require('./local-store.js');
const { GraphitiClient, episodeId, provider, DEFAULT_URL } = require('./graphiti.js');

const VERSION = (() => {
  try { return String(require('./package.json').version || 'unknown'); } catch { return 'unknown'; }
})();

const DEFAULTS = {
  maxMessages: 8,           // messages per episode
  maxChars: 4000,           // characters per episode (a longer single message goes alone, cut at 3 times this)
  gapMs: 6 * 3600 * 1000,   // a pause this long starts a new episode
  settleMs: 30 * 60 * 1000, // a conversation's last few messages wait this long for more
  window: 4,                // episodes in flight at a time
  lostAfterMs: 30 * 60 * 1000,
  maxTries: 3,
  dailyTokens: 1000000,     // per store and day
  // What one episode is counted as. Measured 2026-11-06 (official server 1.1.3, gpt-6-luna): 9 short episodes of 2-3
  // messages took 14,560 tokens each on average; longer ones take more, so 20,000.
  tokensPerSegment: 20000,
};

/** The local calendar day of a time, YYYY-MM-DD: the budget starts again at local midnight. */
function localDay(t = Date.now()) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const timeOf = (t) => {
  const ms = Date.parse(t || '');
  return Number.isFinite(ms) ? ms : null;
};

/**
 * The episodes that are ready to go, oldest first: stretches of one conversation, at most maxMessages messages and
 * maxChars characters, split at long pauses and where remembered facts give way to talk. A conversation's last stretch
 * waits until it is full or quiet for settleMs; an inherited package is complete as it is.
 */
function segments(rows, o = {}) {
  const opts = { ...DEFAULTS, ...o };
  const now = opts.now != null ? opts.now : Date.now();
  const bySession = new Map();
  for (const r of rows) {
    if (!bySession.has(r.session)) bySession.set(r.session, []);
    bySession.get(r.session).push(r);
  }
  const out = [];
  for (const list of bySession.values()) {
    const inherited = String(list[0].origin || '').startsWith('inherited:');
    let cur = [];
    let chars = 0;
    const flush = () => {
      if (cur.length) out.push(cur);
      cur = [];
      chars = 0;
    };
    for (const m of list) {
      const len = String(m.text || '').length;
      const prev = cur[cur.length - 1];
      const gap = prev && timeOf(prev.time) != null && timeOf(m.time) != null && timeOf(m.time) - timeOf(prev.time) > opts.gapMs;
      const kindChange = prev && (prev.role === 'fact') !== (m.role === 'fact');
      if (cur.length && (cur.length >= opts.maxMessages || chars + len > opts.maxChars || gap || kindChange)) flush();
      cur.push(m);
      chars += len;
    }
    // The open end of a live conversation waits for more, unless it is full or has gone quiet.
    const last = cur[cur.length - 1];
    const quiet = last && (timeOf(last.time) == null || now - timeOf(last.time) > opts.settleMs);
    if (cur.length && (inherited || cur.length >= opts.maxMessages || quiet)) flush();
  }
  return out.sort((a, b) => (timeOf(a[0].time) || 0) - (timeOf(b[0].time) || 0));
}

/** What a speaker is called in an episode: the owner, the assistant (the Bot), or the role itself. */
function speaker(role, names) {
  if (role === 'user') return names.owner || '用户';
  if (role === 'assistant') return names.assistant || '助手';
  return role;
}

/**
 * One episode as Graphiti gets it: talk as "speaker: words" lines (source message), remembered facts as a short note
 * that says where they came from (source text).
 */
function episodeOf(seg, { group = 'main', owner = '', assistant = '', maxChars = DEFAULTS.maxChars } = {}) {
  const first = seg[0];
  const lastM = seg[seg.length - 1];
  const facts = first.role === 'fact';
  const cut = (s) => (s.length > maxChars * 3 ? `${s.slice(0, maxChars * 3)}（后面略）` : s);
  const where = provider(first.origin);
  const body = facts
    ? [`${where}的记忆${first.note ? `（${first.note}）` : ''}，关于${owner || '用户'}：`,
      ...seg.map((m) => `- ${cut(String(m.text))}`)].join('\n')
    : seg.map((m) => `${speaker(m.role, { owner, assistant })}: ${cut(String(m.text))}`).join('\n');
  const t = seg.map((m) => m.time).find((x) => timeOf(x) != null) || null;
  const uuid = episodeId(group, first.session, first.seq, lastM.seq);
  return {
    uuid, backend: 'graphiti', grp: group, session: first.session, seq_from: first.seq, seq_to: lastM.seq, count: seg.length,
    chars: seg.reduce((n, m) => n + String(m.text || '').length, 0), first_time: t, body,
    source: facts ? 'text' : 'message',
    // Unique, so the episode can be found again in Graphiti's list (which gives it an id of its own).
    name: `${String(first.title || first.session).slice(0, 50)} · javmem ${uuid.slice(0, 13)}`,
  };
}

const iso = (t) => new Date(t).toISOString();

/**
 * One pass for one store and Graphiti group: confirm what was sent, send again what looks lost, cut new episodes,
 * then send pending ones while the window and the day's budget allow. Returns counts.
 */
async function feedGraphiti(store, o = {}) {
  const opts = { ...DEFAULTS, ...o };
  const group = opts.group || 'main';
  const now = () => (opts.now != null ? opts.now : Date.now());
  const client = opts.client || new GraphitiClient(opts.url || DEFAULT_URL, { version: VERSION });
  const report = { added: 0, sent: 0, confirmed: 0, resent: 0, failed: 0, stopped: null };

  // 1. What Graphiti has finished. It saves an episode only when it is done with it, under an id of its own (a new
  //    episode cannot be given one), so the group's episodes are listed and ours found by their names.
  let waiting = store.episodesIn('graphiti', group, 'sent', 1000);
  if (waiting.length) {
    const listed = await client.tool('get_episodes', {
      group_ids: [group], max_episodes: store.doneCount('graphiti', group) + waiting.length + 200,
    }, 120000);
    const byName = new Map();
    for (const ep of listed.episodes || []) if (ep && ep.name && !byName.has(ep.name)) byName.set(ep.name, ep.uuid);
    for (const e of waiting) {
      const guid = byName.get(e.name);
      if (!guid) continue;
      // Which entities it holds: the official server finds an entity only through an episode that mentions it.
      try {
        const got = await client.tool('get_episode_entities', { episode_uuids: [guid], group_id: group });
        store.addEpisodeNodes(guid, got.nodes || []);
      } catch { /* get_entity then knows fewer starting points */ }
      store.setEpisode(e.uuid, { state: 'done', done_at: iso(now()), guid });
      report.confirmed += 1;
    }
  }
  waiting = store.episodesIn('graphiti', group, 'sent', 1000);
  // 2. Nothing finished for a long while although some are waiting: Graphiti lost them (its queue is in memory).
  const oldest = waiting.reduce((t, e) => Math.min(t, timeOf(e.sent_at) || Infinity), Infinity);
  if (!report.confirmed && waiting.length && now() - oldest > opts.lostAfterMs) {
    for (const e of waiting) {
      if (e.tries >= opts.maxTries) {
        store.setEpisode(e.uuid, { state: 'failed' });
        report.failed += 1;
      } else {
        store.setEpisode(e.uuid, { state: 'pending' });
        report.resent += 1;
      }
    }
    waiting = [];
  }

  // 3. New episodes from what came in since.
  for (const seg of segments(store.unfed('graphiti', group, 5000), { ...opts, now: now() })) {
    report.added += store.addEpisode(episodeOf(seg, { group, owner: opts.owner, assistant: opts.assistant, maxChars: opts.maxChars }));
  }

  // 4. Send, oldest first, while the window and the day's budget allow.
  let inFlight = waiting.length;
  const pending = store.episodesIn('graphiti', group, 'pending', Math.max(0, opts.window - inFlight));
  for (const e of pending) {
    const day = localDay(now());
    if (store.spend(day, 'graphiti').tokens + opts.tokensPerSegment > opts.dailyTokens) {
      report.stopped = 'budget';
      break;
    }
    // No uuid: the official server takes one only to process an episode it already has again.
    const args = {
      name: e.name, episode_body: e.body, group_id: group,
      source: e.source === 'text' ? 'text' : 'message', source_description: 'javmem',
    };
    if (e.first_time) args.reference_time = iso(timeOf(e.first_time));
    await client.tool('add_memory', args);
    store.setEpisode(e.uuid, { state: 'sent', sent_at: iso(now()), tries: e.tries + 1 });
    store.addSpend(day, 'graphiti', opts.tokensPerSegment, 1);
    inFlight += 1;
    report.sent += 1;
  }
  report.counts = store.episodeCounts('graphiti', group);
  report.today = store.spend(localDay(now()), 'graphiti');
  return report;
}

function main(argv) {
  const flag = (n, d) => {
    const i = argv.indexOf(n);
    return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
  };
  const num = (n, d) => {
    const v = Number(flag(n, d));
    return Number.isFinite(v) && v >= 0 ? v : d;
  };
  const db = flag('--db');
  if (!db || argv.includes('--help')) {
    process.stdout.write([
      '用法：javmem-feed --db <本地库> [--graphiti <图谱服务地址>] [--group <组>] [--owner <名字>] [--assistant <名字>]',
      '      [--daily-tokens <每天上限>] [--window <同时处理几段>] [--watch <秒>] [--status]',
      `把本地库里的对话送进 Graphiti 官方服务抽取事实（默认 ${DEFAULT_URL}）。只打印计数。`,
      '',
    ].join('\n'));
    return Promise.resolve(db ? 0 : 2);
  }
  if (!fs.existsSync(db)) {
    process.stderr.write(`没有这个本地库：${db}\n`);
    return Promise.resolve(1);
  }
  const store = new LocalStore(db);
  const group = flag('--group', process.env.GRAPHITI_GROUP_ID || 'main');
  const opts = {
    url: flag('--graphiti', process.env.JAVIS_URL || DEFAULT_URL), group,
    owner: flag('--owner', process.env.MEMORY_OWNER || ''), assistant: flag('--assistant', process.env.MEMORY_ASSISTANT || ''),
    dailyTokens: num('--daily-tokens', DEFAULTS.dailyTokens), window: num('--window', DEFAULTS.window),
  };
  const print = (r) => {
    const c = r.counts;
    const t = r.today;
    process.stdout.write(`${new Date().toISOString()} 新切 ${r.added} 段，送出 ${r.sent} 段，完成 ${r.confirmed} 段`
      + `${r.resent ? `，重送 ${r.resent} 段` : ''}${r.failed ? `，放弃 ${r.failed} 段` : ''}；`
      + `图谱里 ${c.done} 段，处理中 ${c.sent} 段，排队 ${c.pending} 段，失败 ${c.failed} 段；`
      + `今天约用 ${t.tokens} token（${t.segments} 段），上限 ${opts.dailyTokens}`
      + `${r.stopped === 'budget' ? '，已到上限，明天接着送' : ''}\n`);
  };
  if (argv.includes('--status')) {
    print({ added: 0, sent: 0, confirmed: 0, counts: store.episodeCounts('graphiti', group), today: store.spend(localDay(), 'graphiti') });
    store.close();
    return Promise.resolve(0);
  }
  const every = num('--watch', 0) * 1000;
  const once = () => feedGraphiti(store, opts).then(print);
  if (!every) {
    return once().then(() => 0, (err) => {
      process.stderr.write(`${err.message}\n`);
      return 1;
    }).finally(() => store.close());
  }
  return new Promise(() => {
    const tick = () => once().catch((err) => process.stderr.write(`${err.message}\n`)).finally(() => setTimeout(tick, every));
    tick();
  });
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

module.exports = { DEFAULTS, segments, episodeOf, speaker, feedGraphiti, localDay, main };
