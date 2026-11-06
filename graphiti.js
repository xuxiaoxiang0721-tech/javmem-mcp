// graphiti.js: the official Graphiti MCP server (github.com/getzep/graphiti, folder mcp_server) as javmem's graph
// store, in place of Javis. Two parts:
//   - GraphitiClient: a small MCP client for that server (Streamable HTTP with a session id, answers as JSON or SSE);
//     the feeder (feed.js) uses it to send conversations in, javis-mcp.js to read;
//   - createBackend(): answers javis-mcp.js's requests (search_memory, get_entity, find_sessions, get_conversation,
//     get_episodes, tools/list) in the shapes Javis uses, so every tool and the combined server work unchanged
//     (JAVIS_BACKEND=graphiti).
// Graphiti keeps the graph (people, things, the facts between them, with times). The conversations stay in javmem's
// local store (JAVMEM_LOCAL_DB): the official server has no search over the original words, so find_sessions and
// get_conversation read the local store, and its episodes table (written by the feeder) says which conversation each
// Graphiti episode came from. Towards Graphiti, reading only calls search_memory_facts, get_episode_entities,
// get_status and tools/list; each Bot reads one group (GRAPHITI_GROUP_ID), which the official server keeps in a
// graph of its own.
'use strict';

const crypto = require('crypto');
const http = require('http');
const https = require('https');

const PROTOCOL = '2025-06-18';
// Own agents, so an HTTP_PROXY that a host hands to child processes never applies.
const AGENTS = { 'http:': new http.Agent({ keepAlive: false }), 'https:': new https.Agent({ keepAlive: false }) };
const DEFAULT_URL = 'http://127.0.0.1:8000/mcp/';

/** An error whose message can go to the model as it is (Chinese, no internals). */
class GraphError extends Error {
  constructor(message, status) {
    super(message);
    if (status) this.status = status;
  }
}

function clip(value, n = 200) {
  const s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// The JSON-RPC answer with this id: a JSON body, or an SSE stream of JSON-RPC messages (notifications may come first).
function parseAnswer(text, contentType, id) {
  if (!String(contentType || '').includes('text/event-stream')) {
    try { return JSON.parse(text); } catch { return null; }
  }
  let last = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    try {
      const msg = JSON.parse(line.slice(5));
      if (msg && msg.id === id) return msg;
      if (msg && ('result' in msg || 'error' in msg)) last = msg;
    } catch { /* not JSON */ }
  }
  return last;
}

class GraphitiClient {
  /** url: the server's MCP endpoint; token: optional function giving a Bearer token (for a proxy in front). */
  constructor(url = DEFAULT_URL, { token = null, version = 'unknown' } = {}) {
    this.url = new URL(url);
    this.token = token;
    this.version = version;
    this.sid = null;
    this.protocol = null;
    this.ready = null;
    this.nextId = 1;
  }

  get where() {
    return this.url.host;
  }

