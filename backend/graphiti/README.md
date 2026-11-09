# 图谱库（后端 C）：Graphiti 官方服务

javmem 的图谱库可以用 [Graphiti](https://github.com/getzep/graphiti) 官方的 MCP 服务（Zep 维护，Apache-2.0）。它从对话里抽出人、事和它们之间的关系，带时间，旧的说法被新的推翻时会标上失效。这里是把它跑起来的菜谱：两个 Docker 容器，都用官方镜像（Graphiti 官方服务和 Neo4j）。想少一个容器，可以选 FalkorDB（见下面「不想要 Neo4j」）。

图谱一开始是空的，只装你送进去的东西。javmem 不带任何人的记忆。

## 和本地库（后端 D）的关系

原话照旧存在 javmem 的本地库里（SQLite，装上就有）。图谱只多一样：从原话里抽出来的事实和关系。

- `javmem-feed` 把本地库里的对话一段一段送进 Graphiti（一段最多 8 条消息）。每段只送一次，记在本地库里。
- `javis-mcp.js` 设 `JAVIS_BACKEND=graphiti` 后，工具和接 Javis 时一样：`search_memory`、`get_entity` 查 Graphiti，`find_sessions`、`get_conversation` 查本地库里的原话。合起来的 `memory-mcp.js` 也照样能用。
- 每个 Bot 一个组（`GRAPHITI_GROUP_ID`），Bot 之间互相看不到：Neo4j 上所有组在同一个数据库里，查询按组过滤；FalkorDB 上每个组一个单独的图。2026-11-09 在 Neo4j 上实测，两个 Bot 都查不到对方的内容。
- 读的时候只调用 `search_memory_facts`、`get_episode_entities`、`get_status`，不改图谱。

## 花多少

Graphiti 每处理一段，要问模型好几次。2026-11-09 用 Neo4j 自测（官方服务 1.1.3、Neo4j 5.26 社区版，同样的模型和虚构数据）：9 段都进了图谱，2.3 分钟，问了模型 69 次，共 13.6 万 token，每段约 1.5 万；停掉再启动，数据还在。javmem 2026-11-06 用 FalkorDB 的自测（官方服务 1.1.3，抽取 gpt-6-luna，向量用本机的 Qwen3-Embedding-4B；数据是虚构的 23 条消息，切成 9 段）：9 段都进了图谱，3.3 分钟，问了模型 67 次，共 13.1 万 token（输入 12.7 万、输出 3,929），平均每段约 1.5 万。段越长用得越多，javmem 按每段 2 万估，折合每 1,000 条消息约 250 万 token。向量在本机算，不花钱。所以：

- `javmem-feed` 每天有上限，默认每个库每天 100 万 token（约 50 段），到了就停，第二天从停下的地方接着送。用 `--daily-tokens` 改。
- 对话停下来 30 分钟、或攒够 8 条，才切成一段送出，不会一句一送。
- 想不花钱，用本地 Ollama（第三种配法），但要好机器，也慢得多。

## 装

要 Docker，硬盘约 12 GB（官方服务的镜像约 10 GB，里面带了 GPU 用的库；Neo4j 的镜像约 1 GB，空库约 500 MB），内存 4 GB 以上（实测跑起来 Neo4j 约 1.1 GB、官方服务约 220 MB）。

```bash
cd backend/graphiti
cp .env.example .env      # 打开 .env，设一个 NEO4J_PASSWORD（至少 8 位），三种配法留一种，填上钥匙
docker compose up -d
```

三种配法（都在 `.env.example` 里）：

| 配法 | 抽取模型 | 向量模型 | 说明 |
| --- | --- | --- | --- |
| OpenAI | gpt-6-luna | text-embedding-3-small | 官方默认 |
| DeepSeek + 千问 | deepseek-chat | 阿里云百炼 text-embedding-v4 | 便宜，中文好 |
| 本地 Ollama | qwen3:14b | qwen3-embedding:0.6b | 不花钱，要好机器 |

别的 OpenAI 兼容服务也行：在 `.env` 里写 `MODEL_NAME`、`OPENAI_API_URL`、`OPENAI_API_KEY`，向量写 `EMBEDDER_*`。不是 OpenAI 官方地址时，官方服务改走 Chat Completions 接口；模型不守 JSON 格式时，加 `LLM_STRUCTURED_OUTPUT_MODE=json_object`。

注意：`EMBEDDER_DIM`（向量维数）一旦有了数据就别再改。要换向量模型，先 `docker compose down -v` 清空图谱，再重新送。

服务只开在本机：`http://127.0.0.1:8000/mcp/`（`GRAPHITI_PORT` 可改）。8000 被别的程序占了时，Docker 不一定报错，javmem 会说「那个端口上的服务要令牌」，在 `.env` 换个端口就行。官方服务没有登录，所以不要把端口开到网上。官方的使用统计已经关掉（`GRAPHITI_TELEMETRY_ENABLED=false`）。

想看图谱：浏览器打开 `http://127.0.0.1:17474`，连接地址填 `bolt://127.0.0.1:17687`，用户名 `neo4j`，密码是 `.env` 里的 `NEO4J_PASSWORD`。这两个端口只开在本机，特意不用 Neo4j 惯用的 7474、7687，免得和电脑上已有的 Neo4j 抢（`NEO4J_HTTP_PORT`、`NEO4J_BOLT_PORT` 可改）。密码只在第一次建库时生效，之后改 `.env` 不会改库里的密码。Neo4j 占多少内存也能改（`NEO4J_HEAP_MAX`、`NEO4J_PAGECACHE`，默认最多 1 GB 加 512 MB）。

**不想要 Neo4j**：`docker compose -f docker-compose.falkordb.yml up -d`，官方服务和 FalkorDB 打包在一个容器里，不用设密码，也没有上面那个看图的网页。安装向导里也能选（`--graph-store falkordb`）。工具和用法都一样。两种数据库之间不迁移数据，装之前选好。

## 送对话进去

用 DSH 插件的，在插件配置里选 `backend: graphiti`，插件会自己送。单独用的：

```bash
# 先有一个本地库：比如导入别的 AI 的记忆包（javmem-inherit），或者用 DSH 插件建的库
npx -y -p javmem-mcp javmem-feed --db ./me.sqlite --group me --owner 小明 --watch 60
```

`--watch 60` 每 60 秒送一轮；不加就只送一轮。`--status` 只看进度。它只打印条数：送了几段、图谱里几段、今天用了多少。

## 查

```bash
claude mcp add javmem-graph \
  -e JAVIS_BACKEND=graphiti -e JAVIS_URL=http://127.0.0.1:8000/mcp/ \
  -e JAVMEM_LOCAL_DB=/path/to/me.sqlite -e GRAPHITI_GROUP_ID=me -e MEMORY_OWNER=小明 \
  -- npx -y -p javmem-mcp javis-mcp
```

`javmem/status` 报图谱服务连没连上、图谱里几段、还有几段在排队。

## 已知的限制

- 官方服务没有按原话搜索的工具，所以原话一定要有本地库。
- 官方服务把要处理的段落放在内存里排队，服务重启会丢。`javmem-feed` 发现半小时没有进展就重送，最多三次。
- 事实是模型抽的，可能抽错。javis-mcp 会用规则核对（数字和人名要在原话里出现），对不上的不给 Bot 看，其余标「未细核」。
- 模型每次抽的不完全一样，也可能漏。2026-11-09 用同一段虚构对话反复测「游泳课从周二改到周三」这一处：Neo4j 上 4 次记下 2 次，FalkorDB 上 6 次都记下了（含 11-06 的 2 次）。对比了记下的那两次，发给模型的内容只差空白（两个官方镜像的差别），另外 2 次没留底，没能对比；次数也太少，还不能说是数据库的原因。漏了的原话还在本地库；用全套（后端 A）时事实库也会记。
- 官方服务第一次连上 Neo4j 时，日志里会有几十行 `EquivalentSchemaRuleAlreadyExists` 错误：它同时建索引时撞了车，索引都建好了（实测全部 ONLINE），可以不管。

---

## English

javmem's graph store can be the official [Graphiti](https://github.com/getzep/graphiti) MCP server (Zep, Apache-2.0) with Neo4j: two containers from their makers' images. The graph starts empty and holds only what you send in.

- The original words stay in javmem's local store; `javmem-feed` sends them to Graphiti in episodes of up to 8 messages, each once, within a daily token budget (default 1,000,000 per store and day). Measured 2026-11-06 (official server 1.1.3, gpt-6-luna, local Qwen3-Embedding-4B, 23 made-up messages in 9 episodes): all 9 in the graph in 3.3 minutes, 67 model calls, 131,000 tokens, about 15,000 per episode; javmem counts 20,000 per episode, roughly 2.5 million tokens per 1,000 messages.
- `javis-mcp.js` with `JAVIS_BACKEND=graphiti` keeps its four tools: facts and entities from Graphiti, the original words from the local store. One Graphiti group per Bot (`GRAPHITI_GROUP_ID`): on Neo4j all groups share one database and queries filter by group; measured 2026-11-09, two Bots could not find each other's words.
- Setup: `cp .env.example .env`, set `NEO4J_PASSWORD` (at least 8 characters; it only takes effect when the database is first created), keep one of the three model blocks (OpenAI; DeepSeek with Qwen embeddings; local Ollama), `docker compose up -d`. Needs about 12 GB of disk and 4 GB of memory (running, Neo4j used about 1.1 GB and the server about 220 MB). The endpoint is `http://127.0.0.1:8000/mcp/`, on this computer only; the official server has no login. Do not change `EMBEDDER_DIM` once there is data.
- To look at the graph: `http://127.0.0.1:17474`, connect to `bolt://127.0.0.1:17687`, user `neo4j`. The ports avoid Neo4j's usual 7474 and 7687 so that a Neo4j already on the computer is left alone (`NEO4J_HTTP_PORT`, `NEO4J_BOLT_PORT`).
- Without Neo4j: `docker compose -f docker-compose.falkordb.yml up -d` puts the server and FalkorDB in one container, no password, no such web page; the wizard offers it too (`--graph-store falkordb`). Same tools. Data does not move between the two, so choose before you start.
- Measured 2026-11-09 on Neo4j (official server 1.1.3, Neo4j 5.26 community, the same models and data): all 9 episodes in, 2.3 minutes, 69 model calls, 136,000 tokens, about 15,000 per episode; the data survived a stop and start.
- Known limits: no search over the original words in the official server (hence the local store); its queue is in memory, so `javmem-feed` resends what made no progress for half an hour (three tries). The model's extraction varies between runs and can miss things: on 2026-11-09 one made-up conversation (swimming lessons moved from Tuesday to Wednesday) kept that change in 2 of 4 runs on Neo4j and 6 of 6 on FalkorDB. In the two runs compared, what the model was sent differed only in whitespace (the two official images differ there); the 2 misses were not recorded, and the runs are too few to blame the database. On first connecting to Neo4j the official server logs a few dozen `EquivalentSchemaRuleAlreadyExists` errors from building indexes at once; the indexes are fine.
