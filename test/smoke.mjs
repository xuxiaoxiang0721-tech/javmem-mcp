// Smoke test for memv2-mcp.js and javis-mcp.js without memv2 or Javis running: the MCP handshake (with package.json's
// version), the tool lists, the owner name in the tool text, and the error a Bot gets when the token is missing or the
// service is down.
//   node test/smoke.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(join(tmpdir(), 'javmem-mcp-'));
const CLOSED = 'http://127.0.0.1:9'; // discard port: nothing listens
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** Start a wrapper, send the requests in order, return the responses by id. */
function session(script, env, requests) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, script)], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
    const answers = new Map();
    let buffer = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${script}: no answer`)); }, 20000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.id !== undefined) answers.set(msg.id, msg);
        if (answers.size === requests.length) { clearTimeout(timer); child.stdin.end(); resolve(answers); }
      }
    });
    child.on('error', reject);
    const init = { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } } };
    child.stdin.write(`${JSON.stringify(init)}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    requests.slice(1).forEach((r, n) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n + 1, ...r })}\n`));
  });
}

const text = (result) => (result?.content || []).map((c) => c.text).join('\n');
let passed = 0;
const ok = (label) => { passed += 1; console.log('ok', label); };
// node:sqlite (Node 22.5 or later) backs the local store, memv2-lite and the wizard; without it those checks are skipped.
const SQLITE = await import('node:sqlite').then(() => true, () => false);
let skipped = 0;
const skip = (label) => { skipped += 1; console.log('skip', label, '(needs node:sqlite: Node 22.5 or later)'); };

// memv2-mcp.js
{
  const token = join(scratch, 'memv2.token');
  writeFileSync(token, 'not-a-real-token\n');
  const a = await session('memv2-mcp.js', { MEMV2_URL: CLOSED, MEMV2_TOKEN_FILE: token }, [
    {}, { method: 'tools/list', params: {} }, { method: 'tools/call', params: { name: 'search', arguments: { query: 'x' } } }]);
  assert.equal(a.get(0).result.serverInfo.name, 'memv2');
  assert.equal(a.get(0).result.serverInfo.version, version);
  assert.deepEqual(a.get(1).result.tools.map((t) => t.name), ['recall', 'search', 'search_raw', 'read_record']);
  assert.match(a.get(0).result.instructions, /memv2 是用户的事实记忆/);
  assert.equal(a.get(2).result.isError, true);
  assert.match(text(a.get(2).result), /memv2 没在运行/);
  ok('memv2: handshake, 4 tools, default owner, service down');

  const b = await session('memv2-mcp.js', { MEMV2_URL: CLOSED, MEMV2_TOKEN_FILE: '', MEMORY_OWNER: '小明' }, [
    {}, { method: 'tools/call', params: { name: 'recall', arguments: { query: 'x' } } }]);
  assert.match(b.get(0).result.instructions, /memv2 是小明的事实记忆/);
  assert.match(text(b.get(1).result), /MEMV2_TOKEN_FILE/);
  ok('memv2: owner from MEMORY_OWNER, missing token named');
}

// javis-mcp.js
{
  const profile = join(scratch, 'bot.env');
  const tokenFile = join(scratch, 'javis.env');
  writeFileSync(tokenFile, 'MCP_TOKEN=not-a-real-token\n');
  writeFileSync(profile, `JAVIS_SOURCES=acct-a\nJAVIS_TOKEN_FROM=${tokenFile}\n`);
  const a = await session('javis-mcp.js', { JAVIS_URL: `${CLOSED}/mcp`, JAVIS_TOKEN_FILE: profile }, [
    {}, { method: 'tools/list', params: {} }, { method: 'tools/call', params: { name: 'search_memory', arguments: { query: 'x' } } }]);
  assert.equal(a.get(0).result.serverInfo.version, version);
  assert.deepEqual(a.get(1).result.tools.map((t) => t.name), ['search_memory', 'get_entity', 'find_sessions', 'get_conversation']);
  assert.match(a.get(0).result.instructions, /Javis 存的是用户以前和 AI 的对话原文/);
  assert.equal(a.get(2).result.isError, true);
  assert.match(text(a.get(2).result), /Javis 没在运行/);
  ok('javis: handshake, 4 tools, default owner, service down');
}

// memory-mcp.js (the combined server)
{
  const token = join(scratch, 'memv2.token');
  const profile = join(scratch, 'bot.env');
  const env = { MEMV2_URL: CLOSED, MEMV2_TOKEN_FILE: token, JAVIS_URL: `${CLOSED}/mcp`, JAVIS_TOKEN_FILE: profile };
  const a = await session('memory-mcp.js', env, [
    {}, { method: 'tools/list', params: {} },
    { method: 'tools/call', params: { name: 'search', arguments: { query: 'x' } } },
    { method: 'tools/call', params: { name: 'read', arguments: {} } },
    { method: 'tools/call', params: { name: 'read', arguments: { record_key: 'a', session_id: 'b' } } },
    { method: 'tools/call', params: { name: 'person', arguments: { name: 'x' } } }]);
  assert.equal(a.get(0).result.serverInfo.version, version);
  assert.deepEqual(a.get(1).result.tools.map((t) => t.name), ['recall', 'search', 'search_raw', 'person', 'read']);
  assert.match(a.get(0).result.instructions, /同时查 memv2（用户的事实记忆）和图库/);
  assert.equal(a.get(2).result.isError, true);
  assert.match(text(a.get(2).result), /两个库这次都没查成.*memv2 没在运行.*Javis 没在运行/s);
  assert.match(text(a.get(3).result), /只给一个/);
  assert.match(text(a.get(4).result), /只给一个/);
  assert.equal(a.get(5).result.isError, true);
  ok('memory: handshake, 5 tools, both stores down named, read takes one id');

  // One store configured wrongly, the other only down: the answer names both, and is not a crash.
  const b = await session('memory-mcp.js', { ...env, JAVIS_TOKEN_FILE: '' }, [
    {}, { method: 'tools/call', params: { name: 'search_raw', arguments: { query: 'x' } } }]);
  assert.match(text(b.get(1).result), /memv2 没在运行/);
  assert.match(text(b.get(1).result), /JAVIS_TOKEN_FILE/);
  ok('memory: each store\'s own error is shown');
}

// javmem/status (not a tool): each store's state, from a closed port, a missing token, and a fake memv2 and Javis that
// take one token and refuse another. The answer never carries a token.
{
  const http = await import('node:http');
  const GOOD = 'tok-GOOD-1234';
  const fake = http.createServer((req, res) => {
    const ok = req.headers.authorization === `Bearer ${GOOD}`;
    const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.method === 'GET' && req.url === '/api/v1/records/javmem-status-check') return ok ? reply(404, null) : reply(403, { error: 'invalid_client_token' });
      if (req.method === 'POST' && req.url === '/mcp') {
        if (!ok) return reply(401, { error: 'unauthorized' });
        const m = JSON.parse(body);
        return reply(200, m.method === 'tools/list' ? { jsonrpc: '2.0', id: m.id, result: { tools: [] } } : { jsonrpc: '2.0', id: m.id, error: { message: 'no' } });
      }
      return reply(404, { error: 'not_found' });
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${fake.address().port}`;
  const good = join(scratch, 'good.token');
  const bad = join(scratch, 'bad.token');
  writeFileSync(good, `${GOOD}\n`);
  writeFileSync(bad, 'tok-BAD-5678\n');
  const goodProfile = join(scratch, 'good.env');
  writeFileSync(goodProfile, `JAVIS_SOURCES=*\nJAVIS_TOKEN_FROM=${good}\n`);
  const ask = async (script, env) => (await session(script, env, [{}, { method: 'javmem/status', params: {} }])).get(1).result;
  const states = (r) => r.stores.map((s) => `${s.store}:${s.state}`);
  try {
    assert.deepEqual(states(await ask('memv2-mcp.js', { MEMV2_URL: url, MEMV2_TOKEN_FILE: good })), ['memv2:ok']);
    assert.deepEqual(states(await ask('memv2-mcp.js', { MEMV2_URL: url, MEMV2_TOKEN_FILE: bad })), ['memv2:bad_token']);
    assert.deepEqual(states(await ask('memv2-mcp.js', { MEMV2_URL: CLOSED, MEMV2_TOKEN_FILE: good })), ['memv2:down']);
    assert.deepEqual(states(await ask('memv2-mcp.js', { MEMV2_URL: url, MEMV2_TOKEN_FILE: '' })), ['memv2:no_token']);
    assert.deepEqual(states(await ask('javis-mcp.js', { JAVIS_URL: `${url}/mcp`, JAVIS_TOKEN_FILE: goodProfile })), ['javis:ok']);
    assert.deepEqual(states(await ask('javis-mcp.js', { JAVIS_URL: `${url}/mcp`, JAVIS_TOKEN_FILE: bad })), ['javis:bad_token']);
    const both = await ask('memory-mcp.js', { MEMV2_URL: url, MEMV2_TOKEN_FILE: good, JAVIS_URL: `${CLOSED}/mcp`, JAVIS_TOKEN_FILE: goodProfile });
    assert.deepEqual(states(both), ['memv2:ok', 'javis:down']);
    assert.equal(both.labels, 'none');
    assert.equal(both.stores[1].hide_list, 'none');
    assert.ok(!/tok-/.test(JSON.stringify(both)), 'a status answer never carries a token');
  } finally {
    fake.close();
  }
  ok('javmem/status: ok, bad token, down, no token, for each store; no token in the answer');
}

