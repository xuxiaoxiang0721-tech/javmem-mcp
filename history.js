// history.js: original conversations exported from other AI tools, taken into javmem's local store in one pass
// (javmem-inherit history). Unlike an export prompt's package, which holds what an AI recalls about you, these are
// the conversations themselves: who said what, when, about whom. Once they are in the local store, the fact store
// and the graph (javmem-feed, or the DSH plugin) extract from them, so people, things, times and places link up.
// Formats (found by looking at the file):
//   chatgpt      ChatGPT's data export, conversations.json (the main branch of each conversation)
//   claude       Claude's data export, conversations.json
//   claude-code  Claude Code's session logs, ~/.claude/projects/<project>/<session>.jsonl
//   codex        Codex CLI's session logs, ~/.codex/sessions/<y>/<m>/<d>/rollout-*.jsonl
//   grok12       memory packages, schema 1.2 (memory-package.json, raw_records), as some Bot exporters write them
// Only what a person typed and what the AI answered goes in; tool calls, tool results, system text and injected
// context stay out. Each conversation is a session "history:<tool>:<id>"; importing the same export again adds
// nothing, and a longer export of the same conversation adds only the new messages. Reports counts, never text.
'use strict';

const fs = require('fs');
const path = require('path');

const TOOLS = { chatgpt: 'ChatGPT', claude: 'Claude', 'claude-code': 'Claude Code', codex: 'Codex', grok12: 'Grok' };

const iso = (t) => {
  if (t == null || t === '') return null;
  const ms = typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : Date.parse(t);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};
const textOf = (parts) => parts.filter((p) => typeof p === 'string').join('\n').trim();

// ---- ChatGPT: [{ title, create_time, mapping: { id: { message, parent } }, current_node, conversation_id }] ----

function chatgpt(data) {
  return data.filter((c) => c && c.mapping).map((c) => {
    // The branch the conversation ended on, from its last node back to the root.
    const chain = [];
    const seen = new Set();
    let node = c.current_node || Object.keys(c.mapping).pop();
    while (node && c.mapping[node] && !seen.has(node)) {
      seen.add(node);
      chain.push(c.mapping[node]);
      node = c.mapping[node].parent;
    }
    chain.reverse();
    const messages = [];
    for (const n of chain) {
      const m = n.message;
      const role = m && m.author && m.author.role;
      if (!m || !['user', 'assistant'].includes(role)) continue;
      if (m.metadata && (m.metadata.is_visually_hidden_from_conversation || m.metadata.is_user_system_message)) continue;
      const content = m.content || {};
      if (!['text', 'multimodal_text'].includes(content.content_type || 'text')) continue;
      const text = textOf(Array.isArray(content.parts) ? content.parts : []);
      if (text) messages.push({ seq: messages.length + 1, role, time: iso(m.create_time), text });
    }
    return { id: String(c.conversation_id || c.id || c.title || ''), title: c.title || null, messages };
  });
}

// ---- Claude: [{ uuid, name, chat_messages: [{ sender, text, content, created_at }] }] ----

function claude(data) {
  return data.filter((c) => c && Array.isArray(c.chat_messages)).map((c) => {
    const messages = [];
    for (const m of c.chat_messages) {
      const role = m.sender === 'human' ? 'user' : (m.sender === 'assistant' ? 'assistant' : null);
      if (!role) continue;
      const blocks = Array.isArray(m.content) ? m.content.filter((b) => b && b.type === 'text').map((b) => b.text) : [];
      const text = (blocks.length ? textOf(blocks) : String(m.text || '')).trim();
      if (text) messages.push({ seq: messages.length + 1, role, time: iso(m.created_at), text });
    }
    return { id: String(c.uuid || c.name || ''), title: c.name || null, messages };
  });
}

// ---- Claude Code: one JSON object per line, { type, message: { role, content }, timestamp, sessionId } ----

const INJECTED = /^\s*(<(command-|local-command|system-reminder|user-prompt-submit-hook|environment_context|user_instructions|permissions)|Caveat: )/;

function claudeCode(lines) {
  const bySession = new Map();
  let summary = null; // a summary line carries no sessionId; it names the file's conversation
  lines.forEach((l, i) => {
    if (l && l.type === 'summary' && l.summary && !summary) summary = String(l.summary).slice(0, 120);
    if (!l || !l.sessionId) return;
    if (!bySession.has(l.sessionId)) bySession.set(l.sessionId, { id: l.sessionId, title: null, messages: [] });
    const s = bySession.get(l.sessionId);
    if (!['user', 'assistant'].includes(l.type) || !l.message || l.isMeta || l.isSidechain) return;
    const c = l.message.content;
    const blocks = typeof c === 'string' ? [c] : (Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text) : []);
    const text = textOf(blocks);
    if (!text || INJECTED.test(text)) return;
    s.messages.push({ seq: i + 1, role: l.type, time: iso(l.timestamp), text });
  });
  for (const s of bySession.values()) {
    if (!s.title) s.title = (bySession.size === 1 && summary) || (s.messages.length ? s.messages[0].text.slice(0, 40) : null);
  }
  return [...bySession.values()];
}

// ---- Codex: { timestamp, type: 'session_meta' | 'response_item' | ..., payload } per line (older logs: the item) ----

