# 全套（后端 A）：事实库加图谱，一个 compose

一条命令起两个库：事实库（memv2 精简版，见 [../memv2](../memv2/README.md)）和图谱（Graphiti 官方服务加 Neo4j，见 [../graphiti](../graphiti/README.md)），用同一份 `.env` 里的模型。想连模型也放在自己电脑上，加 `--profile local`，会多起一个 Ollama 并第一次自动下载模型。

两个库一开始都是空的，只装你送进去的东西。

## 为什么要两个库

- **事实库**记「是什么」：一条条事实、数字、日期，每条带原话出处；后来的说法推翻了旧的，旧的标「已被取代」。
- **图谱**记「跟谁、什么时候、在哪、后来怎么变了」：人和事连成网，带时间。
- 原话都在本地库里，两个库的事实都能回到原话核对。
- 合起来的工具 `memory-mcp.js`（命令 `javmem-mcp`）一次查两个库：事实、金额以事实库为准，人和关系、时间线看图谱，原话两边一起找。

## 要什么

- Docker；硬盘约 12 GB（官方服务的镜像约 10 GB，Neo4j 的镜像约 1 GB、空库约 500 MB，事实库约 250 MB）；内存 4 GB 以上（实测跑起来 Neo4j 约 1.1 GB、官方服务约 220 MB、事实库约 70 MB）。
- 用本地模型（`--profile local`）再加约 10 GB 硬盘放模型，内存 16 GB 以上，有显卡快得多。

## 花多少

2026-11-06 用 gpt-6-luna 和本机向量模型、在虚构的 23 条消息上实测：事实库每段约 1,600 token，图谱每段约 1.5 万；按每 1,000 条消息算，事实库约 60 万、图谱约 250 万。两边各有每天的上限：事实库 `MEMV2_DAILY_TOKENS`（默认 100 万），图谱是 `javmem-feed --daily-tokens`（默认每个库 100 万）。到了就停，第二天接着抽。

**用 Neo4j 实测**（2026-11-09，安装向导写的文件夹，同样的模型，一段 6 条的虚构对话）：42 秒两边各 3 段全部完成，事实库记下 3 条（1 条被后来的说法取代），图谱里旧说法标了失效，两边合计 3.7 万 token，合起来的工具一次查到两个库。

**全套实测**（2026-11-06，当时图谱用 FalkorDB，同样的模型和虚构数据）：一个本地库同时送进两个库，3.5 分钟两边各 9 段全部完成、没有失败；事实库记下 18 条（2 条被后来的说法取代），用了 11,748 token；两边合计 86 次模型调用、161,142 token。合起来的工具一次查两个库：事实在前、人和关系在后，原话两边一起找，状态两个库都正常。

## 装

```bash
cd backend/full
cp .env.example .env               # 设一个 NEO4J_PASSWORD（至少 8 位），三种配法留一种，填上钥匙
docker compose up -d --build       # 云端模型
# 或者：docker compose --profile local up -d --build    # 模型也在本机（Ollama）

# 令牌：一个可写的给送对话的程序，每个 Bot 一个只读的
docker compose exec -T memv2 node memv2-lite.js token add feeder --namespace me,shared --write > feeder.token
docker compose exec -T memv2 node memv2-lite.js token add me --namespace me,shared > me.token
```

事实库在 `http://127.0.0.1:8766`，图谱在 `http://127.0.0.1:8000/mcp/`，都只开在本机。想看图谱：浏览器打开 `http://127.0.0.1:17474`，连接地址填 `bolt://127.0.0.1:17687`，用户名 `neo4j`，密码是 `.env` 里的 `NEO4J_PASSWORD`。

不想要 Neo4j：`docker compose -f docker-compose.falkordb.yml up -d --build`，图谱和 FalkorDB 打包在一个容器里，不用设密码。

## 送对话进去，再查

```bash
npx -y -p javmem-mcp javmem-feed --db ./me.sqlite --owner 小明 --watch 60 \
  --memv2 http://127.0.0.1:8766 --memv2-token-file feeder.token --namespace me \
  --graphiti http://127.0.0.1:8000/mcp/ --group me

claude mcp add javmem \
  -e MEMV2_URL=http://127.0.0.1:8766 -e MEMV2_TOKEN_FILE=/path/to/me.token -e MEMV2_NAMESPACE=me \
  -e JAVIS_BACKEND=graphiti -e JAVIS_URL=http://127.0.0.1:8000/mcp/ -e GRAPHITI_GROUP_ID=me \
  -e JAVMEM_LOCAL_DB=/path/to/me.sqlite -e MEMORY_OWNER=小明 \
  -- npx -y javmem-mcp
```

用 DSH 插件的，在插件配置里选 `backend: full`，插件自己送、自己接。

---

## English

One command starts both stores, the fact store (memv2-lite) and the graph (the official Graphiti server and Neo4j), with the models from one `.env`; `--profile local` adds an Ollama container that pulls the models the first time. Both start empty.

- The fact store keeps what is true (facts, numbers, dates, each with its quote; superseded ones marked); the graph keeps who, when, where and how things changed. The combined `memory-mcp.js` (command `javmem-mcp`) asks both at once.
- Needs Docker, about 12 GB of disk (the official server's image about 10 GB, Neo4j's about 1 GB plus about 500 MB for an empty database) and 4 GB of memory; with local models about 10 GB more and 16 GB of memory, a GPU helps a lot.
- Cost measured 2026-11-06 (gpt-6-luna, local embeddings, 23 made-up messages): about 1,600 tokens per stretch for the fact store and 15,000 for the graph, roughly 600,000 + 2,500,000 per 1,000 messages, each within its own daily limit.
- Setup: `cp .env.example .env`, set `NEO4J_PASSWORD`, keep one model block, `docker compose up -d --build` (or `--profile local`), then make tokens with `docker compose exec -T memv2 node memv2-lite.js token add …`. Feed with `javmem-feed --memv2 … --graphiti …`, query with `npx -y javmem-mcp` and the environment above. Without Neo4j: `docker compose -f docker-compose.falkordb.yml up -d --build`.
