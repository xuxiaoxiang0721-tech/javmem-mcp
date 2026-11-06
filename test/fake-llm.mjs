// A stand-in OpenAI-compatible model service for tests: /v1/chat/completions answers memv2-lite's extraction prompt
// by rule (every sentence of an event that names someone from NAMES becomes an item quoting itself; "周三" replaces an
// old memory that says "周二"), plus one item with a made-up quote and one with a made-up number, which memv2-lite
// must drop. /v1/embeddings gives small vectors from character pairs. Every call reports 1,100 tokens.
import { createServer } from 'node:http';

const NAMES = ['小明', '小雨', '老陈', '周教练', '深圳', '游泳课', '芒果'];

function vector(text) {
  const v = new Array(32).fill(0);
  const s = String(text || '');
  for (let i = 0; i + 1 < s.length; i += 1) v[(s.charCodeAt(i) * 31 + s.charCodeAt(i + 1)) % 32] += 1;
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

function extract(prompt) {
  const old = [...prompt.matchAll(/^O(\d+) \[[^\]]*\] (.*)$/gm)].map((m) => ({ n: Number(m[1]), fact: m[2] }));
  const events = [...prompt.matchAll(/^\[E(\d+)\][^\n]*\n<<<\n([\s\S]*?)\n>>>/gm)].map((m) => ({ n: Number(m[1]), text: m[2] }));
  const items = [];
  for (const e of events) {
    for (const sentence of e.text.split(/(?<=[。！？])/).map((x) => x.trim()).filter(Boolean)) {
      const names = NAMES.filter((x) => sentence.includes(x));
      if (!names.length) continue;
      const replaces = sentence.includes('周三') ? old.filter((o) => o.fact.includes('周二')).map((o) => `O${o.n}`) : [];
      items.push({ statement: sentence, kind: 'fact', time_text: null, evidence: [{ event: e.n, quote: sentence }], entities: names, replaces });
    }
  }
  if (events.length) {
    items.push({ statement: '小明说过一句没有的话。', kind: 'fact', evidence: [{ event: 1, quote: '这句话原文里没有。' }], entities: [] });
    items.push({ statement: `${events[0].text.slice(0, 6)}，花了 9999 元。`, kind: 'fact', evidence: [{ event: 1, quote: events[0].text.slice(0, 6) }], entities: [] });
  }
  return { items };
}

export async function startFakeLlm() {
  const state = { chats: 0, embeds: 0, models: [] };
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const send = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/v1/chat/completions') {
        state.chats += 1;
        state.models.push(body.model);
        const user = (body.messages || []).find((m) => m.role === 'user');
        send({ choices: [{ message: { role: 'assistant', content: JSON.stringify(extract(user ? user.content : '')) } }],
          usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 } });
        return;
      }
      if (req.url === '/v1/embeddings') {
        state.embeds += 1;
        const input = Array.isArray(body.input) ? body.input : [body.input];
        send({ object: 'list', model: body.model, data: input.map((t, i) => ({ object: 'embedding', index: i, embedding: vector(t) })),
          usage: { prompt_tokens: 5, total_tokens: 5 } });
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/v1`, state, close: () => new Promise((r) => server.close(r)) };
}