  post(payload, timeoutMs, url = this.url, hops = 0) {
    return new Promise((resolve, reject) => {
      const body = Buffer.from(JSON.stringify(payload), 'utf8');
      const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'Content-Length': body.length,
      };
      if (this.sid) headers['Mcp-Session-Id'] = this.sid;
      if (this.protocol) headers['MCP-Protocol-Version'] = this.protocol;
      const token = this.token ? this.token() : null;
      if (token) headers.Authorization = `Bearer ${token}`;
      const lib = url.protocol === 'https:' ? https : http;
      const req = lib.request({
        agent: AGENTS[url.protocol], method: 'POST', timeout: timeoutMs, headers,
        host: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80), path: url.pathname + url.search,
      }, (res) => {
        // /mcp answers with a redirect to /mcp/: follow it, and keep using the new address.
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && hops < 2) {
          res.resume();
          const next = new URL(res.headers.location, url);
          this.url = next;
          this.post(payload, timeoutMs, next, hops + 1).then(resolve, reject);
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      });
      req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
      req.on('error', (err) => reject(err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'EHOSTUNREACH'
        ? new GraphError(`图谱服务没在运行（${url.host} 连不上）。`)
        : new GraphError(err.code === 'ETIMEDOUT' ? '等图谱服务回应超时，缩小范围再查。' : `连图谱服务出错：${err.message}`)));
      req.end(body);
    });
  }

  answer(r, id) {
    if (r.status === 401 || r.status === 403) {
      throw new GraphError(`${this.url.host} 上的服务要令牌，拒绝了连接：可能那个端口被别的程序占了（官方 Graphiti 服务不要令牌），`
        + '或者前面有要令牌的代理（用 JAVIS_TOKEN_FILE 给它令牌）。', r.status);
    }
    const msg = parseAnswer(r.text, r.headers['content-type'], id);
    if (!msg || typeof msg !== 'object') {
      throw new GraphError(`图谱服务返回了看不懂的结果（HTTP ${r.status}）。`, r.status >= 400 ? r.status : undefined);
    }
    if (msg.error) throw new GraphError(`图谱服务报错：${clip(msg.error.message || '原因不明')}`, r.status >= 400 ? r.status : undefined);
    return msg.result || {};
  }

  async open(timeoutMs) {
    this.sid = null;
    this.protocol = null;
    const id = this.nextId++;
    const r = await this.post({
      jsonrpc: '2.0', id, method: 'initialize',
      params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'javmem', version: this.version } },
    }, timeoutMs);
    const result = this.answer(r, id);
    this.sid = r.headers['mcp-session-id'] || null;
    this.protocol = result.protocolVersion || PROTOCOL;
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, timeoutMs);
  }

  /** One request; shakes hands first, and once more if the server was restarted and forgot the session. */
  async request(method, params = {}, timeoutMs = 30000) {
    for (let attempt = 0; ; attempt += 1) {
      if (!this.ready) {
        this.ready = this.open(Math.min(timeoutMs, 15000)).catch((err) => {
          this.ready = null;
          throw err;
        });
      }
      await this.ready;
      const id = this.nextId++;
      const r = await this.post({ jsonrpc: '2.0', id, method, params }, timeoutMs);
      if (attempt === 0 && this.sid && (r.status === 404 || (r.status === 400 && /session/i.test(r.text)))) {
        this.ready = null;
        continue;
      }
      return this.answer(r, id);
    }
  }

  /** A tool's data. The official server reports failures as {error} inside a normal answer. */
  async tool(name, args, timeoutMs = 60000) {
    const result = await this.request('tools/call', { name, arguments: args }, timeoutMs);
    const text = (result.content || []).filter((c) => c && c.type === 'text').map((c) => c.text).join('\n');
    if (result.isError) throw new GraphError(`图谱服务报错：${clip(text.replace(/^Error executing tool \S+: /, '')) || '原因不明'}`);
    let data = result.structuredContent;
    if (data && typeof data === 'object' && Object.keys(data).length === 1 && data.result && typeof data.result === 'object') {
      data = data.result;
    }
    if (!data || typeof data !== 'object') {
      try { data = JSON.parse(text); } catch { data = null; }
    }
    if (!data || typeof data !== 'object') throw new GraphError('图谱服务返回了看不懂的结果。');
    if (data.error) throw new GraphError(`图谱服务报错：${clip(data.error)}`);
    return data;
  }
}

