// The five combined tools on the made-up demo data (MEMV2_URL=demo, JAVIS_URL=demo), one question each, printed as
// a Bot would see them. Nothing to install and no token; every person and conversation in demo/ is fictional.
//   node scripts/demo.mjs [tool]   (tool = recall | search | search_raw | person | read; default all five)
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const QUESTIONS = [
  ['recall', { query: '小雨的游泳课' }],
  ['search', { query: '游泳课 学费' }],
  ['search_raw', { query: '千岛湖' }],
  ['person', { name: '老陈' }],
  ['read', { record_key: 'demo-s1-5' }],
];

/** Ask the combined server on the demo data; resolves with [tool, args, text] for each question. */
export function ask(questions = QUESTIONS, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, 'memory-mcp.js')], {
      env: { ...process.env, MEMV2_URL: 'demo', JAVIS_URL: 'demo', ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
    const answers = new Map();
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const msg = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (msg.id > 0) answers.set(msg.id, msg.result);
        if (answers.size === questions.length) {
          child.stdin.end();
          resolve(questions.map(([tool, args], n) => [tool, args, (answers.get(n + 1).content || []).map((c) => c.text).join('\n')]));
        }
      }
    });
    child.on('error', reject);
    const send = (m) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
    send({ id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'demo', version: '1' } } });
    send({ method: 'notifications/initialized' });
    questions.forEach(([name, args], n) => send({ id: n + 1, method: 'tools/call', params: { name, arguments: args } }));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const only = process.argv[2];
  for (const [tool, args, text] of await ask(QUESTIONS.filter(([t]) => !only || t === only))) {
    console.log(`\n=== ${tool} ${JSON.stringify(args)}\n${text}`);
  }
}