// The demo backend (MEMV2_URL=demo, JAVIS_URL=demo): all thirteen tools answer from the made-up data, with no token
// and nothing running; cross-check marks, the dropped made-up fact and the per-Bot filters work as with real stores.
{
  const demo = { MEMV2_URL: 'demo', JAVIS_URL: 'demo', MEMV2_TOKEN_FILE: '', JAVIS_TOKEN_FILE: '', MEMORY_OWNER: '' };
  const call = (name, args) => ({ method: 'tools/call', params: { name, arguments: args } });
  // Answers come back in the order they finish; put them in request order.
  const all = (m) => [...m.keys()].filter((id) => id > 0).sort((a, b) => a - b).map((id) => m.get(id).result);
  const combined = all(await session('memory-mcp.js', demo, [{},
    call('recall', { query: '小雨的游泳课' }), call('search', { query: '游泳课 学费' }), call('search_raw', { query: '千岛湖' }),
    call('person', { name: '老陈' }), call('read', { record_key: 'demo-s1-5' }), call('read', { session_id: 'demo-s3' }),
    { method: 'javmem/status', params: {} }]));
  combined.slice(0, 6).forEach((r) => assert.notEqual(r.isError, true));
  const [recall, search, raw, person, record, conversation, status] = combined.map((r, i) => (i === 6 ? r : text(r)));
  assert.match(recall, /小雨每周三下午上游泳课，教练姓周 \(shared\)（图库也有）/);
  assert.match(search, /2400 元.*（图库说法不同，以这条为准）\n   图库说：小明给小雨报了 3 个月游泳课，学费 2600 元/);
  assert.match(search, /另有 1 条和原文对不上，没列出。/);
  assert.match(raw, /记录号：demo-s2-1  《十一月去千岛湖》（chatgpt，对话号 demo-s2）/);
  assert.match(person, /小明和老陈 2025 年一起去成都出过差.*（未细核）（只在图库）/);
  assert.match(person, /老陈 12 月起调到深圳分公司，仓储系统交接给小明 \(work\)/);
  assert.match(record, /"text": "刚给小雨交了三个月的游泳课学费，2400 元。"/);
  assert.match(conversation, /《老陈调岗》（grok，对话号 demo-s3）[\s\S]*已读完。/);
  assert.deepEqual(status.stores.map((s) => `${s.store}:${s.state}`), ['memv2:demo', 'javis:demo']);
  assert.equal(status.labels, 'ok');
  const single = [
    ...all(await session('memv2-mcp.js', demo, [{}, call('recall', { query: '芒果' }), call('search', { query: '', entity: '老陈' }),
      call('search_raw', { query: '2400' }), call('read_record', { record_key: 'demo-s4-1' })])),
    ...all(await session('javis-mcp.js', demo, [{}, call('search_memory', { query: '游泳课' }), call('get_entity', { entity_uuid: 'demo-e-laochen' }),
      call('find_sessions', { query: '千岛湖' }), call('get_conversation', { session_id: 'demo-s1', offset: 4 })])),
  ];
  single.forEach((r) => assert.notEqual(r.isError, true));
  assert.match(text(single[0]), /小明对芒果过敏/);
  assert.match(text(single[4]), /小雨每周三下午跟周教练上游泳课/);
  assert.ok(!/2019/.test(text(single[4])), 'the made-up fact that the source does not back is dropped');
  // Per-Bot filters on the demo data: a namespace, and a Javis account list.
  const work = all(await session('memv2-mcp.js', { ...demo, MEMV2_NAMESPACE: 'work', MEMV2_BOT_ONLY: '1' }, [{}, call('recall', { query: '小雨 老陈 芒果' })]));
  assert.match(text(work[0]), /老陈/);
  assert.ok(!/小雨|芒果/.test(text(work[0])), 'a namespace sees only its own facts');
  const gpt = all(await session('javis-mcp.js', { ...demo, JAVIS_SOURCES: 'chatgpt' }, [{}, call('find_sessions', { query: '游泳课' })]));
  assert.match(text(gpt[0]), /对话号 demo-s2/);
  assert.ok(!/demo-s1/.test(text(gpt[0])), 'an account list hides the other accounts');
  ok('demo backend: thirteen tools on made-up data, marks, the dropped fact, per-Bot filters');
}

