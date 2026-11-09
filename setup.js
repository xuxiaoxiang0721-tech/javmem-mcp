#!/usr/bin/env node
// setup.js: javmem's install wizard and cost estimate (npx -y javmem-mcp setup | estimate <path>).
//   setup     asks which backend (D local store, B fact store, C graph, A both), which models, how many tokens a day,
//             shows what it will cost before anything is written, and only writes the files on a yes: the model
//             settings (.env), the compose files a backend needs, the memv2-lite store with its tokens, and the
//             config for the DSH plugin and for Claude Code. It starts nothing and sends nothing anywhere.
//   estimate  counts what a local store or javmem packages hold and what extracting them would cost per backend.
// Non-interactive: setup --backend A|B|C|D [--models openai|deepseek|ollama] [--graph-store neo4j|falkordb] [--bots a,b]
//                  [--owner name] [--daily-tokens N] [--dir folder] [--estimate path] --yes
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { LocalStore } = require('./local-store.js');
const { importPackage } = require('./inherit.js');
const { segments, DEFAULTS } = require('./feed.js');

const VERSION = (() => {
  try { return String(require('./package.json').version || 'unknown'); } catch { return 'unknown'; }
})();

// Measured 2026-11-06 with gpt-6-luna and a local embedding model on made-up conversations (see the backend READMEs).
const RATES = {
  memv2: { base: 1000, perMessage: 300 }, // one call per stretch: about 1,600 tokens for 2-3 messages
  graphiti: { perEpisode: DEFAULTS.tokensPerSegment }, // what javmem-feed counts per episode: 20,000
};

const BACKENDS = {
  D: { key: 'local', name: '本地库', what: '原话，按词搜（中文也行）', per1000: '0（不花钱）', needs: '什么都不用装' },
  B: { key: 'memv2', name: '事实库（memv2 精简版）', what: 'D 加上抽出来的事实，分得清新旧', per1000: '约 60 万 token', needs: 'Node 22.5 以上，不用 Docker' },
  C: { key: 'graphiti', name: '图谱（Graphiti 官方）', what: 'D 加上人和事的关系、时间线', per1000: '约 250 万 token', needs: 'Docker，约 12 GB 硬盘' },
  A: { key: 'full', name: '全套（事实库加图谱）', what: 'B 加 C，两个库对照着回答', per1000: '约 310 万 token', needs: 'Docker，约 12 GB 硬盘' },
};

