#!/usr/bin/env node
// javmem-inherit: bring memory over from another AI tool (Grok, Muse, Dot, ChatGPT and the like) into javmem.
// The other tool writes what it remembers as a javmem package (JSON), asked by a prompt pasted into it; this tool
// checks the package and adds it to a local store as inherited memory, marked with the tool and the export date.
//   javmem-inherit prompt [--en]                      the prompt to paste into the other tool
//   javmem-inherit check <package>                    is it usable? counts and problems only, no memory text
//   javmem-inherit import <package> --db <store>      add it to a local store; importing it again adds nothing
// A package file may hold several parts (the tool's answers pasted one after another), with or without ``` fences.
// Needs node:sqlite (Node 22.5 or later) for import.
'use strict';

const crypto = require('crypto');
const fs = require('fs');

const PROMPT_ZH = `请把你记得的、关于我的所有事整理出来。我要把它搬进另一个记忆工具（javmem），以后在那边接着用。

要求：
1. 只写你确实记得、或者在我们以前的对话里出现过的内容，不要猜，不要编。拿不准的，在 "note" 里写明哪里拿不准。
2. 一条只写一件事，写成一句完整的话，人名、数字、日期都写全。比如写「小明的女儿小雨每周三下午上游泳课」，不要写「她周三上课」。
3. 想得起时间的，写进 "when"（2026-05-01、2026-05、2026 都行）；想不起来就不写。
4. 尽量覆盖：我是谁；家人、朋友、同事；工作和项目；健康；钱和资产；喜好和习惯；计划和约定；我让你记住的事；我们一起做过的重要讨论和结论。
5. 只输出下面这种格式的 JSON，前后不要加别的话。一次写不完就分几段，每段都是完整的 JSON，"part" 写第几段；我说「继续」，你再写下一段。

{
  "javmem_inherit": 1,
  "tool": "你的名字，比如 Grok",
  "exported_at": "今天的日期，格式 YYYY-MM-DD",
  "part": 1,
  "facts": [
    { "text": "一句完整的事实", "when": "2026-05", "topic": "家人", "note": "" }
  ],
  "conversations": [
    { "title": "一段重要对话的题目", "when": "2026-10-02", "summary": "这段对话说了什么、最后定了什么" }
  ]
}`;

const PROMPT_EN = `Please gather everything you remember about me. I am moving it into another memory tool (javmem) and will keep using it there.

Rules:
1. Only what you really remember, or what came up in our past conversations. Do not guess and do not make anything up. Where you are unsure, say what is unsure in "note".
2. One thing per item, as one full sentence, with names, numbers and dates written out. Write "Alex's daughter Mia has swimming lessons on Wednesday afternoons", not "she has lessons on Wednesday".
3. Put a date in "when" when you remember it (2026-05-01, 2026-05 or 2026); otherwise leave it out.
4. Cover as much as you can: who I am; family, friends and colleagues; work and projects; health; money and assets; tastes and habits; plans and promises; things I asked you to remember; important discussions we had and what we decided.
5. Answer with JSON in exactly this form and nothing before or after it. If it does not fit in one answer, split it into parts, each a complete JSON with its "part" number; when I say "continue", write the next part.

{
  "javmem_inherit": 1,
  "tool": "your name, such as Grok",
  "exported_at": "today's date, YYYY-MM-DD",
  "part": 1,
  "facts": [
    { "text": "one full sentence", "when": "2026-05", "topic": "family", "note": "" }
  ],
  "conversations": [
    { "title": "the subject of an important conversation", "when": "2026-10-02", "summary": "what was said and what was decided" }
  ]
}`;

const DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const MAX_TEXT = 4000;

/** The JSON objects in a pasted answer: the whole text, else each top-level {...} (fences and chatter around ignored). */
function objects(text) {
  const s = String(text || '').replace(/^﻿/, '');
  try {
    const whole = JSON.parse(s);
    return Array.isArray(whole) ? whole : [whole];
  } catch { /* look inside */ }
  const out = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') { if (depth === 0) start = i; depth += 1; }
    else if (ch === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0) {
        try { out.push(JSON.parse(s.slice(start, i + 1))); } catch { /* not JSON after all */ }
      }
    }
  }
  return out;
}

/**
 * The usable part of a package file: { tool, exportedAt, facts, conversations, problems }, parts merged. problems
 * name what was skipped, by position, never by content.
 */