// local-mcp.js on a local store filled with made-up messages: the five tools, Chinese words inside sentences, the
// marks for inherited memory, and javmem/status; a missing store answers "nothing yet" instead of failing.
if (!SQLITE) skip('local store');
else {
  const { createRequire } = await import('node:module');
  const { LocalStore } = createRequire(import.meta.url)('../local-store.js');
  const db = join(scratch, 'local.sqlite');
  const s = new LocalStore(db);
  s.add({ id: 'sess-1', title: '游泳课', origin: 'session' }, [
    { seq: 3, role: 'user', time: '2026-09-14T19:02:00+08:00', text: '游泳课改到每周三下午了，教练姓周。' },
    { seq: 5, role: 'assistant', time: '2026-09-14T19:03:00+08:00', text: '记下了，小雨每周三下午跟周教练上游泳课。' },
    { seq: 9, role: 'user', time: '2026-10-25T18:20:00+08:00', text: '老陈说他 12 月调去深圳分公司了。' },
  ], 12);
  s.add({ id: 'inherit:grok-1', title: 'Grok 的记忆', origin: 'inherited:Grok', note: '2026-10-30 导出' }, [
    { seq: 1, role: 'fact', time: '2026-05-01', text: '小明对芒果过敏。' },
  ], 1);
  s.close();
  const call = (name, args) => ({ method: 'tools/call', params: { name, arguments: args } });
  const env = { JAVMEM_LOCAL_DB: db, MEMORY_OWNER: '小明' };
  const a = await session('local-mcp.js', env, [{},
    call('recall', { query: '小雨的游泳课是哪天' }), call('search', { query: '深圳' }), call('search_raw', { query: '周教练' }),
    call('person', { name: '老陈' }), call('read', { session_id: 'sess-1' }), call('recall', { query: '芒果' }),
    { method: 'javmem/status', params: {} }, { method: 'tools/list', params: {} }]);
  const t = (id) => text(a.get(id).result);
  assert.equal(a.get(0).result.serverInfo.version, version);
  assert.deepEqual(a.get(8).result.tools.map((x) => x.name), ['recall', 'search', 'search_raw', 'person', 'read']);
  assert.match(t(1), /\[2026-09-14\] 小明：游泳课改到每周三下午了/);
  assert.match(t(2), /1\. \[2026-10-25\] 小明：老陈说他 12 月调去深圳分公司了。（《游泳课》，消息号 m3）/);
  assert.match(t(3), /\[2026-09-14\] 你：记下了，小雨每周三下午跟周教练上游泳课。/);
  assert.match(t(4), /【提到「老陈」的话（按时间）】/);
  assert.match(t(5), /《游泳课》（会话号 sess-1） 2026-09-14 到 2026-10-25\nm1 \[2026-09-14\] 小明：[\s\S]*已读完。/);
  assert.match(t(6), /\[2026-05-01\] 记下的事实：小明对芒果过敏。（继承自 Grok，2026-10-30 导出，消息号 m4）/);
  const st = a.get(7).result.stores[0];
  assert.equal(st.state, 'ok');
  assert.match(st.detail, /^1 个会话，3 条对话；继承来的 1 条（1 个包）/);
  const none = await session('local-mcp.js', { JAVMEM_LOCAL_DB: join(scratch, 'none.sqlite') }, [{},
    call('recall', { query: 'x' }), { method: 'javmem/status', params: {} }]);
  assert.match(text(none.get(1).result), /本地记忆库里还没有内容/);
  assert.notEqual(none.get(1).result.isError, true);
  assert.equal(none.get(2).result.stores[0].state, 'empty');
  ok('local store: five tools, Chinese words inside sentences, inherited marks, status, an empty store');
}