const MODELS = {
  openai: {
    label: 'OpenAI（gpt-6-luna，质量好，默认）',
    env: { MODEL_NAME: 'gpt-6-luna', OPENAI_API_URL: 'https://api.openai.com/v1', EMBEDDER_MODEL: 'text-embedding-3-small', EMBEDDER_DIM: '1536', EMBEDDER_API_URL: 'https://api.openai.com/v1' },
    sameKey: true,
  },
  deepseek: {
    label: 'DeepSeek 抽取 + 千问（阿里云百炼）向量（便宜，中文好）',
    env: { MODEL_NAME: 'deepseek-chat', OPENAI_API_URL: 'https://api.deepseek.com/v1', LLM_STRUCTURED_OUTPUT_MODE: 'json_object', EMBEDDER_MODEL: 'text-embedding-v4', EMBEDDER_DIM: '1024', EMBEDDER_API_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
    sameKey: false,
  },
  ollama: {
    label: '本机 Ollama（不花钱，要好机器，慢）',
    env: { MODEL_NAME: 'qwen3:14b', OPENAI_API_KEY: 'ollama', LLM_STRUCTURED_OUTPUT_MODE: 'json_object', EMBEDDER_MODEL: 'qwen3-embedding:0.6b', EMBEDDER_DIM: '1024', EMBEDDER_API_KEY: 'ollama', SEMAPHORE_LIMIT: '1' },
    local: true,
  },
};

// The graph database behind Graphiti (backends C and A).
const GRAPH_STORES = {
  neo4j: { label: 'Neo4j（默认）：两个容器，有网页可以看图，官方配置给它最多约 1.5 GB 内存', compose: 'docker-compose.yml' },
  falkordb: { label: 'FalkorDB：和官方服务打包在一个容器里，少一个容器，没有 Neo4j 那个看图的网页', compose: 'docker-compose.falkordb.yml' },
};

const fmt = (n) => Math.round(n).toLocaleString('en-US');

// ---- Estimate ----

/** A local store to count: the file itself, or a fresh one in memory holding the packages found at the path. */
function storeFor(target) {
  if (/\.sqlite$/i.test(target) && fs.existsSync(target)) return { store: new LocalStore(target, { readonly: true }), packages: 0 };
  const store = new LocalStore(':memory:');
  const files = fs.statSync(target).isDirectory()
    ? fs.readdirSync(target).filter((f) => /\.(json|jsonl|txt|md)$/i.test(f)).map((f) => path.join(target, f))
    : [target];
  let packages = 0;
  const history = require('./history.js');
  for (const f of files) {
    try {
      // An export of original conversations (ChatGPT, Claude, ...) first, else a javmem package.
      if (history.importExport(store, f)) continue;
      const r = importPackage(store, fs.readFileSync(f, 'utf8'));
      if (r.added) packages += 1;
    } catch { /* neither */ }
  }
  return { store, packages };
}

/** What extracting a store's contents would cost: counts and tokens per backend, no text. */
function estimate(target, { dailyTokens = DEFAULTS.dailyTokens } = {}) {
  const { store, packages } = storeFor(target);
  try {
    const rows = store.unfed('estimate', '', 1000000);
    const segs = segments(rows, { now: Number.MAX_SAFE_INTEGER });
    const talk = segs.filter((s) => s[0].role !== 'fact');
    const facts = rows.filter((r) => r.role === 'fact').length;
    const memv2 = talk.reduce((n, s) => n + RATES.memv2.base + RATES.memv2.perMessage * s.length, 0);
    const graphiti = segs.length * RATES.graphiti.perEpisode;
    const days = (t) => (dailyTokens ? Math.max(1, Math.ceil(t / dailyTokens)) : 1);
    return {
      messages: rows.length - facts, inherited: facts, packages, stretches: talk.length, episodes: segs.length,
      tokens: { local: 0, memv2, graphiti, full: memv2 + graphiti },
      days: { memv2: memv2 ? days(memv2) : 0, graphiti: graphiti ? days(graphiti) : 0 },
      dailyTokens,
    };
  } finally {
    store.close();
  }
}

function estimateText(e) {
  return [
    `对话消息 ${fmt(e.messages)} 条，继承来的事实 ${fmt(e.inherited)} 条${e.packages ? `（${e.packages} 个包）` : ''}。`,
    `D 本地库：不花钱。`,
    `B 事实库：${fmt(e.stretches)} 段要问模型（继承的事实不用），约 ${fmt(e.tokens.memv2)} token${e.days.memv2 > 1 ? `，按每天 ${fmt(e.dailyTokens)} 的上限要 ${e.days.memv2} 天抽完` : ''}。`,
    `C 图谱：${fmt(e.episodes)} 段，约 ${fmt(e.tokens.graphiti)} token${e.days.graphiti > 1 ? `，按每天 ${fmt(e.dailyTokens)} 的上限要 ${e.days.graphiti} 天送完` : ''}。`,
    `A 全套：约 ${fmt(e.tokens.full)} token。`,
    '（按 2026-11-06 用 gpt-6-luna 实测的用量估算；换了模型、对话长短不同，会有出入。）',
  ].join('\n');
}

// ---- Files ----

const HERE = __dirname;
const write = (file, text, mode) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.replace(/\r\n/g, '\n'), mode ? { mode } : undefined);
};
const copy = (from, to, edit = (t) => t) => write(to, edit(fs.readFileSync(path.join(HERE, from), 'utf8')));

function envText(models, keys, extra) {
  const m = MODELS[models];
  const lines = ['# javmem 的模型设置（安装向导写的）。钥匙只在这台电脑上，不要发给别人。'];
  const env = { ...m.env };
  if (m.local) {
    // Ollama as the full set's own container, on this computer seen from the graph's container, or seen directly.
    env.OPENAI_API_URL = { full: 'http://ollama:11434/v1', graphiti: 'http://host.docker.internal:11434/v1' }[extra.backend]
      || 'http://127.0.0.1:11434/v1';
    env.EMBEDDER_API_URL = env.OPENAI_API_URL;
  }
  if (!m.local) {
    env.OPENAI_API_KEY = keys.llm || '在这里填抽取模型的钥匙';
    env.EMBEDDER_API_KEY = (m.sameKey ? keys.llm : keys.embed) || '在这里填向量模型的钥匙';
  }
  env.MEMV2_DAILY_TOKENS = String(extra.dailyTokens);
  // Neo4j's password stays in this file; nothing prints it.
  if (extra.neo4jPassword) env.NEO4J_PASSWORD = extra.neo4jPassword;
  if (extra.ports) Object.assign(env, extra.ports);
  for (const [k, v] of Object.entries(env)) lines.push(`${k}=${v}`);
  return `${lines.join('\n')}\n`;
}

