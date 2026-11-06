// Smoke test for memv2-mcp.js and javis-mcp.js without memv2 or Javis running: the MCP handshake, the tool lists,
// the owner name in the tool text, and the error a Bot gets when the token is missing or the service is down.
//   node test/smoke.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(join(tmpdir(), 'two-memory-mcp-'));
const CLOSED = 'http://127.0.0.1:9'; // discard port: nothing listens

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
  assert.equal(a.get(0).result.serverInfo.name.length > 0, true);
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

console.log(`${passed} checks passed`);