function parsePackage(text) {
  const problems = [];
  const parts = objects(text).filter((o) => o && typeof o === 'object' && o.javmem_inherit !== undefined);
  if (!parts.length) return { tool: '', exportedAt: '', facts: [], conversations: [], problems: ['no javmem package found (it needs "javmem_inherit": 1)'] };
  const tool = String(parts.find((p) => typeof p.tool === 'string' && p.tool.trim())?.tool || '').trim().slice(0, 40);
  const exportedAt = String(parts.find((p) => typeof p.exported_at === 'string')?.exported_at || '').trim().slice(0, 10);
  if (!tool) problems.push('no "tool" name');
  if (exportedAt && !DATE.test(exportedAt)) problems.push('"exported_at" is not a date');
  const facts = [];
  const conversations = [];
  parts.forEach((p, n) => {
    if (p.javmem_inherit !== 1) problems.push(`part ${n + 1}: javmem_inherit is not 1`);
    (Array.isArray(p.facts) ? p.facts : []).forEach((f, i) => {
      const t = f && typeof f.text === 'string' ? f.text.trim() : '';
      if (!t) { problems.push(`part ${n + 1} fact ${i + 1}: no text`); return; }
      facts.push({ text: t.slice(0, MAX_TEXT), when: typeof f.when === 'string' ? f.when.trim() : '', topic: typeof f.topic === 'string' ? f.topic.trim().slice(0, 40) : '', note: typeof f.note === 'string' ? f.note.trim().slice(0, 400) : '' });
    });
    (Array.isArray(p.conversations) ? p.conversations : []).forEach((c, i) => {
      const summary = c && typeof c.summary === 'string' ? c.summary.trim() : '';
      if (!summary) { problems.push(`part ${n + 1} conversation ${i + 1}: no summary`); return; }
      conversations.push({ title: typeof c.title === 'string' ? c.title.trim().slice(0, 80) : '', when: typeof c.when === 'string' ? c.when.trim() : '', summary: summary.slice(0, MAX_TEXT) });
    });
  });
  if (!facts.length && !conversations.length) problems.push('no facts and no conversations');
  return { tool, exportedAt, facts, conversations, problems };
}

/** The package as local-store messages: one per fact or conversation, role "fact", dated when the date is usable. */
function toMessages(pkg) {
  const out = [];
  const timeOf = (when) => (DATE.test(when) ? when : null);
  const extra = (when) => (when && !DATE.test(when) ? `（时间：${when}）` : '');
  pkg.facts.forEach((f, i) => out.push({
    seq: i + 1, role: 'fact', time: timeOf(f.when),
    text: `${f.text}${extra(f.when)}${f.topic ? `（${f.topic}）` : ''}${f.note ? `（拿不准：${f.note}）` : ''}`,
  }));
  pkg.conversations.forEach((c, i) => out.push({
    seq: 100000 + i + 1, role: 'fact', time: timeOf(c.when),
    text: `${c.title ? `【${c.title}】` : ''}${c.summary}${extra(c.when)}`,
  }));
  return out;
}

/** Adds a package to a LocalStore as one inherited session; the same file again adds nothing. */
function importPackage(store, text, { tool } = {}) {
  const pkg = parsePackage(text);
  const name = (tool || pkg.tool || 'unknown').replace(/[:\s]+/g, '_').slice(0, 40);
  const hash = crypto.createHash('sha256').update(String(text), 'utf8').digest('hex').slice(0, 16);
  const id = `inherit:${name}:${hash}`;
  if (!pkg.facts.length && !pkg.conversations.length) return { id, added: 0, pkg };
  const note = pkg.exportedAt ? `${pkg.exportedAt} 导出` : '导出日期不明';
  const added = store.add({ id, title: `${name} 的记忆`, origin: `inherited:${name}`, note }, toMessages(pkg), pkg.facts.length + pkg.conversations.length);
  store.meta(`inherited:${hash}`, new Date().toISOString());
  return { id, added, pkg };
}

function main(argv) {
  const [cmd, file] = argv;
  const flag = (n) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (cmd === 'prompt') {
    process.stdout.write(`${argv.includes('--en') ? PROMPT_EN : PROMPT_ZH}\n`);
    return 0;
  }
  if ((cmd === 'check' || cmd === 'import') && file) {
    const text = fs.readFileSync(file, 'utf8');
    if (cmd === 'check') {
      const pkg = parsePackage(text);
      process.stdout.write(`${JSON.stringify({ tool: pkg.tool, exported_at: pkg.exportedAt, facts: pkg.facts.length, conversations: pkg.conversations.length, problems: pkg.problems })}\n`);
      return pkg.facts.length || pkg.conversations.length ? 0 : 1;
    }
    const db = flag('--db');
    if (!db) { process.stderr.write('import needs --db <local store file>\n'); return 2; }
    const { LocalStore } = require('./local-store.js');
    const store = new LocalStore(db);
    try {
      const { id, added, pkg } = importPackage(store, text, { tool: flag('--tool') });
      process.stdout.write(`${JSON.stringify({ session: id, added, facts: pkg.facts.length, conversations: pkg.conversations.length, problems: pkg.problems })}\n`);
      return pkg.facts.length || pkg.conversations.length ? 0 : 1;
    } finally {
      store.close();
    }
  }
  process.stderr.write('usage: javmem-inherit prompt [--en] | check <package> | import <package> --db <store> [--tool <name>]\n');
  return 2;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { PROMPT_ZH, PROMPT_EN, parsePackage, toMessages, importPackage, objects };
