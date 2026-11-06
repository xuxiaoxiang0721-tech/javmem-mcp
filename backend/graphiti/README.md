# 图谱库（后端 C）：Graphiti 官方服务

javmem 的图谱库可以用 [Graphiti](https://github.com/getzep/graphiti) 官方的 MCP 服务（Zep 维护，Apache-2.0）。它从对话里抽出人、事和它们之间的关系，带时间，旧的说法被新的推翻时会标上失效。这里是把它跑起来的菜谱：一个 Docker 容器，里面是官方镜像（Graphiti MCP 服务加 FalkorDB 图数据库）。

图谱一开始是空的，只装你送进去的东西。javmem 不带任何人的记忆。

## 和本地库（后端 D）的关系

原话照旧存在 javmem 的本地库里（SQLite，装上就有）。图谱只多一样：从原话里抽出来的事实和关系。

- `javmem-feed` 把本地库里的对话一段一段送进 Graphiti（一段最多 8 条消息）。每段只送一次，记在本地库里。
- `javis-mcp.js` 设 `JAVIS_BACKEND=graphiti` 后，工具和接 Javis 时一样：`search_memory`、`get_entity` 查 Graphiti，`find_sessions`、`get_conversation` 查本地库里的原话。合起来的 `memory-mcp.js` 也照样能用。
- 每个 Bot 一个组（`GRAPHITI_GROUP_ID`），官方服务把每个组放在单独的图里，Bot 之间互相看不到。
- 读的时候只调用 `search_memory_facts`、`get_episode_entities`、`get_status`，不改图谱。

## 花多少

Graphiti 每处理一段，要问模型好几次。javmem 2026-11-06 的自测（官方服务 1.1.3，抽取 gpt-6-luna，向量用本机的 Qwen3-Embedding-4B；数据是虚构的 23 条消息，切成 9 段）：9 段都进了图谱，3.3 分钟，问了模型 67 次，共 13.1 万 token（输入 12.7 万、输出 3,929），平均每段约 1.5 万。段越长用得越多，javmem 按每段 2 万估，折合每 1,000 条消息约 250 万 token。向量在本机算，不花钱。所以：

- `javmem-feed` 每天有上限，默认每个库每天 100 万 token（约 50 段），到了就停，第二天从停下的地方接着送。用 `--daily-tokens` 改。
- 对话停下来 30 分钟、或攒够 8 条，才切成一段送出，不会一句一送。
- 想不花钱，用本地 Ollama（第三种配法），但要好机器，也慢得多。

## 装

要 Docker。镜像约 11 GB（官方镜像里带了 GPU 用的库），内存 4 GB 以上。

```bash
cd backend/graphiti
cp .env.example .env      # 打开 .env，三种配法留一种，填上钥匙
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

---

## English

javmem's graph store can be the official [Graphiti](https://github.com/getzep/graphiti) MCP server (Zep, Apache-2.0): one container from Zep's image, Graphiti plus FalkorDB. The graph starts empty and holds only what you send in.

- The original words stay in javmem's local store; `javmem-feed` sends them to Graphiti in episodes of up to 8 messages, each once, within a daily token budget (default 1,000,000 per store and day). Measured 2026-11-06 (official server 1.1.3, gpt-6-luna, local Qwen3-Embedding-4B, 23 made-up messages in 9 episodes): all 9 in the graph in 3.3 minutes, 67 model calls, 131,000 tokens, about 15,000 per episode; javmem counts 20,000 per episode, roughly 2.5 million tokens per 1,000 messages.
- `javis-mcp.js` with `JAVIS_BACKEND=graphiti` keeps its four tools: facts and entities from Graphiti, the original words from the local store. One Graphiti group per Bot (`GRAPHITI_GROUP_ID`).
- Setup: `cp .env.example .env`, keep one of the three model blocks (OpenAI; DeepSeek with Qwen embeddings; local Ollama), `docker compose up -d`. The endpoint is `http://127.0.0.1:8000/mcp/`, on this computer only; the official server has no login. Do not change `EMBEDDER_DIM` once there is data.
- Known limits: no search over the original words in the official server (hence the local store); its queue is in memory, so `javmem-feed` resends what made no progress for half an hour (three tries).