/** Writes everything a backend needs into dir; returns the plugin config and what to do next. */
function writeFiles(dir, o) {
  const b = BACKENDS[o.backend].key;
  const abs = path.resolve(dir);
  const steps = [];
  const bots = o.bots.length ? o.bots : ['<Bot 名字或编号>'];
  const plugin = { mode: 'on', backend: b, env: { MEMORY_OWNER: o.owner }, bots: Object.fromEntries(bots.map((x) => [x, {}])) };
  const memv2Url = 'http://127.0.0.1:8766';
  const graphUrl = 'http://127.0.0.1:8000/mcp/';
  const docker = b === 'graphiti' || b === 'full';
  const graphStore = GRAPH_STORES[o.graphStore] ? o.graphStore : 'neo4j';
  const neo4j = docker && graphStore === 'neo4j';
  if (b !== 'local') {
    write(path.join(abs, '.env'), envText(o.models, o.keys, {
      dailyTokens: o.dailyTokens, backend: b, neo4jPassword: neo4j ? crypto.randomBytes(16).toString('hex') : '',
    }), 0o600);
  }

  if (b === 'memv2' || b === 'full') {
    // The fact store's tokens: a writable one for the plugin's feeder and a read-only one for the Bots. Each Bot reads
    // only its own namespace (bot-<id>, set by the plugin; the tools take no namespace), plus the shared one.
    const tokens = path.join(abs, 'tokens');
    const db = path.join(abs, 'memv2-data', 'memv2-lite.sqlite');
    if (b === 'memv2') {
      const lite = require('./memv2-lite.js');
      const store = new lite.Store(db);
      write(path.join(tokens, 'feeder.token'), `${store.addClient('feeder', { write: true })}\n`, 0o600);
      write(path.join(tokens, 'reader.token'), `${store.addClient('reader')}\n`, 0o600);
      store.close();
      write(path.join(abs, 'start-memv2.sh'), `#!/bin/sh\n# 启动 javmem 的事实库（memv2 精简版）。\ncd "$(dirname "$0")"\nexec npx -y -p javmem-mcp@${VERSION} javmem-memv2 serve --env .env --db memv2-data/memv2-lite.sqlite\n`, 0o755);
      write(path.join(abs, 'start-memv2.cmd'), `@echo off\r\nrem 启动 javmem 的事实库（memv2 精简版）。\r\ncd /d "%~dp0"\r\nnpx -y -p javmem-mcp@${VERSION} javmem-memv2 serve --env .env --db memv2-data\\memv2-lite.sqlite\r\n`);
      steps.push(`启动事实库：${process.platform === 'win32' ? path.join(abs, 'start-memv2.cmd') : path.join(abs, 'start-memv2.sh')}（开着别关；要开机自启，交给系统的计划任务或服务）。`);
    } else {
      fs.mkdirSync(tokens, { recursive: true });
      steps.push(`起来以后建两把令牌（在 ${abs} 里运行）：docker compose exec -T memv2 node memv2-lite.js token add feeder --write > tokens/feeder.token；`
        + 'docker compose exec -T memv2 node memv2-lite.js token add reader > tokens/reader.token。');
    }
    plugin.backends = { ...(plugin.backends || {}), memv2: { url: memv2Url, writeTokenFile: path.join(tokens, 'feeder.token'), tokenFile: path.join(tokens, 'reader.token'), namespace: 'bot-{slug}' } };
  }
  // Whichever graph database was chosen, the folder holds it as docker-compose.yml, so the commands are the same.
  const composeFile = GRAPH_STORES[graphStore].compose;
  if (b === 'graphiti') {
    copy(`backend/graphiti/${composeFile}`, path.join(abs, 'docker-compose.yml'));
    copy('backend/graphiti/config.yaml', path.join(abs, 'config.yaml'));
  }
  if (b === 'full') {
    // A folder that stands alone: the compose's paths point into it, not into this package.
    copy(`backend/full/${composeFile}`, path.join(abs, 'docker-compose.yml'), (t) => t
      .replace('context: ../..', 'context: ./memv2-image').replace('dockerfile: backend/memv2/Dockerfile', 'dockerfile: Dockerfile')
      .replace('../graphiti/config.yaml', './graphiti-config.yaml'));
    copy('backend/graphiti/config.yaml', path.join(abs, 'graphiti-config.yaml'));
    for (const f of ['memv2-lite.js', 'local-store.js', 'package.json']) copy(f, path.join(abs, 'memv2-image', f));
    copy('backend/memv2/Dockerfile', path.join(abs, 'memv2-image', 'Dockerfile'));
  }
  if (docker) {
    steps.push(`启动${b === 'full' ? '两个库' : '图谱'}：在 ${abs} 里运行 docker compose ${MODELS[o.models].local && b === 'full' ? '--profile local ' : ''}up -d${b === 'full' ? ' --build' : ''}（第一次要下载约 11 GB 的官方镜像）。`);
    if (neo4j) steps.push('想看图谱：浏览器打开 http://127.0.0.1:17474，连接地址填 bolt://127.0.0.1:17687，用户名 neo4j，密码在 .env 的 NEO4J_PASSWORD 里。');
    // Graphiti takes letters, digits, - and _ in a group id, so the group goes by the Bot's id.
    plugin.backends = { ...(plugin.backends || {}), graphiti: { url: graphUrl, group: 'bot-{slug}', dailyTokens: o.dailyTokens } };
  }
  if (MODELS[o.models] && MODELS[o.models].local && b !== 'local' && !(b === 'full')) {
    steps.push(`装 Ollama 并下载模型：ollama pull ${MODELS.ollama.env.MODEL_NAME}，ollama pull ${MODELS.ollama.env.EMBEDDER_MODEL}。`);
  }
  write(path.join(abs, 'plugin-config.json'), `${JSON.stringify(plugin, null, 2)}\n`);
  steps.push(`DSH 插件：把 ${path.join(abs, 'plugin-config.json')} 设成 javmem-dsh-plugin 的 configFile（或把内容抄进插件配置），bots 里写上要有记忆的 Bot，再开新会话。`);
  return { dir: abs, plugin, steps };
}