function codex(lines, file) {
  let id = null;
  const messages = [];
  lines.forEach((l, i) => {
    if (!l) return;
    if (l.type === 'session_meta' && l.payload && l.payload.id) id = l.payload.id;
    const item = l.type === 'response_item' ? l.payload : (l.type === 'message' ? l : null);
    if (!item || item.type !== 'message' || !['user', 'assistant'].includes(item.role)) return;
    const text = textOf((Array.isArray(item.content) ? item.content : [])
      .filter((b) => b && ['input_text', 'output_text', 'text'].includes(b.type)).map((b) => b.text));
    if (!text || INJECTED.test(text)) return;
    messages.push({ seq: i + 1, role: item.role, time: iso(l.timestamp), text });
  });
  const name = path.basename(file || 'codex').replace(/\.jsonl$/, '');
  return [{ id: String(id || name), title: messages.length ? messages[0].text.slice(0, 40) : name, messages }];
}

// ---- Memory package 1.2: { schema_version, source, continuity: { stream_id }, raw_records: [...] } ----

function grok12(data) {
  const stream = (data.continuity && data.continuity.stream_id) || (data.source && data.source.session_id) || data.package_id;
  const messages = [];
  for (const r of data.raw_records || []) {
    if (!r || !['user', 'assistant'].includes(r.role) || (r.content_type && r.content_type !== 'message')) continue;
    if (r.operation && r.operation !== 'append') continue;
    const text = String(r.text || '').trim();
    if (!text) continue;
    // Packages of one stream each count from 1, so the order key is the time with the sequence as a tiebreak.
    const ms = Date.parse(r.occurred_at || '');
    const seq = Number.isFinite(ms) ? ms * 1000 + (Number(r.sequence) % 1000) : Number(r.sequence) || messages.length + 1;
    messages.push({ seq, role: r.role, time: iso(r.occurred_at), text });
  }
  const tool = (data.source && data.source.source_tool) || 'grok';
  return { tool: /grok/i.test(tool) ? 'Grok' : String(tool), conversations: [{ id: String(stream || ''), title: null, messages }] };
}

/** What a file holds: { format, tool, conversations } or null when it is none of the formats. */
function readExport(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  let json;
  try { json = JSON.parse(raw); } catch { json = undefined; }
  if (json !== undefined) {
    if (Array.isArray(json) && json.some((c) => c && c.mapping)) return { format: 'chatgpt', tool: TOOLS.chatgpt, conversations: chatgpt(json) };
    if (Array.isArray(json) && json.some((c) => c && Array.isArray(c.chat_messages))) return { format: 'claude', tool: TOOLS.claude, conversations: claude(json) };
    if (json && typeof json === 'object' && /^1\./.test(String(json.schema_version || '')) && Array.isArray(json.raw_records)) {
      const g = grok12(json);
      return { format: 'grok12', tool: g.tool, conversations: g.conversations };
    }
    return null;
  }
  const lines = raw.split(/\r?\n/).map((l) => { try { return l.trim() ? JSON.parse(l) : null; } catch { return null; } });
  const objs = lines.filter(Boolean);
  if (!objs.length) return null;
  if (objs.some((l) => l.sessionId && ['user', 'assistant'].includes(l.type) && l.message)) {
    return { format: 'claude-code', tool: TOOLS['claude-code'], conversations: claudeCode(lines) };
  }
  if (objs.some((l) => l.type === 'session_meta' || (l.type === 'response_item' && l.payload) || (l.type === 'message' && l.role))) {
    return { format: 'codex', tool: TOOLS.codex, conversations: codex(lines, file) };
  }
  return null;
}

/** The export files at a path: the file itself, or every .json/.jsonl below a folder. */
function exportFiles(target) {
  if (!fs.statSync(target).isDirectory()) return [target];
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(json|jsonl)$/i.test(e.name)) out.push(p);
    }
  };
  walk(target);
  return out.sort();
}

const keyOf = (tool) => String(tool).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tool';

/** Adds one export's conversations to a LocalStore. Returns counts: { format, tool, conversations, messages, added }. */
function importExport(store, file, found = readExport(file)) {
  if (!found) return null;
  let messages = 0;
  let added = 0;
  let conversations = 0;
  for (const c of found.conversations) {
    if (!c.messages.length || !c.id) continue;
    conversations += 1;
    messages += c.messages.length;
    const day = (c.messages.find((m) => m.time) || {}).time;
    added += store.add({
      id: `history:${keyOf(found.tool)}:${c.id}`, title: c.title || `${found.tool} 的对话`, origin: `history:${found.tool}`,
      note: `${found.tool} 导出${day ? `，始于 ${day.slice(0, 10)}` : ''}`,
    }, c.messages, c.messages.length);
  }
  return { format: found.format, tool: found.tool, conversations, messages, added };
}

/** Every export at a path, summed per tool: { files, skipped, byTool: { tool: { conversations, messages, added } } }. */
function importPath(store, target) {
  const out = { files: 0, skipped: 0, byTool: {} };
  for (const f of exportFiles(target)) {
    let r = null;
    try { r = importExport(store, f); } catch { r = null; }
    if (!r) { out.skipped += 1; continue; }
    out.files += 1;
    const t = out.byTool[r.tool] || (out.byTool[r.tool] = { format: r.format, conversations: 0, messages: 0, added: 0 });
    t.conversations += r.conversations;
    t.messages += r.messages;
    t.added += r.added;
  }
  return out;
}

/** Counts only, without a store: what importing the path would bring in. */
function checkPath(target) {
  const out = { files: 0, skipped: 0, byTool: {} };
  for (const f of exportFiles(target)) {
    let r = null;
    try { r = readExport(f); } catch { r = null; }
    if (!r) { out.skipped += 1; continue; }
    out.files += 1;
    const t = out.byTool[r.tool] || (out.byTool[r.tool] = { format: r.format, conversations: 0, messages: 0 });
    for (const c of r.conversations) {
      if (!c.messages.length) continue;
      t.conversations += 1;
      t.messages += c.messages.length;
    }
  }
  return out;
}

module.exports = { readExport, importExport, importPath, checkPath, exportFiles, TOOLS };
