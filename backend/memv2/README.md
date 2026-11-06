# 事实库（后端 B）：memv2 精简版

memv2 是 javmem 的事实库：把对话里值得记住的事一条条抽出来，每条都带原话出处，后来的说法推翻了旧的，旧的标「已被取代」。原版 memv2 没有公开，这里是公开的精简版 `memv2-lite.js`（命令 `javmem-memv2`）：同样的读接口，`memv2-mcp.js` 和合起来的 `memory-mcp.js` 不用改就能查；一个 Node 程序加一个 SQLite 文件，没有别的依赖，不要 GPU。

库一开始是空的，只装你送进去的东西。

## 它怎么记

- **原话都留着**：每条消息存成一条记录，可以逐字搜（中文按两字一组建索引）。
- **抽事实**：一段对话（最多 8 条消息）问一次模型，要它列出值得记住的事，每条都要从某条消息里**逐字**抄一句当证据。抄的那句在原消息里找不到、或者事实里有证据里没有的数字，这条就丢掉，不给 Bot 看。
- **新旧分开**：抽的时候把相关的旧事实一起给模型看；新的说法推翻了旧的，旧的标「已被取代」。`recall` 只给现在还成立的，`search` 加 `include_superseded` 能看到以前的说法。
- **继承来的记忆**（`javmem-inherit` 导入的、别的 AI 记得的事）本来就是一条条事实，直接存，不问模型，不花钱。
- **按意思搜**：设了向量模型（`EMBEDDER_*`），事实按意思也能搜到；不设就只按词搜。
- **分区和令牌**：每个 Bot 一个分区（namespace），各用自己的只读令牌，只看得到自己的分区和共用区（shared）；送对话进来的程序用一个可写令牌。令牌只存哈希。

## 花多少

一段对话问一次模型，用多少按模型自己报的算。每天有上限 `MEMV2_DAILY_TOKENS`（默认 100 万），到了就停，第二天接着抽。另可设一个便宜模型 `MEMV2_MODEL_CHEAP`，只用在短的段落上（不超过 1,600 字、4 条消息）。

**实测**（2026-11-06；抽取 gpt-6-luna，推理强度用默认；向量用本机的 Qwen3-Embedding-4B；数据是虚构的 23 条消息，分 9 段）：9 段都抽完，1.1 分钟；问了模型 8 次（继承来的那段不问模型），共 12,804 token，每段约 1,600，memv2-lite 自己记的用量和模型报的一样。记下 21 条事实，其中 2 条被后来的说法取代：游泳课从周二改到周三；仓储系统由老陈交给小明。用户记不清的「一共交了 2600」没有顶掉记账的「交了 2400 元」，两条都留着。按这个算，每 1,000 条消息约 60 万 token，比图谱（约 250 万）省得多。

## 装

不用 Docker（要 Node 22.5 以上）：

```bash
# 模型：三种配法见 .env.example，这里用环境变量
export MODEL_NAME=gpt-6-luna OPENAI_API_KEY=sk-...
export EMBEDDER_MODEL=text-embedding-3-small EMBEDDER_API_KEY=sk-...
# 令牌：一个可写的给送对话的程序，一个只读的给 Bot（--out 写进文件，不显示）
npx -y -p javmem-mcp javmem-memv2 token add feeder --namespace me,shared --write --out feeder.token --db ./memv2-lite.sqlite
npx -y -p javmem-mcp javmem-memv2 token add me --namespace me,shared --out me.token --db ./memv2-lite.sqlite
npx -y -p javmem-mcp javmem-memv2 serve --db ./memv2-lite.sqlite
```

用 Docker：

```bash
cd backend/memv2
cp .env.example .env        # 留一种配法，填上钥匙
docker compose up -d --build
docker compose exec memv2 node memv2-lite.js token add me --namespace me,shared
```

服务开在 `http://127.0.0.1:8766`，只有这台电脑能连。

## 送对话进去，再查

```bash
npx -y -p javmem-mcp javmem-feed --db ./me.sqlite --memv2 http://127.0.0.1:8766 \
  --memv2-token-file feeder.token --namespace me --owner 小明 --watch 60

claude mcp add javmem-facts -e MEMV2_URL=http://127.0.0.1:8766 -e MEMV2_TOKEN_FILE=/path/to/me.token \
  -e MEMV2_NAMESPACE=me -e MEMORY_OWNER=小明 -- npx -y -p javmem-mcp memv2-mcp
```

用 DSH 插件的，在插件配置里选 `backend: memv2`，插件自己送。`GET /api/v1/status`（带令牌）报有几条记录、几条事实、几段还在排队、今天用了多少 token，只有计数。

## 和原版 memv2 的差别

精简版是照原版的做法重写的，不是原版的代码：接口和读出来的格式一样，抽取的规矩（逐字证据、不添加原文没有的信息、数字要对得上、新旧分开）一样，但抽的字段少（没有原版的谓词、金额币种、模态这些细分），也没有原版的文件抽取、别名合并和核对后台。所以每段用的 token 少很多，记下的条目也更粗一些。

---

## English

memv2-lite (`memv2-lite.js`, command `javmem-memv2`) is a small public memv2: the same read interface, so `memv2-mcp.js` and the combined server query it unchanged; one Node process and one SQLite file, no dependencies, no GPU. It starts empty.

- Every message is kept as a record (searchable word by word, Chinese included). Each stretch of conversation (up to 8 messages) is one model call that lists the facts worth keeping, each with a quote copied word for word from a message; a fact whose quote is not in that message, or that has a number its quotes lack, is dropped. Related old facts are shown to the model, and a fact a newer one replaces is marked superseded. Facts inherited from other AIs go in as they are, with no model call. With an embedding model set, facts are also found by meaning.
- One namespace per Bot with its own read-only token (it sees its namespace and `shared`); the feeder uses a writable token. Only token hashes are stored.
- A daily token budget (`MEMV2_DAILY_TOKENS`, default 1,000,000), counted from what the model reports; an optional cheaper model for short stretches (`MEMV2_MODEL_CHEAP`).
- Measured 2026-11-06 (gpt-6-luna at its default reasoning, local Qwen3-Embedding-4B, 23 made-up messages in 9 stretches): all 9 in 1.1 minutes, 8 model calls (the inherited package needs none), 12,804 tokens, about 1,600 per stretch, the same count the model reported; 21 facts, 2 of them superseded by later statements (a class moved from Tuesday to Wednesday; a system handed over), while the user's unsure "2,600 in all" did not replace the recorded "paid 2,400". Roughly 600,000 tokens per 1,000 messages, against about 2.5 million for the graph.
- Run it with `npx -y -p javmem-mcp javmem-memv2 serve` (Node 22.5+) or `docker compose up -d --build` here; it listens on `http://127.0.0.1:8766`. Feed it with `javmem-feed --memv2 … --memv2-token-file … --namespace …`.
- It is a rewrite in the original's spirit, not the original code: the same interface and extraction rules (verbatim evidence, nothing the source does not say, numbers that match, old and new kept apart), fewer fields and none of the original's file extraction, alias merging or checking jobs.
