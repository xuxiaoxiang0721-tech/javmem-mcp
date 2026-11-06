# 更新记录 / Changelog

## 0.3.0（未发布 / unreleased）

- 三个服务在 MCP 握手里报的版本号，改成读同目录的 `package.json`（以前写死，`memory-mcp.js` 还报 0.1.0）。
- 第一次发 npm：包名 `javmem-mcp`；新增命令名 `javmem-mcp`（就是合起来的 `memory-mcp.js`），所以 `npx -y javmem-mcp` 就能起服务。
- 发版文件：`node scripts/pack.mjs` 从已提交的内容打包（换行都是 LF），生成 npm 包和 GitHub Release 附件。
- 状态检查：三个程序都认 `javmem/status` 请求（不是工具），回答每个库连不连得上、令牌能不能用，不读记忆，不带令牌。
- README：开头一句话说清是什么，写明适合谁、不适合谁，接 Claude Code 的一条命令（`claude mcp add … -- npx -y javmem-mcp`）；英文版 `README.en.md` 和中文版内容对等；npm、CI、许可证徽章；CI 在 Node 20、22、24 上跑测试。
- 演示数据：`MEMV2_URL=demo`、`JAVIS_URL=demo` 时读包里自带的虚构数据（`demo.js`、`demo/`），13 个工具都能答，不要令牌；`node scripts/demo.mjs` 把五个工具各问一遍；README 配了截图（`scripts/screenshot.mjs` 生成）。
- 实测数字：`scripts/eval.mjs` 用同一批题比较合起来的工具和单库，只打印计数；README 写了作者记忆库上的结果（2/7 与单库相同，两库都记的事实 97.4% 说法一致）和演示数据上的结果。
- 本地库（零准备）：`local-mcp.js` 和 `local-store.js`，读一个本机的 SQLite 文件，五个工具和合起来的那套同名；中文按相邻两字建全文索引；命令 `javmem-local`；要 Node 22.5 以上。
- 继承别的 AI 的记忆：`inherit.js`（命令 `javmem-inherit`）给出导出提示词（中英文，也在 `docs/inherit-prompt.md`），检查和导入别的 AI 写出的 javmem 包，导进本地库时标上来源，同一个包不重复导入；附一个虚构的示例包 `demo/inherit-grok.json`。
- 图谱可以接 Graphiti 官方服务（后端 C）：`javis-mcp.js` 设 `JAVIS_BACKEND=graphiti`，四个工具照旧（事实从 Graphiti 来，原话从本地库来，`graphiti.js`）；`feed.js`（命令 `javmem-feed`）把本地库里的对话按段送进 Graphiti，每段一次，有每天的 token 上限，丢了会重送；`backend/graphiti/` 是官方镜像的 compose 菜谱，模型可选 OpenAI、DeepSeek 加千问、本地 Ollama。用 gpt-6-luna 和本机向量模型实测过。
- 事实库的公开精简版 memv2-lite（后端 B）：`memv2-lite.js`（命令 `javmem-memv2`）回答 `memv2-mcp.js` 用的读接口，`/api/v1/ingest` 收对话；原话存成记录，按段问模型抽事实，证据要逐字出自原话，数字要对得上，新的说法取代旧的（记不清的不算），继承包不问模型；向量可选；按 Bot 分区，令牌只存哈希；每天的 token 上限按模型报的用量算，可另设便宜模型管短段落。`javmem-feed --memv2` 往里送。`backend/memv2/` 有 Dockerfile、compose 和三种模型配法。
- 全套（后端 A）：`backend/full/` 一个 compose 起 memv2 精简版和 Graphiti 官方服务，同一份 `.env`；`--profile local` 加一个 Ollama，第一次自动下载模型。`javmem-feed` 同时写 `--memv2` 和 `--graphiti` 就两边都送。
- 安装向导和估算：`npx -y javmem-mcp setup` 讲清 A、B、C、D 记什么、花多少、要装什么，选模型（默认质量好的 gpt-6-luna）、每天上限，先报价，说好了才写文件（模型设置、compose 或启动脚本、memv2 精简版的令牌、插件配置），不启动任何东西；`npx -y javmem-mcp estimate <路径>` 按实际段数估 token，只打印条数。README 加了「花多少」。
- `javmem/status` 报今天用了多少 token、上限多少：图谱按段数折算，memv2 精简版按模型报的用量（它的 `/api/v1/status`）。`javmem-memv2 serve --env <.env>` 读模型设置文件。

English:

