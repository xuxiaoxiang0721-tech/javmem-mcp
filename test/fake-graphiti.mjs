// A stand-in for the official Graphiti MCP server, for tests: Streamable HTTP at /mcp/ (/mcp redirects there), a
// session id from the handshake, answers as SSE, and the tools javmem uses. "Extraction" is a word list: each name
// from NAMES in an episode becomes a node, and a line naming two of them becomes a fact between them.
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const NAMES = ['小明', '小雨', '老陈', '周教练', '深圳', '游泳课', '芒果', '樱花', '日本'];

function grams(text) {
  const s = String(text || '').toLowerCase();
  const out = new Set(s.match(/[a-z0-9]+/g) || []);
  for (const run of s.match(/[一-鿿]+/g) || []) {
    if (run.length === 1) out.add(run);
    for (let i = 0; i + 1 < run.length; i += 1) out.add(run.slice(i, i + 2));
  }
  return out;
}

const id = (...parts) => {
  const h = createHash('sha256').update(parts.join('\n')).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

export async function startFakeGraphiti() {
  const sessions = new Set();
  const state = {
    paused: false, // queued episodes wait (as if the model were slow)
    queue: [], // { group, args }
    episodes: new Map(), // uuid -> { group, args, nodes: [uuid], edges: [uuid] }
    nodes: new Map(), // uuid -> node
    edges: new Map(), // uuid -> edge
    calls: [],
  };

  function process(group, args, uuid) {
    // As the real server: a uuid names an episode it already has, to process again; an unknown one fails.
    if (args.uuid && !state.episodes.has(args.uuid)) return;
    const found = new Set();
    const edges = [];
    for (const line of String(args.episode_body).split('\n')) {
      const names = NAMES.filter((n) => line.includes(n));
      names.forEach((n) => found.add(n));
      if (names.length >= 2) {
        const fact = line.replace(/^[^:：]{1,20}[:：]\s*/, '').replace(/^- /, '').slice(0, 120);
        const e = {
          uuid: id(group, uuid, line), group_id: group, name: 'MENTIONS_WITH', fact,
          source_node_uuid: id(group, names[0]), target_node_uuid: id(group, names[1]),
          created_at: new Date().toISOString(), valid_at: args.reference_time || null, invalid_at: null, expired_at: null,
          episodes: [uuid], attributes: {},
        };
        state.edges.set(e.uuid, e);
        edges.push(e.uuid);
      }
    }
    for (const n of found) {
      const u = id(group, n);
      if (!state.nodes.has(u)) {
        state.nodes.set(u, { uuid: u, name: n, labels: ['Entity'], summary: `${n}（测试摘要）`, group_id: group, attributes: {} });
      }
    }
    state.episodes.set(uuid, { uuid, group, args, nodes: [...found].map((n) => id(group, n)), edges });
  }

  state.drain = () => {
    while (state.queue.length) {
      const { group, args } = state.queue.shift();
      process(group, args, args.uuid || randomUUID());
    }
  };
  state.lose = () => { state.queue = []; };
  state.restart = () => { sessions.clear(); state.queue = []; };

  const tools = {
    add_memory(a) {
      const group = a.group_id || 'main';
      state.queue.push({ group, args: { ...a } });
      if (!state.paused) state.drain();
      return { structured: { message: `Episode '${a.name}' queued for processing in group '${group}'` } };
    },
    get_episodes(a) {
      const groups = new Set(a.group_ids || ['main']);
      const list = [...state.episodes.values()].filter((e) => groups.has(e.group))
        .sort((x, y) => (x.uuid < y.uuid ? 1 : -1)).slice(0, a.max_episodes || 10)
        .map((e) => ({ uuid: e.uuid, name: e.args.name, content: e.args.episode_body, created_at: new Date().toISOString(),
          source: e.args.source, source_description: e.args.source_description, group_id: e.group }));
      return { structured: { message: 'Episodes retrieved successfully', episodes: list } };
    },
    search_memory_facts(a) {
      const groups = new Set(a.group_ids || ['main']);
      const q = grams(a.query);
      const list = [...state.edges.values()].filter((e) => groups.has(e.group_id))
        .map((e) => [[...grams(e.fact)].filter((g) => q.has(g)).length, e]).filter(([n]) => n > 0)
        .sort((x, y) => y[0] - x[0]).slice(0, a.max_facts || 10).map(([, e]) => e);
      return { structured: { message: 'Facts retrieved successfully', facts: list } };
    },
    get_episode_entities(a) {
      const nodes = new Map();
      const edges = new Map();
      for (const u of a.episode_uuids || []) {
        const ep = state.episodes.get(u);
        if (!ep || ep.group !== (a.group_id || 'main')) continue;
        ep.nodes.forEach((n) => nodes.set(n, state.nodes.get(n)));
        ep.edges.forEach((e) => edges.set(e, state.edges.get(e)));
      }
      // Text only, no structured part: the other way FastMCP answers.
      return { text: { message: 'Retrieved provenance', nodes: [...nodes.values()], edges: [...edges.values()] } };
    },
    get_status() {
      return { structured: { result: { status: 'ok', message: 'Graphiti MCP server is running and connected to falkordb database' } } };
    },
  };

  const server = createServer((req, res) => {
    if (req.url === '/mcp') {
      res.writeHead(307, { Location: '/mcp/' });
      res.end();
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const sid = req.headers['mcp-session-id'];
      if (msg.method === 'initialize') {
        const nsid = randomUUID().replace(/-/g, '');
        sessions.add(nsid);
        sse(res, { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'Graphiti Agent Memory', version: '1.0.0' } } }, { 'mcp-session-id': nsid });
        return;
      }
      if (!sid) { res.writeHead(400); res.end('Bad Request: Missing session ID'); return; }
      if (!sessions.has(sid)) { res.writeHead(404); res.end('Session not found'); return; }
      if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
      state.calls.push(msg.method === 'tools/call' ? msg.params.name : msg.method);
      if (msg.method === 'tools/list') {
        sse(res, { jsonrpc: '2.0', id: msg.id, result: { tools: Object.keys(tools).map((name) => ({ name, inputSchema: { type: 'object' } })) } });
        return;
      }
      const tool = tools[msg.params && msg.params.name];
      if (!tool) { sse(res, { jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'Unknown tool' } }); return; }
      const out = tool(msg.params.arguments || {});
      const data = out.structured || out.text;
      sse(res, {
        jsonrpc: '2.0', id: msg.id,
        result: { content: [{ type: 'text', text: JSON.stringify(data) }], ...(out.structured ? { structuredContent: out.structured } : {}), isError: false },
      });
    });
  });

  function sse(res, message, headers = {}) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', ...headers });
    // A notification first, as a real server may send; the client must pick the answer by its id.
    res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', data: 'x' } })}\n\n`);
    res.end(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
  }

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}/mcp`, state, close: () => new Promise((r) => server.close(r)) };
}
