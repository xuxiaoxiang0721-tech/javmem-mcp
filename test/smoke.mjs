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

console.log(`${passed} checks passed`);