// ---- Wizard ----

/** Answers from stdin in order, typed or piped (readline's question() drops lines that arrive before it asks). */
function lineReader(input) {
  const rl = readline.createInterface({ input });
  const lines = [];
  const waiting = [];
  let closed = false;
  rl.on('line', (l) => (waiting.length ? waiting.shift()(l) : lines.push(l)));
  rl.on('close', () => {
    closed = true;
    while (waiting.length) waiting.shift()(null);
  });
  return {
    next: () => (lines.length ? Promise.resolve(lines.shift()) : (closed ? Promise.resolve(null) : new Promise((r) => waiting.push(r)))),
    close: () => rl.close(),
  };
}

async function ask(reader, q, fallback = '') {
  process.stdout.write(q);
  const a = await reader.next();
  if (a === null) process.stdout.write('\n');
  return String(a || '').trim() || fallback;
}

function table() {
  return [
    '  选项  后端                    记什么                              每 1,000 条消息大约花   要装什么',
    ...Object.entries(BACKENDS).map(([k, v]) => `  ${k}     ${v.name.padEnd(18, '　')} ${v.what.padEnd(20, '　')} ${v.per1000.padEnd(14, ' ')} ${v.needs}`),
    '  （花费按 2026-11-06 用 gpt-6-luna 实测估算；本地 Ollama 不花钱，但慢、要好机器。）',
  ].join('\n');
}