- The three servers report the version in the `package.json` next to them in the MCP handshake (it was hard-coded, and `memory-mcp.js` said 0.1.0).
- First npm release, package `javmem-mcp`, with a new `javmem-mcp` command (the combined `memory-mcp.js`), so `npx -y javmem-mcp` starts the server.
- Release files: `node scripts/pack.mjs` packs the committed tree (LF line endings) into the npm tarball and the GitHub Release asset.
- Status check: all three servers answer a `javmem/status` request (not a tool) with whether each store answers and takes the token; it reads no memory and carries no token.
- README: a one-line pitch, who it is for and not for, one command for Claude Code (`claude mcp add … -- npx -y javmem-mcp`); `README.en.md` in English with the same content as the Chinese one; npm, CI and licence badges; CI runs the tests on Node 20, 22 and 24.
- Demo data: with `MEMV2_URL=demo` and `JAVIS_URL=demo` the servers answer from made-up data in the package (`demo.js`, `demo/`), all thirteen tools, no token; `node scripts/demo.mjs` asks each of the five once; the README has a picture (made by `scripts/screenshot.mjs`).
- The local store (zero setup): `local-mcp.js` and `local-store.js` over one SQLite file on this machine, the same five tool names as the combined set; Chinese indexed as pairs of neighbouring characters; command `javmem-local`; Node 22.5 or later.
- Memory inherited from other AIs: `inherit.js` (command `javmem-inherit`) gives the export prompt (Chinese and English, also in `docs/inherit-prompt.md`), checks and imports the javmem package another AI writes into a local store, marked with where it came from, each package once; a made-up example package is in `demo/inherit-grok.json`.
- The graph on the official Graphiti server (backend C): `javis-mcp.js` with `JAVIS_BACKEND=graphiti` keeps its four tools (facts from Graphiti, the original words from the local store; `graphiti.js`); `feed.js` (command `javmem-feed`) sends the local store's conversations to Graphiti in episodes, each once, within a daily token budget, resending what Graphiti lost; `backend/graphiti/` is a compose recipe for the official image, with models from OpenAI, DeepSeek with Qwen, or a local Ollama. Tested with gpt-6-luna and a local embedding model.
- memv2-lite, a small public fact store (backend B): `memv2-lite.js` (command `javmem-memv2`) answers the read interface `memv2-mcp.js` uses and takes conversations at `/api/v1/ingest`; it keeps the messages as records, asks a model for the facts of each stretch with quotes that must be copied from the messages and numbers that must match, lets newer statements supersede older ones (unsure ones do not), and stores inherited packages without a model call; embeddings optional; one namespace per Bot, token hashes only; a daily token budget counted from the model's own usage, and an optional cheaper model for short stretches. `javmem-feed --memv2` feeds it. `backend/memv2/` has a Dockerfile, a compose file and three model setups.
- The full set (backend A): `backend/full/` starts memv2-lite and the official Graphiti server in one compose with one `.env`; `--profile local` adds an Ollama that pulls the models the first time. `javmem-feed` with both `--memv2` and `--graphiti` feeds both.
- The setup wizard and the estimate: `npx -y javmem-mcp setup` explains what A, B, C and D keep, cost and need, asks for the models (by default the good gpt-6-luna) and a daily limit, shows the quote first and writes nothing until a yes (model settings, compose files or start scripts, memv2-lite's tokens, the plugin config), and starts nothing; `npx -y javmem-mcp estimate <path>` estimates tokens from the actual stretches, counts only. The README has "What it costs".
- `javmem/status` reports the tokens spent today and the limit: per episode for the graph, from the model's own usage for memv2-lite (its `/api/v1/status`). `javmem-memv2 serve --env <.env>` reads a model settings file.
- Measured numbers: `scripts/eval.mjs` compares the combined server with each store alone on the same questions and prints counts only; the README has the results on the author's memory (2/7, the same as either store; 97.4% of facts both stores hold agree) and on the demo data.

## 0.2.0

- `memory-mcp.js`：两个库合起来的一个服务，五个工具（recall、search、search_raw、person、read），带两库对照标记。
- 包名改成 `javmem-mcp`；MIT 许可证；README 写清前提。

English: `memory-mcp.js`, one combined server over both stores with five tools and cross-check marks; package renamed to `javmem-mcp`; MIT licence; README prerequisites.

## 0.1.0

- `memv2-mcp.js`、`javis-mcp.js`：两个单库的只读 MCP 服务。

English: `memv2-mcp.js` and `javis-mcp.js`, the two read-only single-store MCP servers.
