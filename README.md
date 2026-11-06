# javmem-mcp

中文 | [English](README.en.md)

[![npm](https://img.shields.io/npm/v/javmem-mcp)](https://www.npmjs.com/package/javmem-mcp)
[![test](https://github.com/xuxiaoxiang0721-tech/javmem-mcp/actions/workflows/test.yml/badge.svg)](https://github.com/xuxiaoxiang0721-tech/javmem-mcp/actions/workflows/test.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**一个只读的记忆 MCP：同时查事实库 memv2 和记忆图谱 Javis，两边对照着回答；Claude Code、DeepSeek Harness 和别的 MCP 客户端都能接。**

这一套记忆叫 javmem：memv2 记事实（谁、什么时候、多少钱），Javis 记人和事的关系、时间线（Graphiti + Neo4j）。javmem-mcp 把两个库合成一个工具给模型用：两个库都记了的只列一次，说法不同的并排列出、以 memv2 为准；每个 Bot 用自己的令牌，只看得到自己那一份。程序自己不存记忆，只替模型去两个库里查。

## 为什么是 javmem

1. **为个人 Bot 设计，舍得用好模型。** 一个人一天聊的就那么多，不是商用的海量数据，所以 javmem 抽记忆时不抠模型：同一个人要认成同一个人，关系要连对，先后要排对，模型越好越准。不想花钱，就用零准备模式，一分钱不花。
2. **过去的对话，一次带进来。** 别的记忆插件多是装上那天才开始记。javmem 带一段导出提示词：贴给 Grok、ChatGPT、Claude 这类工具，它会把记得的事和聊过的话题写成一个包，一次导进库。
3. **两个库各管一块，越攒越像一个真实的人。** 用全套后端时，memv2 记「是什么」：事实、数字、日期；图谱记「跟谁、什么时候、在哪、后来怎么变了」；原话也都留着，听得出说话的口气。过时的说法会标成失效，分得清以前怎么想、现在怎么想；两个库说法不一样，也会标出来。记忆攒得越多，越能还原出一个真实的人，给数字人打底。
4. **只读，Bot 改不了你的过去。** 记忆只有两条来路：Bot 程序把新对话原生打包、投递进库，和你自己导入的历史，都不经过模型的手；模型只能查、不能写，既没法自己往记忆里添一条猜测，网页或别的 Bot 塞进来的指令也没法让它删改记忆。

## 适合谁，不适合谁

适合：

- 已经在跑 memv2 和 Javis，想让 Claude Code、聊天 Bot 都能查这份记忆的人；
- 养了好几个 Bot、要每个 Bot 各查各的记忆的人：分区落在每个 Bot 的令牌和配置文件上；
- 要「查到的先核对再给看」的人：Javis 的事实要和原文对上才显示，说错的可以放进隐藏名单。

不适合：

- 没有 memv2 和 Javis、也不打算自己搭的人：这两个库目前没有公开发布（见「前提」）；
- 想要 MCP 自己记下新对话的人：这里只读，写入走 memv2 和 Javis 自己的导入。

在 DeepSeek Harness 的 Tobs 里用，可以装配套插件 [javmem-dsh-plugin](https://github.com/xuxiaoxiang0721-tech/javmem-dsh-plugin)，按 Bot 自动挂上这些工具，不用给每个 Bot 单独接 MCP。

## 快速开始

1. **准备**：Node 20 以上；memv2 和 Javis 在运行，每个 Bot 有自己的令牌文件（见「前提」）。
2. **拿到程序**，两种任选：
   - npm 包（发布后）：`npx -y javmem-mcp` 就能起合起来的服务，不用先下载；
   - git：`git clone https://github.com/xuxiaoxiang0721-tech/javmem-mcp.git`，没有依赖，不用 `npm install`。
3. **自测**（git 方式）：`node test/smoke.mjs`，不需要两个库在跑。
4. **接上**：见下面的「接到 Claude Code」和「接到 DeepSeek Harness（Tobs）」。环境变量至少给 `MEMV2_TOKEN_FILE` 和 `JAVIS_TOKEN_FILE`。

## 先试试：演示数据

不搭两个库也能看到效果：把 `MEMV2_URL` 和 `JAVIS_URL` 都设成 `demo`，三个程序就改读包里自带的虚构数据，回答格式和真库一样，也不要令牌。数据是一个虚构的「小明」：女儿小雨的游泳课、同事老陈调岗、十一月去千岛湖。

![演示：两个库对照着回答](docs/demo.png)

- 命令行：`git clone` 以后运行 `node scripts/demo.mjs`，五个工具各问一遍。
- Claude Code（npm 包发布后）：`claude mcp add javmem-demo -e MEMV2_URL=demo -e JAVIS_URL=demo -- npx -y javmem-mcp`，然后问「小雨的游泳课学费交了多少？」「老陈最近怎么了？」。
- 数据里故意放了几种情况：两个库一致（「图库也有」）；说法不同（学费 2400 和 2600，以 memv2 为准）；只在图库有；一条和原文对不上的编造事实（被过滤掉，回答里提示「另有 1 条和原文对不上」）。分区也能试：`MEMV2_NAMESPACE=work` 加 `MEMV2_BOT_ONLY=1` 只看工作，`JAVIS_SOURCES=chatgpt` 只看一个账号。

## 接到 Claude Code

一条命令（npm 包发布后）：

```bash
claude mcp add javmem -e MEMV2_TOKEN_FILE=/path/to/tokens/bot_a.token -e JAVIS_TOKEN_FILE=/path/to/profiles/bot_a.env -e MEMORY_AUDIENCE=cc -- npx -y javmem-mcp
```

或者写在项目的 `.mcp.json` 里，用合起来的工具：

```json
{
  "mcpServers": {
    "memory": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/javmem-mcp/memory-mcp.js"],
      "env": {
        "MEMV2_TOKEN_FILE": "/path/to/tokens/bot_a.token",
        "JAVIS_TOKEN_FILE": "/path/to/profiles/bot_a.env",
        "MEMORY_LABELS_FILE": "/path/to/labels.json",
        "MEMORY_AUDIENCE": "cc"
      }
    }
  }
}
```

或者分开用两个：

```json
{
  "mcpServers": {
    "memv2": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/javmem-mcp/memv2-mcp.js"],
      "env": { "MEMV2_TOKEN_FILE": "/path/to/tokens/bot_a.token", "MEMV2_AUDIENCE": "cc" }
    },
    "javis": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/javmem-mcp/javis-mcp.js"],
      "env": { "JAVIS_TOKEN_FILE": "/path/to/profiles/bot_a.env", "JAVIS_AUDIENCE": "cc" }
    }
  }
}
```

`MEMORY_AUDIENCE=cc`（或任一边的 `*_AUDIENCE=cc`）让工具标成只读，Claude Code 在计划模式里也能用；提示语也换成写给 Claude Code 的。

## 接到 DeepSeek Harness（Tobs）

- 装配套插件 [javmem-dsh-plugin](https://github.com/xuxiaoxiang0721-tech/javmem-dsh-plugin)：按 Bot 编号自动挂工具，不用卡片（推荐）。
- 或者每个 Bot 一个私有 MCP：命令 `node /path/to/memory-mcp.js`，环境变量填这个 Bot 的令牌文件路径。

## 四个程序

| 程序 | 接的是 | 工具 |
|---|---|---|
| `memory-mcp.js`（命令 `javmem-mcp`） | **两个库合起来的一个工具**（推荐） | `recall`、`search`、`search_raw`、`person`、`read` |
| `memv2-mcp.js` | memv2：事实记忆服务（HTTP 读接口） | `recall`、`search`、`search_raw`、`read_record` |
| `javis-mcp.js` | Javis：Graphiti + Neo4j 的记忆图谱（通过它自带的 MCP 端点） | `search_memory`、`get_entity`、`find_sessions`、`get_conversation` |
| `local-mcp.js`（命令 `javmem-local`） | 本地库：本机的一个 SQLite 文件，零准备 | `recall`、`search`、`search_raw`、`person`、`read` |

四个程序都走 stdio，没有依赖，只用 Node 自带的模块（Node 20 以上；本地库用 Node 自带的 SQLite，要 Node 22.5 以上）。工具说明和返回内容是中文，按小模型的上下文写得很短。

## 合起来的工具 memory-mcp.js

一个 MCP 服务同时查两个库，给模型五个工具，代替分开的八个：

| 工具 | 做什么 |
|---|---|
| `recall` | 按这一轮的话题取回 memv2 里相关的事实；两个库都记了的标「图库也有」 |
| `search` | 两个库一起查：先列 memv2 的事实（事实、金额以它为准），再列图库里的人和关系、时间线；两个库都记了的只列一次，说法不同的在 memv2 那条下面写「图库说：…」 |
| `search_raw` | 按关键词在两个库的原文里找，同一句话只列一行，带记录号和对话号 |
| `person` | 图库里这个人的全部关系（按时间，名字要对得上），加上 memv2 里关于他的事实（按时间） |
| `read` | 给记录号读 memv2 的一条记录，或给对话号分页读图库的整段对话 |

- 它直接引用同目录的 `memv2-mcp.js` 和 `javis-mcp.js`，用它们的查询和过滤（分区、隐藏名单、事实核对），所以要同时配好两边的设置（`MEMV2_*`、`JAVIS_*`、`MEMORY_*`）。
- 一个库出错或没配，另一个照样回答，回复里说清哪个没查成。
- 标签：设了 `MEMORY_LABELS_FILE` 就给每条标上两个库的对照结果。文件格式：

  ```json
  {"version": 1, "memv2": {"<item_id>": {"l": "两边一致", "same": ["<javis uuid>"]}},
   "javis": {"<uuid>": {"l": "只在图库"}}}
  ```

  `l` 是 `两边一致`、`两边不同`（`diff` 列出说法不同的那条）、`只在 memv2`、`只在图库` 之一。这个文件由你自己的对照程序生成，只放编号和标签，不放内容；没有这个文件就不标。

## 本地库 local-mcp.js（零准备）

不用 memv2 和 Javis，也不用另起服务：它读一个本地库文件（`JAVMEM_LOCAL_DB`），里面是以前的对话（javmem-dsh-plugin 按 Bot 从 DSH 的会话里建，一个 Bot 一个文件），以后还有从别的 AI 工具继承来的记忆。

- 工具和合起来的那套同名（`recall`、`search`、`search_raw`、`person`、`read`），Bot 换后端时规则不用改。
- 全文索引用 SQLite 的 FTS5。中文按相邻两个字切开再建索引（「游泳课」→「游泳」「泳课」），所以两个字的词也能在整句里找到；英文和数字按词。`recall` 按整句里的片段打分，`search` 按关键词，`search_raw` 逐字找。
- 只读打开；库文件还不存在时回答「还没有内容」，不报错。`javmem/status` 报有几个会话、几条对话、最近一次更新。
- 库的读写模块是 `local-store.js`，写入方（DSH 插件的索引程序）和它共用。

## 继承别的 AI 的记忆：javmem-inherit

你在别的 AI 工具（Grok、Muse、Dot、ChatGPT 这类）里攒下的「它记得你」的东西，可以搬进 javmem，Bot 一上来就有过去：

1. **拿提示词**：`npx -y -p javmem-mcp javmem-inherit prompt`（英文版加 `--en`），或者直接复制 [docs/inherit-prompt.md](docs/inherit-prompt.md)。
2. **贴给那个 AI**：它按固定格式（JSON）把记得的事写出来，内容多就分几段。把回答整个复制下来存成一个文件，比如 `grok.json`；几段可以存在同一个文件里，前后的闲话和代码块标记不用删。
3. **检查**：`javmem-inherit check grok.json`，只报几条事实、几段对话、哪里有问题，不打印内容。
4. **导入**：用 DSH 插件的，把文件放进 `<DSH 主目录>/javmem/inherit/<Bot 名字或编号>/`，插件下次补录时导进这个 Bot 的本地库；单独用的，`javmem-inherit import grok.json --db <本地库文件>`，再用 `local-mcp.js` 查。
5. 每条都标「继承自 Grok，某日导出」；同一个文件再导一次不会重复。

继承来的记忆没有和原始对话核对过，工具说明会提醒模型讲明出处。

## 图谱接 Graphiti 官方服务（后端 C）

Javis 那层没有公开，图谱可以换成 [Graphiti](https://github.com/getzep/graphiti) 官方的 MCP 服务（Zep 维护）：`backend/graphiti/` 里有一份菜谱（一个 Docker 容器，模型可选 OpenAI、DeepSeek 加千问、或本地 Ollama），见 [backend/graphiti/README.md](backend/graphiti/README.md)。

- **送进去**：`javmem-feed` 把本地库里的对话一段一段（最多 8 条）送进 Graphiti，每段只送一次；对话停了 30 分钟或攒够 8 条才送；每天有 token 上限（默认每个库 100 万），到了就停，第二天接着送；Graphiti 丢了的（它的队列在内存里）半小时后重送。只打印条数。
- **查出来**：`javis-mcp.js` 设 `JAVIS_BACKEND=graphiti`，四个工具照旧：事实和人从 Graphiti 来，原话从本地库来（官方服务不能按原话搜）。合起来的 `memory-mcp.js` 也能接。
- 每个 Bot 一个组（`GRAPHITI_GROUP_ID`），互相看不到。只读：查的时候不改图谱。
- 花多少：2026-11-06 自测（官方服务 1.1.3 + gpt-6-luna，虚构的 23 条消息切成 9 段）每段约 1.5 万 token；按每段 2 万估，约合每 1,000 条消息 250 万 token。本地 Ollama 不花钱但慢。

## 事实库用 memv2 精简版（后端 B）

原版 memv2 没有公开，这里带一个公开的精简版 `memv2-lite.js`（命令 `javmem-memv2`）：同样的读接口，`memv2-mcp.js` 和 `memory-mcp.js` 不用改；一个 Node 程序加一个 SQLite 文件，不要 GPU，库一开始是空的。见 [backend/memv2/README.md](backend/memv2/README.md)。

- **怎么记**：原话都存下来；一段对话（最多 8 条）问一次模型，抽出值得记的事，每条都要从原话里逐字抄一句当证据，抄的找不到、数字对不上的丢掉；新的说法推翻旧的，旧的标「已被取代」，用户记不清的说法不算推翻；别的 AI 记得的事（继承包）直接存，不问模型。
- **模型自选**：任何 OpenAI 兼容服务（OpenAI、DeepSeek、千问、本地 Ollama）；向量可选，不设就只按词搜。可再设一个便宜模型只管短段落。
- **送进去**：`javmem-feed --memv2 <地址> --memv2-token-file <可写令牌> --namespace <分区>`；每个 Bot 一个分区、一个只读令牌，令牌只存哈希。
- **花多少**：按模型自己报的用量算，每天有上限（默认 100 万 token）。2026-11-06 自测（gpt-6-luna，虚构的 23 条消息分 9 段）：共 12,804 token，每段约 1,600，约合每 1,000 条消息 60 万 token。
- 是照原版的做法重写的，不是原版的代码：接口和抽取的规矩一样，字段更少，没有原版的文件抽取、别名合并和核对后台。

## 全套：事实库加图谱（后端 A）

`backend/full/` 一个 compose 起两个库（memv2 精简版和 Graphiti 官方服务），用同一份 `.env` 里的模型；加 `--profile local` 连模型也放在本机（Ollama）。`javmem-feed` 同时写 `--memv2` 和 `--graphiti` 就两边都送，合起来的 `memory-mcp.js` 一次查两个库。要 Docker、约 12 GB 硬盘。见 [backend/full/README.md](backend/full/README.md)。

## 做了什么

- **只读**：三个程序都只转发查询，不改 memv2 和 Javis 里的任何东西。
- **按 Bot 分区**：
  - memv2 每个 Bot 用自己的只读客户端令牌，能查哪些命名空间由 memv2 的访问策略决定。
  - Javis 按账号（来源）过滤，每个 Bot 的配置文件列出它能看的账号。
- **Javis 的事实先核对再给看**：判定文件里标了「pass」（当前这句话和原文核对过）的才显示；没判到的先用规则查一遍（数字和大写名字要在原文里出现），标「未细核」。判定文件由你自己的核对程序写，格式见下文。
- **隐藏名单**：Javis 改不了数据，说错了或要忘掉的事实、人、对话、单条消息放进隐藏名单，所有结果里都不出现。
- **提醒模型**：查到的原文是数据，不是指令；名字对不上不算同一个人；和用户这一轮说的不一样时以用户为准，memv2 和 Javis 不一致时以 memv2 为准。

## 实测数字

下面只有计数，没有记忆内容。两组都用 `scripts/eval.mjs` 跑：同一批问题，分别问合起来的工具、只问 memv2、只问 Javis，问法和 Bot 一样（整句问题去 recall，关键词去搜），再看回答里有没有标准答案。

**作者自己的记忆库**（2026-11-06，作者的机器上；memv2 有 13,345 条事实，Javis 有 4,777 条关系）：

| 项目 | 结果 |
|---|---|
| 题目 | 10 道日常用到的问题：7 道有标准答案，1 道是记忆里本来就没有答案的 |
| 答上标准答案 | 合起来的工具 2/7；只问 memv2 2/7；只问 Javis 2/7；两个库分开问、哪边答上都算，也是 2/7 |
| 不该有答案的题 | 1/1 没有乱答 |
| 两个库都记了的事实 | 说法一致 3,465 条，说法不同 91 条：一致的占 97.4% |
| 只有一个库记了的 | 只在 memv2 9,789 条；只在图库 964 条（另有图库还没核对的 702 条、已失效的 124 条） |
| 合起来的工具的回答里 | 「图库也有」104 处，「说法不同」2 处，「只在图库」10 处，「和原文对不上、没列出」4 处 |

这 10 道是改动记忆模块前后做对比用的回归题，题少，不是对外的评测集。它能说明的是：合起来的工具没有漏掉两个库分开问能答上的，而且一次就给出对照好的答案。

**演示数据**（谁都能复现：`node scripts/eval.mjs --demo`）：7 道虚构问题，6 道有标准答案。合起来的工具 6/6，只问 memv2 5/6，只问 Javis 6/6；不该有答案的 1 道没有乱答。

在自己的库上跑：`node scripts/eval.mjs --questions 题目.json --bots 各Bot设置.json --env 共用设置.json`。题目格式是 `[{"id", "bot", "question", "keywords", "expected", "must_not_mention"}]`（`expected` 里多个答案用 `|` 隔开）；Bot 设置是 `{"<bot>": {"MEMV2_TOKEN_FILE": …, "JAVIS_TOKEN_FILE": …}}`；共用设置里放 `MEMORY_LABELS_FILE` 等。它只打印计数。

## 状态检查（给宿主程序用）

三个程序都认一个不是工具的请求 `javmem/status`（JSON-RPC，参数为空）：回答每个库连不连得上、令牌能不能用（`state` 是 `ok`、`bad_token`、`down`、`no_token`、`error` 之一），Javis 还报隐藏名单读不读得了，合起来的程序还报标签文件在不在。它不读任何记忆：memv2 那边问一条不存在的记录（memv2 先验令牌再找记录，「没找到」就说明令牌可用），Javis 那边问它的工具列表。回答里没有令牌，也没有记忆内容。javmem-dsh-plugin 的 `memory_status` 工具用的就是它。

## 前提

这三个程序自己不存记忆，只负责替 Bot 去两个记忆库里查，所以用之前要先有：

- **memv2 在运行**，程序要知道它的地址（默认 `http://127.0.0.1:8766`，即本机的 8766 端口）。每个 Bot 还要一个只读令牌，相当于这个 Bot 的借阅证：由 memv2 的管理员发，发的时候就定好它能查哪些分区（memv2 里叫命名空间）。令牌存在一个文件里，配置里只写这个文件的路径（`MEMV2_TOKEN_FILE`）。
- **Javis 在运行**，程序要知道它的地址（默认 `http://127.0.0.1:8765/mcp`），还要 Javis 的令牌，同样存在文件里。每个 Bot 能看哪些账号，写在这个 Bot 的配置文件里（`JAVIS_TOKEN_FILE`，格式见下文）。

**注意**：原版 memv2 和 Javis 目前没有公开发布，`memv2-mcp.js` 和 `javis-mcp.js` 默认调用的正是它们自己的查询接口。不搭它们也能用：本地库装上就有；事实库可以用公开的 memv2 精简版（`javmem-memv2`，见「事实库用 memv2 精简版」）；图谱可以换成 Graphiti 官方服务（`JAVIS_BACKEND=graphiti`，见「图谱接 Graphiti 官方服务」）。

## 配置（环境变量）

### memv2-mcp.js

| 变量 | 说明 |
|---|---|
| `MEMV2_TOKEN_FILE` | 必填。存只读客户端令牌的文件路径（令牌本身不要写进环境变量） |
| `MEMV2_NAMESPACE` | 只查这一个命名空间；不填 = 这个客户端能查的全部 |
| `MEMV2_BOT_ONLY` | `1` = 只查上面那个命名空间，不带总区 |
| `MEMV2_URL` | 默认 `http://127.0.0.1:8766`；`demo` = 读包里的虚构演示数据（见「先试试」） |
| `MEMV2_PURPOSE` | `eval` = 带上 `X-IM-Purpose: eval`，让 memv2 把测试调用单独计数 |
| `MEMV2_AUDIENCE` | `cc` = 用的是 Bot 的 Claude Code（工具标成只读）；不填 = Bot 的聊天前台 |

### javis-mcp.js

| 变量 | 说明 |
|---|---|
| `JAVIS_TOKEN_FILE` | 必填。Bot 的配置文件（每行 `KEY=value`：`JAVIS_SOURCES=<账号，逗号隔开，或 *>`、`JAVIS_TOKEN_FROM=<存 Javis 令牌的文件>`），或者直接给存令牌的文件（这时所有账号都能看） |
| `JAVIS_SOURCES` | 覆盖配置文件里的账号；`*` = 全部 |
| `JAVIS_URL` | 默认 `http://127.0.0.1:8765/mcp`（接 Graphiti 时默认 `http://127.0.0.1:8000/mcp/`）；`demo` = 读包里的虚构演示数据 |
| `JAVIS_BACKEND` | `graphiti` = 接 Graphiti 官方服务（它不要令牌，`JAVIS_TOKEN_FILE` 可以不填） |
| `GRAPHITI_GROUP_ID` | 接 Graphiti 时这个 Bot 的组，默认 `main` |
| `JAVMEM_LOCAL_DB` | 接 Graphiti 时必填：本地库文件（原话在这里，`javmem-feed` 从这里送） |
| `JAVIS_HIDE_FILE` | 隐藏名单，默认程序旁边的 `hidden.json`（没有 = 不隐藏） |
| `JAVIS_VERIFY_FILE` | 判定文件，默认程序旁边的 `verify/verdicts.jsonl`（没有 = 每条事实都按规则查） |
| `JAVIS_AUDIENCE` | 同上 |

### local-mcp.js

| 变量 | 说明 |
|---|---|
| `JAVMEM_LOCAL_DB` | 必填。本地库文件的路径；文件还不存在 = 还没有内容 |
| `MEMORY_AUDIENCE` | `cc` = 给 Claude Code 用（工具标成只读） |

### 三个程序共用

| 变量 | 说明 |
|---|---|
| `MEMORY_OWNER` | 记忆是谁的，工具说明里这样称呼（默认「用户」） |
| `MEMORY_SOURCE` | 原文是什么（默认「以前和 AI 的对话」） |
| `MEMORY_FIX_HOW` | 记错了找谁改（memv2 默认「找 memv2 的管理员，用 memv2 的命令改」，Javis 默认「找 Javis 的管理员，把它加进「不给 Bot 看」的名单」） |
| `MEMORY_SPEAKERS` | 仅 Javis：事实里可能用来指代「我」「你」的其他名字，逗号隔开（例如助手的名字） |

### 文件格式

- 隐藏名单 `hidden.json`：`{"facts": [...], "entities": [...], "sessions": [...], "messages": [...]}`，每项是 id 字符串或 `{"id": "..."}`。单条消息用指纹：`"fp:"` 加上 `sha256(role + "\n" + timestamp + "\n" + 原文前 600 字)` 十六进制的前 32 位。
- 判定文件 `verdicts.jsonl`：每行 `{"id": "<事实 uuid>", "h": "<sha256(事实原句) 十六进制前 16 位>", "v": "pass|fail|unsure"}`，可以多带别的字段；同一事实以最后一行为准；事实原句改了，旧判定自动作废。

## 测试

```bash
node test/smoke.mjs
```

不需要 memv2 和 Javis 在跑：测三个程序的握手（版本号）、工具名单、主人名字、令牌缺失和服务没起来时的报错、合起来的工具在一个库出错时照样回答、`javmem/status` 的几种状态，以及演示数据上的 13 个工具。GitHub Actions 在 Node 20、22、24 上各跑一遍。截图用 `node scripts/screenshot.mjs` 重新生成（要本机有 Chrome 或 Edge）。

## 安全

- 令牌只放在文件里，环境变量里只写路径。
- 三个程序都不往标准输出打别的东西，只有 JSON-RPC 消息，不记查询内容。
- 查询走本机或你指定的地址；Javis 的事实查询只按关键词，不调用嵌入模型。

## 发版

步骤见 [RELEASING.md](RELEASING.md)，更新记录见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

MIT，见 [LICENSE](LICENSE)。