async function wizard(argv) {
  const flag = (n, d) => {
    const i = argv.indexOf(n);
    return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
  };
  const yes = argv.includes('--yes');
  const rl = yes ? null : lineReader(process.stdin);
  const q = (text, d) => (yes ? Promise.resolve(d) : ask(rl, text, d));
  const out = (t) => process.stdout.write(`${t}\n`);
  try {
    out(`javmem ${VERSION} 安装向导。下面四种后端选一种，以后可以再换。\n`);
    out(table());
    let backend = String(await q('\n选哪一个？[D]：', flag('--backend', 'D'))).toUpperCase();
    if (!BACKENDS[backend]) backend = 'D';
    let models = flag('--models', 'openai');
    const keys = { llm: flag('--llm-key', ''), embed: flag('--embed-key', '') };
    let dailyTokens = Number(flag('--daily-tokens', DEFAULTS.dailyTokens));
    if (backend !== 'D') {
      out('\n抽取用哪种模型？个人用的数据量不大，默认选质量好的。');
      const names = Object.keys(MODELS);
      names.forEach((m, i) => out(`  ${i + 1} ${MODELS[m].label}`));
      out('  两档的差别（2026-11-06 在同样 23 条虚构消息上比的事实库）：gpt-6-luna 记下 21 条，认出了 2 处前后变化；'
        + '本机千问（qwen3.8-27b，关掉深度思考）也记下 21 条，但只认出 1 处，不花钱、更快。');
      const pick = await q(`选 1-${names.length} [${names.indexOf(models) + 1}]：`, String(names.indexOf(models) + 1));
      models = names[Number(pick) - 1] || models;
      if (!MODELS[models].local && !yes) {
        keys.llm = await q('抽取模型的钥匙（留空就稍后自己填进 .env）：', '');
        if (!MODELS[models].sameKey) keys.embed = await q('向量模型的钥匙（留空就稍后填）：', '');
      }
      const d = await q(`每个 Bot 每天最多花多少 token？到了就停，第二天接着抽 [${dailyTokens}]：`, String(dailyTokens));
      dailyTokens = Number.isFinite(Number(d)) && Number(d) >= 0 ? Number(d) : dailyTokens;
    }
    let graphStore = GRAPH_STORES[flag('--graph-store')] ? flag('--graph-store') : 'neo4j';
    if (backend === 'C' || backend === 'A') {
      out('\n图谱放在哪种图数据库里？');
      const stores = Object.keys(GRAPH_STORES);
      stores.forEach((s, i) => out(`  ${i + 1} ${GRAPH_STORES[s].label}`));
      const pick = await q(`选 1-${stores.length} [${stores.indexOf(graphStore) + 1}]：`, String(stores.indexOf(graphStore) + 1));
      graphStore = stores[Number(pick) - 1] || graphStore;
    }
    const owner = await q('记忆是谁的？工具里这样称呼他 [用户]：', flag('--owner', '用户'));
    const bots = String(await q('哪些 Bot 要有记忆？名字或编号，逗号隔开（可留空，以后在配置里加）：', flag('--bots', '')))
      .split(',').map((x) => x.trim()).filter(Boolean);
    // The quote before anything is written (item 17).
    out('\n报价：');
    out(`  你选了 ${backend} ${BACKENDS[backend].name}，每 1,000 条消息${BACKENDS[backend].per1000 === '0（不花钱）' ? '不花钱' : `大约花 ${BACKENDS[backend].per1000}`}；`
      + `${backend === 'D' ? '' : `每个 Bot 每天最多 ${fmt(dailyTokens)} token。`}`);
    const history = flag('--estimate', yes ? '' : await q('有要一次导入的历史吗？给本地库文件或继承包（文件或文件夹）路径，可留空：', ''));
    if (history) {
      try {
        out(estimateText(estimate(history, { dailyTokens })).split('\n').map((l) => `  ${l}`).join('\n'));
      } catch (err) {
        out(`  估算不了：${err.message}`);
      }
    }
    const dir = flag('--dir', path.resolve('javmem'));
    const go = String(await q(`\n照这样把配置写进 ${dir}？[Y/n]：`, 'y')).toLowerCase();
    if (!['y', 'yes', '是', '好'].includes(go)) {
      out('没写任何文件。');
      return 1;
    }
    const r = writeFiles(dir, { backend, models, keys, dailyTokens, owner, bots, graphStore });
    out(`\n写好了：${r.dir}`);
    r.steps.forEach((s, i) => out(`  ${i + 1}. ${s}`));
    out('\n接 Claude Code 的写法见 README「接到 Claude Code」；各后端的说明在包里的 backend/ 文件夹。');
    return 0;
  } finally {
    if (rl) rl.close();
  }
}

function main(argv) {
  const [cmd, target] = argv;
  if (cmd === 'estimate') {
    if (!target || !fs.existsSync(target)) {
      process.stderr.write('用法：javmem-mcp estimate <本地库 .sqlite | 继承包文件 | 放包的文件夹> [--daily-tokens N]\n');
      return Promise.resolve(2);
    }
    const i = argv.indexOf('--daily-tokens');
    const e = estimate(target, { dailyTokens: i >= 0 ? Number(argv[i + 1]) : DEFAULTS.dailyTokens });
    process.stdout.write(`${argv.includes('--json') ? JSON.stringify(e) : estimateText(e)}\n`);
    return Promise.resolve(0);
  }
  if (cmd === 'setup') return wizard(argv.slice(1));
  process.stdout.write('用法：javmem-mcp setup [--backend A|B|C|D …] | javmem-mcp estimate <路径>\n');
  return Promise.resolve(2);
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

module.exports = { estimate, estimateText, writeFiles, wizard, main, BACKENDS, MODELS, RATES, GRAPH_STORES };