/** The id an episode gets in Graphiti: the same stretch of the same conversation always gets the same id. */
function episodeId(group, session, from, to) {
  const h = crypto.createHash('sha256').update(`javmem\n${group}\n${session}\n${from}\n${to}`, 'utf8').digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** What a conversation's source is called in tool results: its own conversations, or the tool it was inherited from. */
function provider(origin) {
  const o = String(origin || '');
  if (o.startsWith('inherited:')) return `继承自 ${o.slice('inherited:'.length)}`;
  if (o.startsWith('history:')) return `导入自 ${o.slice('history:'.length)}`;
  return '对话';
}

const factOf = (e) => ({
  uuid: e.uuid, fact: e.fact, name: e.name, source_node_uuid: e.source_node_uuid, target_node_uuid: e.target_node_uuid,
  valid_at: e.valid_at || null, invalid_at: e.invalid_at || null, expired_at: e.expired_at || null,
  episodes: Array.isArray(e.episodes) ? e.episodes : [],
});

/**
 * javis-mcp.js's backend for the official Graphiti server: answer(method, params) gives what Javis's MCP endpoint
 * would (a tools/list result, or a tools/call result with the data as JSON text). openStore() gives the local store
 * (read-only); group is the Bot's Graphiti group.
 */
function createBackend({ url = DEFAULT_URL, group = 'main', openStore, token = null, version = 'unknown' }) {
  const client = new GraphitiClient(url, { token, version });
  // Entity ids shown in this process -> the episodes of the facts they were shown with. The official server finds an
  // entity only through an episode that mentions it, so get_entity starts there.
  const known = new Map();

  function remember(facts) {
    for (const f of facts) {
      for (const node of [f.source_node_uuid, f.target_node_uuid]) {
        if (!node) continue;
        if (!known.has(node)) known.set(node, new Set());
        for (const ep of f.episodes) known.get(node).add(ep);
      }
    }
    // Plenty for one conversation; drop the oldest beyond that.
    while (known.size > 5000) known.delete(known.keys().next().value);
  }

  function sourcesOf(facts) {
    const ids = [...new Set(facts.flatMap((f) => f.episodes))];
    const rows = new Map(openStore().episodeSessions(ids).map((r) => [r.uuid, r]));
    return ids.map((id) => {
      const r = rows.get(id);
      return { episode_uuid: id, sessions: r ? [{ id: r.session, title: r.title || '', provider: provider(r.origin) }] : [] };
    });
  }

  const tools = {
    async search_memory({ query, limit = 8, include_history = false }) {
      const data = await client.tool('search_memory_facts', {
        query: String(query || ''), group_ids: [group], max_facts: Math.min(50, Math.max(1, Number(limit) || 8)),
      });
      let facts = (data.facts || []).map(factOf);
      if (!include_history) facts = facts.filter((f) => !f.invalid_at && !f.expired_at);
      remember(facts);
      return { facts, sources: sourcesOf(facts) };
    },

    async get_entity({ entity_uuid, limit = 15 }) {
      const uuid = String(entity_uuid || '');
      // The episodes it was found in (the feeder records them), and those of the facts shown with it in this process.
      const eps = [...new Set([...openStore().nodeEpisodes(uuid, 10), ...(known.get(uuid) || [])])];
      if (!eps.length) {
        throw new GraphError('这个实体号不是这次查到的：先用 search_memory 查一次，再用新结果里的实体号。');
      }
      const got = await client.tool('get_episode_entities', { episode_uuids: eps.slice(0, 10), group_id: group });
      const nodes = new Map((got.nodes || []).map((n) => [n.uuid, n]));
      const node = nodes.get(uuid);
      if (!node) throw new GraphError('图谱里找不到这个实体了（可能已经合并或删掉）。用 search_memory 再查一次。');
      const touches = (e) => e.source_node_uuid === uuid || e.target_node_uuid === uuid;
      const edges = new Map();
      for (const e of got.edges || []) if (touches(e)) edges.set(e.uuid, factOf(e));
      // Its other relations: facts about it, ranked by how close they are to it in the graph.
      try {
        const more = await client.tool('search_memory_facts', {
          query: String(node.name || ''), group_ids: [group], max_facts: 50, center_node_uuid: uuid,
        });
        for (const e of more.facts || []) if (touches(e) && !edges.has(e.uuid)) edges.set(e.uuid, factOf(e));
      } catch { /* the relations from its own episodes are still there */ }
      const other = (f) => (f.source_node_uuid === uuid ? f.target_node_uuid : f.source_node_uuid);
      const facts = [...edges.values()]
        .sort((a, b) => String(b.valid_at || '').localeCompare(String(a.valid_at || '')))
        .slice(0, Math.max(1, Number(limit) || 15));
      remember(facts);
      // Names of the other side that the first answer did not have.
      const unnamed = facts.filter((f) => !nodes.has(other(f)));
      if (unnamed.length) {
        try {
          const more = await client.tool('get_episode_entities', {
            episode_uuids: [...new Set(unnamed.flatMap((f) => f.episodes))].slice(0, 10), group_id: group,
          });
          for (const n of more.nodes || []) if (!nodes.has(n.uuid)) nodes.set(n.uuid, n);
        } catch { /* shown without a name */ }
      }
      return {
        entity: { uuid, name: node.name, summary: node.summary },
        facts: facts.map((f) => ({ ...f, other_entity: { uuid: other(f), name: (nodes.get(other(f)) || {}).name || '' } })),
        sources: sourcesOf(facts),
      };
    },

    async find_sessions({ query, limit = 8 }) {
      const store = openStore();
      const n = Math.max(1, Number(limit) || 8);
      const rows = [];
      const seen = new Set();
      const add = (list) => {
        for (const r of list) if (!seen.has(r.id) && rows.length < n) { seen.add(r.id); rows.push(r); }
      };
      add(store.literal(query, { limit: n }));
      if (rows.length < n) add(store.search(query, { limit: n, all: true }));
      if (!rows.length) add(store.search(query, { limit: n }));
      return {
        matches: rows.map((r) => ({
          session_id: r.session, title: r.title || '', provider: provider(r.origin), role: r.role, timestamp: r.time,
          excerpt: String(r.text || '').slice(0, 600),
        })),
      };
    },

    async get_conversation({ session_id, offset = 0, limit = 6 }) {
      const p = openStore().page(String(session_id || ''), Math.max(0, Number(offset) || 0), Math.max(1, Number(limit) || 6));
      if (!p) throw new GraphError('没有这个对话号。');
      const s = p.session;
      return {
        session: { id: s.id, title: s.title || '', provider: provider(s.origin), first_time: s.first_time, last_time: s.last_time },
        messages: p.messages.map((m) => ({ role: m.role, timestamp: m.time, content: m.text })),
        next_offset: p.next,
      };
    },

    async get_episodes({ episode_uuids = [] }) {
      return { episodes: openStore().episodeTexts(Array.isArray(episode_uuids) ? episode_uuids : []) };
    },
  };

  async function answer(method, params = {}, timeoutMs = 60000) {
    if (method === 'tools/list') return client.request('tools/list', {}, timeoutMs);
    if (method !== 'tools/call') throw new GraphError(`Method not found: ${method}`);
    const tool = tools[params.name];
    if (!tool) return { isError: true, content: [{ type: 'text', text: `没有这个工具：${params.name}` }] };
    try {
      return { content: [{ type: 'text', text: JSON.stringify(await tool(params.arguments || {})) }] };
    } catch (err) {
      const message = err instanceof GraphError || err.user ? err.message : `出错了：${err.message}`;
      return { isError: true, content: [{ type: 'text', text: message }] };
    }
  }

  /** For javmem/status: is the server up and its database reachable, and how far the feeder has got. */
  async function status(timeoutMs = 5000) {
    const data = await client.tool('get_status', {}, timeoutMs);
    return { ok: data.status === 'ok', message: clip(data.message || '', 160) };
  }

  return { answer, status, client, group };
}

module.exports = { GraphitiClient, GraphError, createBackend, episodeId, provider, parseAnswer, DEFAULT_URL };
