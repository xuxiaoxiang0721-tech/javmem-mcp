# javmem-mcp

[中文](README.md) | English

[![npm](https://img.shields.io/npm/v/javmem-mcp)](https://www.npmjs.com/package/javmem-mcp)
[![test](https://github.com/xuxiaoxiang0721-tech/javmem-mcp/actions/workflows/test.yml/badge.svg)](https://github.com/xuxiaoxiang0721-tech/javmem-mcp/actions/workflows/test.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**A read-only memory MCP server that asks the memv2 fact store and the Javis memory graph at once and answers with the two checked against each other; it works with Claude Code, DeepSeek Harness and other MCP clients.**

This memory is called javmem: memv2 keeps facts (who, when, how much), Javis keeps the relations and timeline of people and things (Graphiti + Neo4j). javmem-mcp gives a model both as one tool: a fact both stores hold is listed once, a different wording is listed next to it and memv2 counts; every Bot queries with its own token and sees only its own share. The servers store nothing themselves; they only query the two stores for the model.

## Why javmem

1. **Built for personal Bots, so it can afford good models.** One person's conversations are nowhere near commercial data volumes, so javmem doesn't skimp on the model that extracts memory: the same person has to be recognised as the same person, relations linked correctly and events put in order, and the better the model, the more accurate it gets. If you'd rather pay nothing, zero-setup mode costs nothing at all.
2. **Bring your past in one go.** Most memory plugins start remembering on the day you install them. javmem comes with an export prompt: paste it into a tool like Grok, ChatGPT or Claude, and it writes what it remembers and the topics you talked about into one package, imported in one go.
3. **Two stores, each with its own job: the more it holds, the more it resembles a real person.** With the full backend, memv2 keeps what is true: facts, numbers, dates. The graph keeps who, when, where, and how things changed later. The original words are kept too, down to how someone phrases things. Outdated statements are marked as no longer valid, so it can tell what you thought then from what you think now, and where the two stores disagree it says so. The more memory builds up, the more faithfully it can reconstruct a real person: groundwork for a digital human.
4. **Read-only, so a Bot can't rewrite your past.** Memory has only two ways in, both outside the model's hands: the Bot program itself packages new conversations and delivers them to the store, and you import your own history; the model can look things up but never write, so it can't slip a guess of its own into memory, and instructions smuggled in by a web page or another Bot can't make it delete or change what is remembered.

## Who it is for, and who it is not for

For:

- people who already run memv2 and Javis and want Claude Code and chat Bots to query that memory;
- people with several Bots, each querying its own memory: the partitions sit on each Bot's token and profile;
- people who want what is found checked before it is shown: Javis's facts show only when they match the source text, and wrong ones can go on a hide list.

Not for:

- people without memv2 and Javis who do not plan to set them up: the two stores are not publicly released at the moment (see Prerequisites);
- people who want the server to record new conversations: it is read-only, and memory is written through memv2's and Javis's own imports.

In DeepSeek Harness's Tobs, the companion plugin [javmem-dsh-plugin](https://github.com/xuxiaoxiang0721-tech/javmem-dsh-plugin) gives these tools to the Bots you list, without an MCP server per Bot.

## Quick start

1. **Prepare**: Node 20 or later; memv2 and Javis running, and a token file for every Bot (see Prerequisites).
2. **Get the servers**, either way:
   - the npm package (once published): `npx -y javmem-mcp` starts the combined server, nothing to download first;
   - git: `git clone https://github.com/xuxiaoxiang0721-tech/javmem-mcp.git`; no dependencies, no `npm install`.
3. **Self-test** (git): `node test/smoke.mjs`; the two stores need not run.
4. **Connect**: see "With Claude Code" and "With DeepSeek Harness (Tobs)" below. Set at least `MEMV2_TOKEN_FILE` and `JAVIS_TOKEN_FILE`.

## Try it first: demo data

See it work without either store: set both `MEMV2_URL` and `JAVIS_URL` to `demo`, and the servers answer from the made-up data that ships with the package, in the same format as the real stores, with no token. The data is a fictional 小明 (Xiao Ming): his daughter's swimming lessons, his colleague 老陈 (Lao Chen) moving to another office, a November trip to 千岛湖 (Qiandao Lake).

![Demo: both stores checked against each other](docs/demo.png)

- In a terminal: after `git clone`, run `node scripts/demo.mjs` to ask each of the five tools once.
- In Claude Code (once the npm package is published): `claude mcp add javmem-demo -e MEMV2_URL=demo -e JAVIS_URL=demo -- npx -y javmem-mcp`, then ask 「小雨的游泳课学费交了多少？」 (how much were the swimming lessons?) or 「老陈最近怎么了？」 (what is up with Lao Chen?).
- The data holds each case on purpose: both stores agree (「图库也有」); they differ (a fee of 2400 against 2600, and memv2 counts); a fact only the graph has; and a made-up fact the source text does not back, which is dropped (the answer says 「另有 1 条和原文对不上」, one more did not match the source). Partitions work too: `MEMV2_NAMESPACE=work` with `MEMV2_BOT_ONLY=1` shows work only, `JAVIS_SOURCES=chatgpt` one account only.

## With Claude Code

One command (once the npm package is published):

```bash
claude mcp add javmem -e MEMV2_TOKEN_FILE=/path/to/tokens/bot_a.token -e JAVIS_TOKEN_FILE=/path/to/profiles/bot_a.env -e MEMORY_AUDIENCE=cc -- npx -y javmem-mcp
```

Or in the project's `.mcp.json`, the combined tools:

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

Or the two stores apart:

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

`MEMORY_AUDIENCE=cc` (or either store's `*_AUDIENCE=cc`) marks the tools read-only, so Claude Code can use them in plan mode too, and words the guidance for Claude Code.

## With DeepSeek Harness (Tobs)

- Install the companion plugin [javmem-dsh-plugin](https://github.com/xuxiaoxiang0721-tech/javmem-dsh-plugin): tools per Bot id, no cards (recommended).
- Or one private MCP server per Bot: command `node /path/to/memory-mcp.js`, with that Bot's token file paths in the environment.

## The four servers

| Server | Talks to | Tools |
|---|---|---|
| `memory-mcp.js` (command `javmem-mcp`) | **both stores as one tool** (recommended) | `recall`, `search`, `search_raw`, `person`, `read` |
| `memv2-mcp.js` | memv2, a fact memory service (its HTTP read API) | `recall`, `search`, `search_raw`, `read_record` |
| `javis-mcp.js` | Javis, a Graphiti + Neo4j memory graph (through its own MCP endpoint) | `search_memory`, `get_entity`, `find_sessions`, `get_conversation` |
| `local-mcp.js` (command `javmem-local`) | the local store: one SQLite file on this machine, zero setup | `recall`, `search`, `search_raw`, `person`, `read` |

All four speak stdio, have no dependencies and use only Node's built-in modules (Node 20 or later; the local store uses Node's own SQLite, Node 22.5 or later). Tool descriptions and results are in Chinese and kept short for small models' context.

## The combined server memory-mcp.js

One MCP server over both stores, five tools instead of the eight of the two apart:

| Tool | What it does |
|---|---|
| `recall` | memv2 facts about this turn's topic; a fact both stores hold is marked 「图库也有」 (the graph has it too) |
| `search` | both stores at once: memv2's facts first (facts and amounts count from memv2), then the graph's people, relations and timeline; a fact both hold is listed once, a different wording goes under memv2's line as 「图库说：…」 (the graph says) |
| `search_raw` | keyword search over both stores' original text, one line per message, with record keys and session ids |
| `person` | all relations of this person in the graph (by time; the name must match), plus memv2's facts about them (by time) |
| `read` | a memv2 record by its record key, or a graph conversation page by page by its session id |

- It loads `memv2-mcp.js` and `javis-mcp.js` from its folder for their queries and filters (partitions, hide list, fact checks), so it takes both stores' settings (`MEMV2_*`, `JAVIS_*`, `MEMORY_*`).
- When one store fails or is not configured, the other still answers, and the reply says which one did not.
- Marks: with `MEMORY_LABELS_FILE` set, every item carries the two stores' cross-check result. The file:

  ```json
  {"version": 1, "memv2": {"<item_id>": {"l": "两边一致", "same": ["<javis uuid>"]}},
   "javis": {"<uuid>": {"l": "只在图库"}}}
  ```

  `l` is one of `两边一致` (both agree), `两边不同` (they differ; `diff` lists the differing fact), `只在 memv2` (memv2 only), `只在图库` (graph only). Your own cross-check program writes it, with ids and labels only, never text; without it there are no marks.

## The local store local-mcp.js (zero setup)

No memv2, no Javis, no service to start: it reads one local store file (`JAVMEM_LOCAL_DB`) holding past conversations (javmem-dsh-plugin builds one per Bot from DSH's sessions) and, later, memory inherited from other AI tools.

- The tools have the same names as the combined set (`recall`, `search`, `search_raw`, `person`, `read`), so a Bot's rules stay the same when its backend changes.
- Full-text search with SQLite FTS5. Chinese is indexed as pairs of neighbouring characters (游泳课 → 游泳, 泳课), so two-character words are found inside a sentence; other text by words. `recall` scores the pieces of a whole sentence, `search` takes keywords, `search_raw` the exact words.
- It opens the store read-only; while the file does not exist yet it answers "nothing yet" instead of failing. `javmem/status` reports sessions, messages and the last update.
- `local-store.js` reads and writes the store; the writer (the DSH plugin's indexer) shares it.

## Memory inherited from other AIs: javmem-inherit

What another AI tool (Grok, Muse, Dot, ChatGPT and the like) remembers about you can move into javmem, so a Bot starts with a past:

1. **Get the prompt**: `npx -y -p javmem-mcp javmem-inherit prompt --en` (without `--en` in Chinese), or copy [docs/inherit-prompt.md](docs/inherit-prompt.md).
2. **Paste it into that AI**: it writes what it remembers in a fixed form (JSON), in several parts when there is a lot. Copy the whole answer into one file, such as `grok.json`; several parts can share the file, and the chatter and code fences around them can stay.
3. **Check**: `javmem-inherit check grok.json` reports facts, conversations and problems, never the text.
4. **Import**: with the DSH plugin, put the file in `<DSH home>/javmem/inherit/<Bot name or id>/` and the plugin adds it to that Bot's local store on its next pass; on your own, `javmem-inherit import grok.json --db <local store file>`, then query it with `local-mcp.js`.
5. Every item is marked 「继承自 Grok」 (inherited from Grok) with the export date; the same file imported again adds nothing.

Inherited memory was never checked against the original conversations, and the tool text tells the model to name where it came from.

## The graph on the official Graphiti server (backend C)

Javis is not public, so the graph can be the official [Graphiti](https://github.com/getzep/graphiti) MCP server (maintained by Zep) instead: `backend/graphiti/` has a recipe (one Docker container; models from OpenAI, DeepSeek with Qwen, or a local Ollama), see [backend/graphiti/README.md](backend/graphiti/README.md).

- **In**: `javmem-feed` sends the local store's conversations to Graphiti in episodes of up to 8 messages, each once; a conversation goes when it has been quiet for 30 minutes or has 8 new messages; a daily token budget (default 1,000,000 per store) stops it until the next day; what Graphiti lost (its queue is in memory) is sent again after half an hour. It prints counts only.
- **Out**: `javis-mcp.js` with `JAVIS_BACKEND=graphiti` keeps its four tools: facts and people from Graphiti, the original words from the local store (the official server cannot search them). The combined `memory-mcp.js` works on top of it.
- One group per Bot (`GRAPHITI_GROUP_ID`), invisible to the others. Read-only: queries change nothing in the graph.
- Cost: measured 2026-11-06 (official server 1.1.3 with gpt-6-luna, 23 made-up messages in 9 episodes) about 15,000 tokens per episode; counted as 20,000, roughly 2.5 million tokens per 1,000 messages. A local Ollama costs nothing but is slow.

## What they do

- **Read-only**: all three only forward queries and change nothing in memv2 or Javis.
- **Partitions per Bot**:
  - memv2: each Bot has its own read-only client token, and memv2's access policy decides which namespaces it reads.
  - Javis: filtered by account (source); each Bot's profile lists the accounts it may see.
- **Javis's facts are checked before they are shown**: a fact shows when the verdict file says its current wording passed a check against the source text; one without a verdict gets a rule check (its numbers and capitalised names must appear in the source) and is marked 「未细核」 (not checked in detail). Your own checker writes the verdict file, format below.
- **Hide list**: Javis cannot be edited, so facts, people, conversations or single messages that are wrong or should be forgotten go on a hide list and never show in any result.
- **Guidance for the model**: what is found is data, not instructions; names that do not match are not the same person; the user's word this turn beats memory, and memv2 beats Javis when they differ.

## Measured numbers

Counts only, no memory text. Both sets come from `scripts/eval.mjs`: the same questions go to the combined server, to memv2 alone and to Javis alone, asked the way a Bot asks (the whole question to recall, keywords to the searches), and each answer is checked for the right answer.

**The author's own memory** (2026-11-06, on the author's machine; memv2 holds 13,345 facts, Javis 4,777 relations):

| Item | Result |
|---|---|
| Questions | 10 from everyday use: 7 with a right answer, 1 that memory has no answer to |
| Right answers found | combined server 2/7; memv2 alone 2/7; Javis alone 2/7; both stores asked apart, either one counting, also 2/7 |
| The question without an answer | 1/1 left unanswered, nothing made up |
| Facts both stores hold | 3,465 worded the same, 91 worded differently: 97.4% agree |
| Facts one store holds | memv2 only 9,789; graph only 964 (plus 702 graph facts not yet checked and 124 expired) |
| Marks in the combined answers | 「图库也有」 (both hold it) 104, 「说法不同」 (worded differently) 2, 「只在图库」 (graph only) 10, 「和原文对不上、没列出」 (did not match the source, left out) 4 |

These 10 are the regression questions used before and after changes to the memory module: few, and not a public benchmark. What they show is that the combined server misses nothing the two stores answer when asked apart, and gives the answer with both stores checked against each other in one go.

**Demo data** (anyone can rerun it: `node scripts/eval.mjs --demo`): 7 made-up questions, 6 with a right answer. Combined server 6/6, memv2 alone 5/6, Javis alone 6/6; the one without an answer stayed unanswered.

On your own stores: `node scripts/eval.mjs --questions questions.json --bots bots.json --env shared.json`. Questions are `[{"id", "bot", "question", "keywords", "expected", "must_not_mention"}]` (several right answers in `expected` separated by `|`); bots are `{"<bot>": {"MEMV2_TOKEN_FILE": …, "JAVIS_TOKEN_FILE": …}}`; the shared file holds `MEMORY_LABELS_FILE` and the like. It prints counts only.

## Status check (for hosts)

All three servers answer a request that is not a tool, `javmem/status` (JSON-RPC, empty params): whether each store answers and takes the token (`state` is one of `ok`, `bad_token`, `down`, `no_token`, `error`), for Javis also whether the hide list can be read, and for the combined server whether the labels file is there. It reads no memory: memv2 is asked for a record that cannot exist (memv2 checks the token before it looks, so "not found" means the token works), Javis for its tool list. The answer carries no token and no memory text. javmem-dsh-plugin's `memory_status` tool is built on it.

## Prerequisites

The servers store no memory; they only query the two memory stores for the Bots. So they need:

- **memv2 running**, at an address they know (default `http://127.0.0.1:8766`, port 8766 on this machine). Every Bot needs a read-only token, its library card so to speak: memv2's administrator issues it and decides at that moment which partitions (namespaces, in memv2) it may read. The token lives in a file; the configuration only holds that file's path (`MEMV2_TOKEN_FILE`).
- **Javis running**, at an address they know (default `http://127.0.0.1:8765/mcp`), and Javis's token, also in a file. The accounts each Bot may see are in that Bot's profile (`JAVIS_TOKEN_FILE`, format below).

**Note**: memv2 and Javis themselves are not publicly released at the moment, and `memv2-mcp.js` and `javis-mcp.js` talk to their own query interfaces by default. Without them: the local store works as installed, and the graph can be the official Graphiti server (`JAVIS_BACKEND=graphiti`, see "The graph on the official Graphiti server").

## Configuration (environment variables)

### memv2-mcp.js

| Variable | Meaning |
|---|---|
| `MEMV2_TOKEN_FILE` | required. Path of the file holding the read-only client token (never the token itself in the environment) |
| `MEMV2_NAMESPACE` | one namespace only; unset = everything the client may read |
| `MEMV2_BOT_ONLY` | `1` = only that namespace, without the shared area |
| `MEMV2_URL` | default `http://127.0.0.1:8766`; `demo` = the made-up demo data in the package (see "Try it first") |
| `MEMV2_PURPOSE` | `eval` = send `X-IM-Purpose: eval`, so memv2 counts test calls apart |
| `MEMV2_AUDIENCE` | `cc` = the reader is a Bot's Claude Code (tools marked read-only); unset = the Bot's chat front |

### javis-mcp.js

| Variable | Meaning |
|---|---|
| `JAVIS_TOKEN_FILE` | required. The Bot's profile (`KEY=value` lines: `JAVIS_SOURCES=<accounts, comma separated, or *>`, `JAVIS_TOKEN_FROM=<the file holding Javis's token>`), or that token file itself (then every account is shown) |
| `JAVIS_SOURCES` | overrides the profile's accounts; `*` = all |
| `JAVIS_URL` | default `http://127.0.0.1:8765/mcp` (with Graphiti `http://127.0.0.1:8000/mcp/`); `demo` = the made-up demo data in the package |
| `JAVIS_BACKEND` | `graphiti` = the official Graphiti server (it needs no token, so `JAVIS_TOKEN_FILE` may stay unset) |
| `GRAPHITI_GROUP_ID` | with Graphiti: this Bot's group, default `main` |
| `JAVMEM_LOCAL_DB` | required with Graphiti: the local store (the original words live there; `javmem-feed` sends from it) |
| `JAVIS_HIDE_FILE` | the hide list, default `hidden.json` next to the server (missing = nothing hidden) |
| `JAVIS_VERIFY_FILE` | the verdict file, default `verify/verdicts.jsonl` next to the server (missing = every fact gets the rule check) |
| `JAVIS_AUDIENCE` | as above |

### local-mcp.js

| Variable | Meaning |
|---|---|
| `JAVMEM_LOCAL_DB` | required. The local store file; a file that does not exist yet = nothing stored yet |
| `MEMORY_AUDIENCE` | `cc` = for Claude Code (tools marked read-only) |

### Shared by all three

| Variable | Meaning |
|---|---|
| `MEMORY_OWNER` | whose memory it is, as the tool text names them (default 「用户」, the user) |
| `MEMORY_SOURCE` | what the original records are (default 「以前和 AI 的对话」, past conversations with AI) |
| `MEMORY_FIX_HOW` | whom to ask when a memory is wrong (memv2's default: memv2's administrator with memv2's commands; Javis's: Javis's administrator, who puts it on the hide list) |
| `MEMORY_SPEAKERS` | Javis only: other names a fact may use for "I" or "you", comma separated (an assistant's name, say) |

### File formats

- The hide list `hidden.json`: `{"facts": [...], "entities": [...], "sessions": [...], "messages": [...]}`, each item an id string or `{"id": "..."}`. A single message goes by fingerprint: `"fp:"` plus the first 32 hex digits of `sha256(role + "\n" + timestamp + "\n" + the first 600 characters)`.
- The verdict file `verdicts.jsonl`: one `{"id": "<fact uuid>", "h": "<first 16 hex digits of sha256(fact text)>", "v": "pass|fail|unsure"}` per line, other fields allowed; the last line per fact counts; when a fact's wording changes, its old verdict no longer applies.

## Tests

```bash
node test/smoke.mjs
```

No memv2 or Javis needed: the three servers' handshake (with the version), tool lists, owner name, the errors for a missing token and a service that is down, the combined server answering when one store fails, the states of `javmem/status`, and all thirteen tools on the demo data. GitHub Actions runs it on Node 20, 22 and 24. `node scripts/screenshot.mjs` redraws the picture (it needs a local Chrome or Edge).

## Safety

- Tokens live in files only; the environment holds paths.
- The servers write nothing to stdout but JSON-RPC messages, and log no queries.
- Queries go to this machine or the addresses you set; Javis's fact search is keyword-only and calls no embedding model.

## Releasing

Steps in [RELEASING.md](RELEASING.md); changes in [CHANGELOG.md](CHANGELOG.md).

## License

MIT, see [LICENSE](LICENSE).