// javmem-inherit: the prompt; check and import of a made-up Grok package pasted in two parts with chatter around;
// importing it again adds nothing; local-mcp shows it as inherited; something that is not a package is refused.
if (!SQLITE) skip('javmem-inherit');
else {
  const { spawnSync } = await import('node:child_process');
  const cli = (...args) => spawnSync(process.execPath, [join(root, 'inherit.js'), ...args], { encoding: 'utf8', timeout: 30000 });
  const zh = cli('prompt').stdout.trim();
  const en = cli('prompt', '--en').stdout.trim();
  assert.match(zh, /"javmem_inherit": 1/);
  assert.match(en, /Please gather everything you remember about me/);
  const doc = readFileSync(join(root, 'docs', 'inherit-prompt.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(doc.includes(zh) && doc.includes(en), 'docs/inherit-prompt.md holds the prompts the CLI prints');
  const pkg = join(root, 'demo', 'inherit-grok.json');
  const checked = cli('check', pkg);
  assert.equal(checked.status, 0);
  assert.deepEqual(JSON.parse(checked.stdout), { tool: 'Grok', exported_at: '2026-10-30', facts: 4, conversations: 1, problems: [] });
  const db = join(scratch, 'inherit.sqlite');
  const first = JSON.parse(cli('import', pkg, '--db', db).stdout);
  assert.equal(first.added, 5);
  assert.equal(JSON.parse(cli('import', pkg, '--db', db).stdout).added, 0, 'the same package twice adds nothing');
  const junk = join(scratch, 'junk.txt');
  writeFileSync(junk, '这不是一个包');
  const bad = cli('check', junk);
  assert.equal(bad.status, 1);
  assert.deepEqual(JSON.parse(bad.stdout).problems, ['no javmem package found (it needs "javmem_inherit": 1)']);
  const call = (name, args) => ({ method: 'tools/call', params: { name, arguments: args } });
  const a = await session('local-mcp.js', { JAVMEM_LOCAL_DB: db, MEMORY_OWNER: '小明' }, [{},
    call('recall', { query: '芒果过敏' }), call('search', { query: '樱花' }), { method: 'javmem/status', params: {} }]);
  assert.match(text(a.get(1).result), /\[2026-05\] 记下的事实：小明对芒果过敏，吃了会起疹子（健康）（继承自 Grok，2026-10-30 导出，消息号 m1）/);
  assert.match(text(a.get(2).result), /小明想明年春天带全家去日本看樱花（时间：去年冬天）（计划）（拿不准：具体哪个月没说）/);
  assert.match(a.get(3).result.stores[0].detail, /继承来的 5 条（1 个包）/);
  ok('javmem-inherit: prompt, check, import once, shown as inherited, junk refused');
}

// The official Graphiti server as the graph store (a stand-in here): javmem-feed cuts settled conversations into
// episodes, sends each once within the window and the day's budget, confirms them, sends again what the server lost;
// javis-mcp.js with JAVIS_BACKEND=graphiti answers its four tools from Graphiti plus the local store, and the
// combined server works on top of it.
if (!SQLITE) skip('Graphiti backend');
else {
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  const { LocalStore } = req('../local-store.js');
  const { importPackage } = req('../inherit.js');
  const { feedGraphiti, segments } = req('../feed.js');
  const { startFakeGraphiti } = await import('./fake-graphiti.mjs');
  const fake = await startFakeGraphiti();
  const db = join(scratch, 'graph.sqlite');
  const s = new LocalStore(db);
  s.add({ id: 'sess-1', title: '游泳课', origin: 'session' }, [
    { seq: 3, role: 'user', time: '2026-09-14T19:02:00+08:00', text: '小雨的游泳课改到每周三下午了，教练是周教练。' },
    { seq: 5, role: 'assistant', time: '2026-09-14T19:03:00+08:00', text: '记下了，小雨每周三下午跟周教练上游泳课。' },
    { seq: 9, role: 'user', time: '2026-10-25T18:20:00+08:00', text: '老陈说他 12 月调去深圳分公司了。' },
  ], 12);
  importPackage(s, readFileSync(join(root, 'demo', 'inherit-grok.json'), 'utf8'));
  const day = Date.parse('2026-11-06T12:00:00+08:00');
  // A live conversation's last message waits for more; once quiet it goes, split at the six-week pause.
  const fresh = segments(s.unfed('graphiti', 'bot-a'), { now: Date.parse('2026-10-25T18:30:00+08:00') });
  assert.deepEqual(fresh.map((g) => g.length), [5, 2], 'the inherited package first (older), the open end waits');
  const opts = { url: fake.url, group: 'bot-a', owner: '小明', assistant: '小助手', now: day };
  fake.state.paused = true;
  let r = await feedGraphiti(s, { ...opts, window: 2 });
  assert.deepEqual([r.added, r.sent, r.counts.pending, r.counts.sent], [3, 2, 1, 2]);
  assert.equal(r.today.segments, 2);
  fake.state.lose(); // the server restarts and forgets its queue
  r = await feedGraphiti(s, { ...opts, window: 2, now: day + 60000 });
  assert.deepEqual([r.confirmed, r.resent, r.sent], [0, 0, 0], 'still waiting');
  r = await feedGraphiti(s, { ...opts, window: 2, now: day + 31 * 60000 });
  assert.equal(r.resent, 2, 'nothing finished for half an hour: sent again');
  assert.equal(r.sent, 2);
  fake.state.paused = false;
  fake.state.drain();
  r = await feedGraphiti(s, { ...opts, window: 2, now: day + 32 * 60000, dailyTokens: 20000 * 4 });
  assert.equal(r.confirmed, 2);
  assert.equal(r.stopped, 'budget', 'the day budget stops the rest');
  assert.equal(r.counts.pending, 1);
  r = await feedGraphiti(s, { ...opts, window: 2, now: day + 24 * 3600000, dailyTokens: 20000 * 4 });
  assert.deepEqual([r.sent, r.counts.done], [1, 2], 'the next day it goes on where it stopped');
  r = await feedGraphiti(s, { ...opts, now: day + 24 * 3600000 + 60000 });
  assert.deepEqual(r.counts, { pending: 0, sent: 0, done: 3, failed: 0 });
  assert.equal(new Set([...fake.state.episodes.values()].map((e) => e.group)).size, 1);
  const bodies = [...fake.state.episodes.values()].map((e) => e.args);
  assert.ok(bodies.some((x) => x.source === 'message' && /^小明: 小雨的游泳课/.test(x.episode_body) && /\n小助手: 记下了/.test(x.episode_body)));
  assert.ok(bodies.some((x) => x.source === 'text' && /^继承自 Grok的记忆（2026-10-30 导出），关于小明：/.test(x.episode_body)));
  assert.ok(bodies.every((x) => x.reference_time && !x.uuid && / · javmem [0-9a-f-]{13}$/.test(x.name)));
  s.close();

  const env = { JAVIS_BACKEND: 'graphiti', JAVIS_URL: fake.url, JAVMEM_LOCAL_DB: db, GRAPHITI_GROUP_ID: 'bot-a', MEMORY_OWNER: '小明', GRAPHITI_DAILY_TOKENS: '100000' };
  const call = (name, args) => ({ method: 'tools/call', params: { name, arguments: args } });
  const a = await session('javis-mcp.js', env, [{},
    call('search_memory', { query: '小雨 游泳课 周教练' }), call('find_sessions', { query: '深圳' }),
    call('get_conversation', { session_id: 'sess-1', limit: 2 }), { method: 'javmem/status', params: {} },
    call('get_entity', { entity_uuid: 'not-shown-before' })]);
  const t = (n) => text(a.get(n).result);
  assert.match(t(1), /^下面是 Javis 从小明以前和 AI 的对话里自动抽出来的事实/);
  assert.match(t(1), /小雨的游泳课改到每周三下午了，教练是周教练。（2026-09-14 起）（未细核）/);
  assert.match(t(1), /来源：《游泳课》（对话，对话号 sess-1）/);
  assert.match(t(2), /\[2026-10-25\] 《游泳课》（对话，对话号 sess-1） user：老陈说他 12 月调去深圳分公司了。/);
  assert.match(t(3), /#1 \[2026-09-14\] user：小雨的游泳课改到每周三下午了[\s\S]*下一页用 offset=2/);
  const st = a.get(4).result.stores[0];
  assert.deepEqual([st.state, st.backend, st.group], ['ok', 'graphiti', 'bot-a']);
  assert.match(st.detail, /^图谱里 3 段，处理中 0 段，排队 0 段；今天约用 [\d,]+ token（上限 100,000，(还剩 [\d,]+|已到上限，明天接着送)）$/);
  assert.match(t(5), /先用 search_memory 查一次/);
  // An entity id from a search, then its relations, in one process (as a Bot would ask).
  const uuid = t(1).match(/实体号：([0-9a-f-]{36})/)[1];
  const b = await session('javis-mcp.js', env, [{}, call('search_memory', { query: '游泳课' }), call('get_entity', { entity_uuid: uuid })]);
  assert.match(text(b.get(2).result), /（测试摘要）\n关系（含已失效的）：\n1\. /);
  const c = await session('memory-mcp.js', { ...env, MEMV2_URL: 'demo' }, [{}, call('search', { query: '游泳课' })]);
  assert.match(text(c.get(1).result), /游泳课/);
  assert.notEqual(c.get(1).result.isError, true);
  const down = await session('javis-mcp.js', { ...env, JAVIS_URL: `${CLOSED}/mcp/` }, [{}, { method: 'javmem/status', params: {} }]);
  assert.equal(down.get(1).result.stores[0].state, 'down');
  assert.ok(fake.state.calls.every((n) => ['tools/list', 'add_memory', 'get_episodes', 'search_memory_facts', 'get_episode_entities', 'get_status'].includes(n)));
  await fake.close();
  ok('Graphiti backend: feeder (settle, window, lost, budget, next day), four tools, status, combined server');
}

// memv2-lite (backend B) with a stand-in model: javmem-feed sends settled stretches into a Bot's namespace; the worker
// extracts facts that quote their message (made-up quotes and numbers dropped), keeps inherited facts as they are
// without a model call, uses the cheaper model on short stretches, marks the replaced fact superseded and stops at
// the day's budget; memv2-mcp.js reads it unchanged, within its token's namespaces.
if (!SQLITE) skip('memv2-lite');
else {
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  const { LocalStore } = req('../local-store.js');
  const { importPackage } = req('../inherit.js');
  const { feedMemv2 } = req('../feed.js');
  const lite = req('../memv2-lite.js');
  const { startFakeLlm } = await import('./fake-llm.mjs');
  const llm = await startFakeLlm();
  const cfg = {
    ...lite.config(), db: join(scratch, 'memv2-lite.sqlite'), llmUrl: llm.url, llmKey: 'x', model: 'quality-model',
    cheapModel: 'cheap-model', embedUrl: llm.url, embedKey: 'x', embedModel: 'emb', embedDim: 0, dailyTokens: 2200,
  };
  const ms = new lite.Store(cfg.db);
  const worker = new lite.Worker(ms, cfg);
  const server = lite.createServer(ms, cfg, null);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const writeToken = ms.addClient('feeder', { namespaces: ['bot-a', 'shared'], write: true });
  const tokA = join(scratch, 'lite-a.token');
  writeFileSync(tokA, `${ms.addClient('bot-a', { namespaces: ['bot-a', 'shared'] })}\n`);
  const tokB = join(scratch, 'lite-b.token');
  writeFileSync(tokB, `${ms.addClient('bot-b', { namespaces: ['bot-b'] })}\n`);

  const db = join(scratch, 'lite-local.sqlite');
  const s = new LocalStore(db);
  s.add({ id: 'sess-1', title: '小雨的游泳课', origin: 'session' }, [
    { seq: 1, role: 'user', time: '2026-08-30T20:11:00+08:00', text: '小雨的游泳课在每周二下午。' },
    { seq: 2, role: 'assistant', time: '2026-08-30T20:12:00+08:00', text: '好的，记下了。' },
    { seq: 3, role: 'user', time: '2026-09-14T19:02:00+08:00', text: '小雨的游泳课改到每周三下午了，教练是周教练。' },
    { seq: 4, role: 'user', time: '2026-10-02T21:30:00+08:00', text: '刚给小雨交了三个月的游泳课学费，2400 元。' },
  ], 4);
  importPackage(s, readFileSync(join(root, 'demo', 'inherit-grok.json'), 'utf8'));
  const sent = await feedMemv2(s, { url, token: writeToken, namespace: 'bot-a', owner: '小明', assistant: '小助手', now: Date.parse('2026-11-06T12:00:00+08:00') });
  assert.deepEqual([sent.sent, sent.windows], [4, 4], 'three stretches of talk (split at the long pauses) and the package');
  const again = await feedMemv2(s, { url, token: writeToken, namespace: 'bot-a', now: Date.parse('2026-11-06T13:00:00+08:00') });
  assert.equal(again.sent, 0, 'each stretch once');
  s.close();
  const s2 = new LocalStore(db);
  await assert.rejects(feedMemv2(s2, { url, token: 'wrong', namespace: 'bot-x', now: Date.parse('2026-11-06T12:00:00+08:00') }), /HTTP 401，invalid_client_token/);
  s2.close();

  await worker.run();
  assert.equal(worker.paused, 'budget', 'the day budget stops extraction');
  assert.equal(llm.state.chats, 2);
  // A restart keeps the day's count (it lives in the store), so it stays stopped; the next day it goes on.
  const again2 = new lite.Store(cfg.db);
  const restarted = new lite.Worker(again2, cfg);
  await restarted.run();
  assert.deepEqual([restarted.paused, llm.state.chats], ['budget', 2], 'a restart does not reset the budget');
  again2.close();
  cfg.now = () => Date.now() + 86400000;
  await worker.run();
  assert.equal(worker.paused, null, 'the next day it goes on where it stopped');
  assert.equal(llm.state.chats, 3, 'three stretches of talk; the inherited package needs no model');
  assert.ok(llm.state.models.every((m) => m === 'cheap-model'), 'short stretches go to the cheaper model');
  const w = ms.all('SELECT tier, kept, dropped FROM windows ORDER BY id');
  assert.deepEqual(w.map((x) => x.tier), ['direct', 'cheap', 'cheap', 'cheap'], 'the package (oldest) went first, without a model');
  assert.ok(w.slice(1).every((x) => x.dropped === 2), 'the made-up quote and the made-up number are dropped');
  const counts = ms.counts();
  assert.deepEqual([counts.items, counts.superseded, counts.windows.done], [7, 1, 4]);

  const call = (name, args) => ({ method: 'tools/call', params: { name, arguments: args } });
  const env = { MEMV2_URL: url, MEMV2_TOKEN_FILE: tokA, MEMV2_NAMESPACE: 'bot-a', MEMORY_OWNER: '小明' };
  const a = await session('memv2-mcp.js', env, [{},
    call('recall', { query: '小雨的游泳课是哪天' }), call('search', { query: '游泳课', include_superseded: true }),
    call('search_raw', { query: '周教练' }), call('read_record', { record_key: 'sess-1:3' }), { method: 'javmem/status', params: {} },
    call('search', { entity: '小雨' })]);
  const t = (n) => text(a.get(n).result);
  assert.match(t(1), /\[2026-09-14\] 小雨的游泳课改到每周三下午了，教练是周教练。 \(bot-a\)/);
  assert.ok(!/每周二下午/.test(t(1)), 'recall shows what holds now');
  assert.match(t(2), /\[2026-08-30\] 小雨的游泳课在每周二下午。 \(bot-a\)（已被后来的说法取代）/);
  assert.match(t(3), /周教练/);
  assert.match(t(4), /"record_key": "sess-1:3"/);
  assert.equal(a.get(5).result.stores[0].state, 'ok');
  assert.equal(a.get(5).result.stores[0].detail, '记录 9 条，事实 7 条（另有 1 条已被取代），排队 0 段；今天抽取用了 1,100 token（上限 2,200，还剩 1,100）');
  assert.match(t(6), /^\[2026-09-14\] [^\n]*\n\[2026-10-02\] /, 'entity search: what holds now, in time order');
  const b = await session('memv2-mcp.js', { ...env, MEMV2_TOKEN_FILE: tokB }, [{}, call('search', { query: '游泳课' })]);
  assert.match(text(b.get(1).result), /namespace_forbidden/);
  const c = await session('memv2-mcp.js', { ...env, MEMV2_TOKEN_FILE: tokB, MEMV2_NAMESPACE: '' }, [{}, call('search', { query: '游泳课' })]);
  assert.match(text(c.get(1).result), /没有找到/, 'another Bot sees nothing of bot-a');

  // Backend A: the same local store also fed to the graph; the combined server answers from both stores.
  const { feedGraphiti } = req('../feed.js');
  const { startFakeGraphiti } = await import('./fake-graphiti.mjs');
  const fake = await startFakeGraphiti();
  const s3 = new LocalStore(db);
  const fr = await feedGraphiti(s3, { url: fake.url, group: 'bot-a', owner: '小明', window: 10, now: Date.parse('2026-11-06T12:00:00+08:00') });
  assert.equal(fr.sent, 4);
  await feedGraphiti(s3, { url: fake.url, group: 'bot-a', now: Date.parse('2026-11-06T12:01:00+08:00') });
  s3.close();
  const full = { ...env, JAVIS_BACKEND: 'graphiti', JAVIS_URL: fake.url, JAVMEM_LOCAL_DB: db, GRAPHITI_GROUP_ID: 'bot-a' };
  const d = await session('memory-mcp.js', full, [{}, call('search', { query: '小雨 游泳课' }), { method: 'javmem/status', params: {} }]);
  assert.match(text(d.get(1).result), /【memv2：事实、金额以这里为准】[\s\S]*小雨的游泳课改到每周三下午了[\s\S]*【图库：人和关系、时间线】/);
  assert.deepEqual(d.get(2).result.stores.map((x) => [x.store, x.state]), [['memv2', 'ok'], ['javis', 'ok']]);
  await fake.close();
  server.close();
  ms.close();
  await llm.close();
  ok('memv2-lite: feed once, quotes checked, budget (kept over a restart, on again the next day), cheap tier, superseded, inherited without a model, per-Bot tokens; with the graph (backend A) the combined server answers from both');
}

// The install wizard and the estimate (items 13 and 17): the four choices with what they cost, the quote before
// anything is written, nothing written on a no; with a yes, each backend's files (a folder that stands alone).
if (!SQLITE) skip('setup wizard');
else {
  const { spawnSync } = await import('node:child_process');
  const { existsSync, statSync } = await import('node:fs');
  const cli = (args, input) => spawnSync(process.execPath, [join(root, 'memory-mcp.js'), ...args], { encoding: 'utf8', timeout: 60000, input });
  const est = JSON.parse(cli(['estimate', join(root, 'demo', 'inherit-grok.json'), '--json']).stdout);
  assert.deepEqual([est.messages, est.inherited, est.packages, est.stretches, est.episodes, est.tokens.memv2, est.tokens.graphiti],
    [0, 5, 1, 0, 1, 0, 20000], 'an inherited package costs the fact store nothing');
  const dir = join(scratch, 'setup');
  const no = cli(['setup', '--dir', join(dir, 'no')], 'C\n2\n\n\n500000\n小明\ntob\n\nn\n');
  assert.equal(no.status, 1);
  assert.match(no.stdout, /C     图谱（Graphiti 官方）[\s\S]*约 250 万 token/);
  assert.match(no.stdout, /报价：\n  你选了 C 图谱（Graphiti 官方），每 1,000 条消息大约花 约 250 万 token；每个 Bot 每天最多 500,000 token。/);
  assert.match(no.stdout, /没写任何文件。/);
  assert.ok(!existsSync(join(dir, 'no')), 'a no writes nothing');
  const run = (b) => cli(['setup', '--backend', b, '--models', 'openai', '--owner', '小明', '--bots', 'tob', '--dir', join(dir, b), '--yes',
    '--estimate', join(root, 'demo', 'inherit-grok.json')]);
  for (const b of ['A', 'B', 'C', 'D']) assert.equal(run(b).status, 0, `setup ${b}`);
  const cfg = (b) => JSON.parse(readFileSync(join(dir, b, 'plugin-config.json'), 'utf8'));
  assert.deepEqual(['A', 'B', 'C', 'D'].map((b) => cfg(b).backend), ['full', 'memv2', 'graphiti', 'local']);
  assert.ok(!existsSync(join(dir, 'D', '.env')), 'the local store needs no models');
  assert.match(readFileSync(join(dir, 'B', '.env'), 'utf8'), /^MODEL_NAME=gpt-6-luna$/m);
  const lite = (await import('node:module')).createRequire(import.meta.url)('../memv2-lite.js');
  const ms = new lite.Store(join(dir, 'B', 'memv2-data', 'memv2-lite.sqlite'));
  const feeder = ms.client(readFileSync(join(dir, 'B', 'tokens', 'feeder.token'), 'utf8').trim());
  const reader = ms.client(readFileSync(join(dir, 'B', 'tokens', 'reader.token'), 'utf8').trim());
  ms.close();
  assert.deepEqual([feeder.write, reader.write], [true, false]);
  assert.equal(cfg('B').backends.memv2.namespace, 'bot-{slug}');
  const compose = readFileSync(join(dir, 'A', 'docker-compose.yml'), 'utf8');
  assert.ok(compose.includes('context: ./memv2-image') && compose.includes('./graphiti-config.yaml:/app/mcp/config/config.yaml:ro'));
  assert.ok(['Dockerfile', 'memv2-lite.js', 'local-store.js', 'package.json'].every((f) => existsSync(join(dir, 'A', 'memv2-image', f))));
  assert.ok(existsSync(join(dir, 'C', 'docker-compose.yml')) && existsSync(join(dir, 'C', 'config.yaml')));
  assert.equal(cfg('C').backends.graphiti.group, 'bot-{slug}');
  if (process.platform !== 'win32') assert.equal(statSync(join(dir, 'B', '.env')).mode & 0o777, 0o600);
  ok('setup wizard: four choices with their cost, the quote first, nothing on a no, each backend\'s files; estimate counts only');
}

// scripts/eval.mjs on the demo questions: the counts it prints, and nothing but counts.
{
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'eval.mjs'), '--demo'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  const summary = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepEqual(summary.answered, { combined: 6, memv2: 5, javis: 6, either: 6 });
  assert.equal(summary.graded, 6);
  assert.deepEqual(summary.quiet, { asked: 1, keptQuiet: 1 });
  assert.equal(summary.toolErrors, 0);
  assert.equal(summary.labels.agreeWhereBothHold, 80);
  assert.ok(!/小雨|老陈|芒果/.test(r.stdout), 'eval prints counts, never answers');
  ok('eval on the demo questions: combined 6/6, memv2 5/6, Javis 6/6, counts only');
}

console.log(`${passed} checks passed${skipped ? `, ${skipped} skipped (no node:sqlite)` : ''}`);
