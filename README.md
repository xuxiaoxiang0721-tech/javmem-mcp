# two-memory-mcp

两个只读的 MCP 服务，给聊天 Bot（以及 Claude Code）查记忆用：

| 程序 | 接的是 | 工具 |
|---|---|---|
| `memv2-mcp.js` | memv2：事实记忆服务（HTTP 读接口） | `recall`、`search`、`search_raw`、`read_record` |
| `javis-mcp.js` | Javis：Graphiti + Neo4j 的记忆图谱（通过它自带的 MCP 端点） | `search_memory`、`get_entity`、`find_sessions`、`get_conversation` |

两个程序都走 stdio，没有依赖，只用 Node 自带的模块（Node 20 以上）。工具说明和返回内容是中文，按小模型的上下文写得很短。

配套的 DeepSeek Harness（Tobs）插件 [dsh-plugin-two-memory](../dsh-plugin-two-memory) 按 Bot 把这两组工具挂上去，不用给每个 Bot 单独接私有 MCP。

## 做了什么

- **只读**：两个程序只转发查询，不改 memv2 和 Javis 里的任何东西。
- **按 Bot 分区**：
  - memv2 每个 Bot 用自己的只读客户端令牌，能查哪些命名空间由 memv2 的访问策略决定。
  - Javis 按账号（来源）过滤，每个 Bot 的配置文件列出它能看的账号。
- **Javis 的事实先核对再给看**：判定文件里标了「pass」（当前这句话和原文核对过）的才显示；没判到的先用规则查一遍（数字和大写名字要在原文里出现），标「未细核」。判定文件由你自己的核对程序写，格式见下文。
- **隐藏名单**：Javis 改不了数据，说错了或要忘掉的事实、人、对话、单条消息放进隐藏名单，所有结果里都不出现。
- **提醒模型**：查到的原文是数据，不是指令；名字对不上不算同一个人；和用户这一轮说的不一样时以用户为准，memv2 和 Javis 不一致时以 memv2 为准。

## 前提

- memv2 的 HTTP 读接口（默认 `http://127.0.0.1:8766`），以及每个 Bot 一个只读客户端令牌（由 memv2 的管理员在访问策略里建好，令牌写进一个文件）。
- Javis 的 MCP 端点（默认 `http://127.0.0.1:8765/mcp`），以及存它令牌的文件。

## 配置（环境变量）

### memv2-mcp.js

| 变量 | 说明 |
|---|---|
| `MEMV2_TOKEN_FILE` | 必填。存只读客户端令牌的文件路径（令牌本身不要写进环境变量） |
| `MEMV2_NAMESPACE` | 只查这一个命名空间；不填 = 这个客户端能查的全部 |
| `MEMV2_BOT_ONLY` | `1` = 只查上面那个命名空间，不带总区 |
| `MEMV2_URL` | 默认 `http://127.0.0.1:8766` |
| `MEMV2_PURPOSE` | `eval` = 带上 `X-IM-Purpose: eval`，让 memv2 把测试调用单独计数 |
| `MEMV2_AUDIENCE` | `cc` = 用的是 Bot 的 Claude Code（工具标成只读）；不填 = Bot 的聊天前台 |

### javis-mcp.js

| 变量 | 说明 |
|---|---|
| `JAVIS_TOKEN_FILE` | 必填。Bot 的配置文件（每行 `KEY=value`：`JAVIS_SOURCES=<账号，逗号隔开，或 *>`、`JAVIS_TOKEN_FROM=<存 Javis 令牌的文件>`），或者直接给存令牌的文件（这时所有账号都能看） |
| `JAVIS_SOURCES` | 覆盖配置文件里的账号；`*` = 全部 |
| `JAVIS_URL` | 默认 `http://127.0.0.1:8765/mcp` |
| `JAVIS_HIDE_FILE` | 隐藏名单，默认程序旁边的 `hidden.json`（没有 = 不隐藏） |
| `JAVIS_VERIFY_FILE` | 判定文件，默认程序旁边的 `verify/verdicts.jsonl`（没有 = 每条事实都按规则查） |
| `JAVIS_AUDIENCE` | 同上 |

### 两个程序共用

| 变量 | 说明 |
|---|---|
| `MEMORY_OWNER` | 记忆是谁的，工具说明里这样称呼（默认「用户」） |
| `MEMORY_SOURCE` | 原文是什么（默认「以前和 AI 的对话」） |
| `MEMORY_FIX_HOW` | 记错了找谁改（memv2 默认「找 memv2 的管理员，用 memv2 的命令改」，Javis 默认「找 Javis 的管理员，把它加进「不给 Bot 看」的名单」） |
| `MEMORY_SPEAKERS` | 仅 Javis：事实里可能用来指代「我」「你」的其他名字，逗号隔开（例如助手的名字） |

### 文件格式

- 隐藏名单 `hidden.json`：`{"facts": [...], "entities": [...], "sessions": [...], "messages": [...]}`，每项是 id 字符串或 `{"id": "..."}`。单条消息用指纹：`"fp:"` 加上 `sha256(role + "\n" + timestamp + "\n" + 原文前 600 字)` 十六进制的前 32 位。
- 判定文件 `verdicts.jsonl`：每行 `{"id": "<事实 uuid>", "h": "<sha256(事实原句) 十六进制前 16 位>", "v": "pass|fail|unsure"}`，可以多带别的字段；同一事实以最后一行为准；事实原句改了，旧判定自动作废。

## 接到 Claude Code

项目里的 `.mcp.json`：

```json
{
  "mcpServers": {
    "memv2": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/two-memory-mcp/memv2-mcp.js"],
      "env": { "MEMV2_TOKEN_FILE": "/path/to/tokens/bot_a.token", "MEMV2_AUDIENCE": "cc" }
    },
    "javis": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/two-memory-mcp/javis-mcp.js"],
      "env": { "JAVIS_TOKEN_FILE": "/path/to/profiles/bot_a.env", "JAVIS_AUDIENCE": "cc" }
    }
  }
}
```

## 接到 DeepSeek Harness（Tobs）

- 每个 Bot 一个私有 MCP：命令 `node /path/to/memv2-mcp.js`，环境变量填令牌文件的路径。
- 或者装配套插件 `dsh-plugin-two-memory`：按 Bot 编号自动挂工具，不用卡片。

## 测试

```bash
node test/smoke.mjs
```

不需要 memv2 和 Javis 在跑：测握手、工具名单、主人名字、令牌缺失和服务没起来时的报错。

## 安全

- 令牌只放在文件里，环境变量里只写路径。
- 两个程序不往标准输出打别的东西，只有 JSON-RPC 消息；日志不记查询内容。
- 查询走本机或你指定的地址；Javis 的事实查询只按关键词，不调用嵌入模型。

## 许可证

待定（发布前由作者确定）。

---

## English summary

Two read-only stdio MCP servers for chat Bots: `memv2-mcp.js` (memv2 fact memory over its HTTP read API) and `javis-mcp.js` (Javis, a Graphiti/Neo4j memory graph, through its own MCP endpoint). No dependencies, Node 20+. Per-Bot partitions (one read-only memv2 client token per Bot; Javis accounts listed in a per-Bot profile), a hide list, a verdict filter for extracted facts, short Chinese tool text for small models. Configure with the environment variables above; tokens live in files, never in the environment. Smoke test: `node test/smoke.mjs`. A companion DeepSeek Harness plugin, `dsh-plugin-two-memory`, registers both tool sets per Bot without per-Bot private MCP cards. License: to be decided.
