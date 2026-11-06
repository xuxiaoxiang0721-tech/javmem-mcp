// How many questions each way of asking answers: the combined server (memory-mcp.js) against memv2 alone, Javis
// alone, and either of the two, plus how often the combined answers carry cross-check marks and what the labels
// file says about the two stores. It prints counts only, never an answer or any memory text.
//   node scripts/eval.mjs --demo                         the made-up demo questions on the demo data
//   node scripts/eval.mjs --questions q.json [--bots bots.json] [--env env.json]
// q.json: [{ id, bot?, question, keywords, expected?, must_not_mention? }]. expected lists right answers separated by
// |; one counts when it appears in the answers once spaces, punctuation, case and full/half width are ignored, or when
// each of its words (2+ characters) does. must_not_mention: a word that must not come up (a question memory should
// not answer). bots.json: { <bot>: { MEMV2_TOKEN_FILE, JAVIS_TOKEN_FILE, ... } }; env.json: settings for every call
// (MEMORY_LABELS_FILE, JAVIS_VERIFY_FILE, MEMV2_PURPOSE, ...). The calls are those a Bot makes: recall with the whole
// question, then search (and Javis's searches) with the keywords.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
const demo = process.argv.includes('--demo');
const questions = readJson(demo ? join(root, 'demo', 'questions.json') : arg('--questions'));
const bots = arg('--bots') ? readJson(arg('--bots')) : {};
const shared = { ...(arg('--env') ? readJson(arg('--env')) : {}), ...(demo ? { MEMV2_URL: 'demo', JAVIS_URL: 'demo' } : {}) };

/** A stdio MCP client for one server: call(tool, args) -> { text, error }. */
function open(script, env) {
  const child = spawn(process.execPath, [join(root, script)], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'ignore'] });
  const waiting = new Map();
  let buffer = '';
  let id = 0;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
      const msg = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      waiting.get(msg.id)?.(msg);
    }
  });
  const rpc = (method, params) => new Promise((resolve) => {
    id += 1;
    waiting.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const ready = rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'javmem-eval', version: '1' } })
    .then(() => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`));
  return {
    async call(name, args) {
      await ready;
      const msg = await rpc('tools/call', { name, arguments: args });
      const r = msg.result || {};
      return { text: (r.content || []).map((c) => c.text || '').join('\n'), error: !!(msg.error || r.isError) };
    },
    close: () => child.stdin.end(),
  };
}

const PUNCT = /[\s,，、。．.;；:：'"“”‘’()（）[\]【】|/\\\-–—_~!！?？]+/g;
const norm = (s) => String(s).normalize('NFKC').toLowerCase().replace(PUNCT, '');
function has(texts, expected) {
  const blob = norm(texts.join('\n'));
  return expected.split('|').filter((a) => a.trim()).some((alt) => {
    const words = alt.normalize('NFKC').toLowerCase().split(PUNCT).filter((w) => w.length >= 2);
    return blob.includes(norm(alt)) || (words.length > 0 && words.every((w) => blob.includes(norm(w))));
  });
}

const MARKS = { same: /（图库也有）|（memv2 也有）/g, differ: /（图库说法不同，以这条为准）|（和 memv2 说法不同，以 memv2 为准）/g, graphOnly: /（只在图库）/g, dropped: /另有 \d+ 条和原文对不上/g };
const answered = { combined: 0, memv2: 0, javis: 0, either: 0 };
const marks = { same: 0, differ: 0, graphOnly: 0, dropped: 0 };
let graded = 0;
let quietAsked = 0;
let quietKept = 0;
let errors = 0;
for (const q of questions) {
  const env = { ...shared, ...(q.bot ? bots[q.bot] : {}) };
  if (q.bot && !bots[q.bot]) throw new Error(`question ${q.id}: no settings for bot ${q.bot} in --bots`);
  const [m, v, j] = [open('memory-mcp.js', env), open('memv2-mcp.js', env), open('javis-mcp.js', env)];
  try {
    const [combined, memv2, javis] = await Promise.all([
      Promise.all([m.call('recall', { query: q.question }), m.call('search', { query: q.keywords, limit: 10 }),
        m.call('search_raw', { query: q.keywords, limit: 5 })]),
      Promise.all([v.call('recall', { query: q.question }), v.call('search', { query: q.keywords, limit: 10 })]),
      Promise.all([j.call('search_memory', { query: q.keywords, limit: 8 }), j.call('find_sessions', { query: q.keywords, limit: 5 })]),
    ]);
    const all = [...combined, ...memv2, ...javis];
    errors += all.filter((a) => a.error).length;
    const texts = (list) => list.map((a) => a.text);
    for (const [k, re] of Object.entries(MARKS)) marks[k] += texts(combined).join('\n').match(re)?.length || 0;
    if (q.expected) {
      graded += 1;
      const got = { combined: has(texts(combined), q.expected), memv2: has(texts(memv2), q.expected), javis: has(texts(javis), q.expected) };
      got.either = got.memv2 || got.javis;
      for (const k of Object.keys(answered)) if (got[k]) answered[k] += 1;
    }
    if (q.must_not_mention) {
      quietAsked += 1;
      if (!all.some((a) => a.text.toLowerCase().includes(String(q.must_not_mention).toLowerCase()))) quietKept += 1;
    }
  } finally {
    for (const c of [m, v, j]) c.close();
  }
}

// What the labels file (MEMORY_LABELS_FILE) says: how many facts of each store carry which label.
const labelsFile = env0('MEMORY_LABELS_FILE') || (demo ? join(root, 'demo', 'labels.json') : '');
function env0(key) { return shared[key] || process.env[key]; }
let labels = null;
if (labelsFile && existsSync(labelsFile)) {
  const d = readJson(labelsFile);
  const count = (side) => Object.values(d[side] || {}).reduce((acc, e) => ({ ...acc, [e.l]: (acc[e.l] || 0) + 1 }), {});
  labels = { memv2: count('memv2'), javis: count('javis') };
  const same = labels.memv2['两边一致'] || 0;
  const differ = labels.memv2['两边不同'] || 0;
  labels.agreeWhereBothHold = same + differ ? Math.round((1000 * same) / (same + differ)) / 10 : null;
}

const summary = { questions: questions.length, graded, answered, quiet: { asked: quietAsked, keptQuiet: quietKept }, toolErrors: errors, marks, labels };
console.log(`${questions.length} questions (${graded} with a right answer, ${quietAsked} that memory should not answer)`);
console.log(`answered: combined ${answered.combined}/${graded}, memv2 alone ${answered.memv2}/${graded}, `
  + `Javis alone ${answered.javis}/${graded}, either of the two ${answered.either}/${graded}`);
console.log(`stayed quiet: ${quietKept}/${quietAsked}; tool errors: ${errors}`);
console.log(`marks in the combined answers: both hold ${marks.same}, worded differently ${marks.differ}, graph only ${marks.graphOnly}, dropped notes ${marks.dropped}`);
if (labels) {
  console.log(`labels: memv2 ${JSON.stringify(labels.memv2)}; Javis ${JSON.stringify(labels.javis)}; `
    + `where both stores hold a fact they agree ${labels.agreeWhereBothHold}% of the time`);
}
console.log(JSON.stringify(summary));
