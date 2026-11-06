# 更新记录 / Changelog

## 0.3.0（未发布 / unreleased）

- 三个服务在 MCP 握手里报的版本号，改成读同目录的 `package.json`（以前写死，`memory-mcp.js` 还报 0.1.0）。
- 第一次发 npm：包名 `javmem-mcp`；新增命令名 `javmem-mcp`（就是合起来的 `memory-mcp.js`），所以 `npx -y javmem-mcp` 就能起服务。
- 发版文件：`node scripts/pack.mjs` 从已提交的内容打包（换行都是 LF），生成 npm 包和 GitHub Release 附件。
- 状态检查：三个程序都认 `javmem/status` 请求（不是工具），回答每个库连不连得上、令牌能不能用，不读记忆，不带令牌。
- README：开头一句话说清是什么，写明适合谁、不适合谁，接 Claude Code 的一条命令（`claude mcp add … -- npx -y javmem-mcp`）；英文版 `README.en.md` 和中文版内容对等；npm、CI、许可证徽章；CI 在 Node 20、22、24 上跑测试。

English:

- The three servers report the version in the `package.json` next to them in the MCP handshake (it was hard-coded, and `memory-mcp.js` said 0.1.0).
- First npm release, package `javmem-mcp`, with a new `javmem-mcp` command (the combined `memory-mcp.js`), so `npx -y javmem-mcp` starts the server.
- Release files: `node scripts/pack.mjs` packs the committed tree (LF line endings) into the npm tarball and the GitHub Release asset.
- Status check: all three servers answer a `javmem/status` request (not a tool) with whether each store answers and takes the token; it reads no memory and carries no token.
- README: a one-line pitch, who it is for and not for, one command for Claude Code (`claude mcp add … -- npx -y javmem-mcp`); `README.en.md` in English with the same content as the Chinese one; npm, CI and licence badges; CI runs the tests on Node 20, 22 and 24.

## 0.2.0

- `memory-mcp.js`：两个库合起来的一个服务，五个工具（recall、search、search_raw、person、read），带两库对照标记。
- 包名改成 `javmem-mcp`；MIT 许可证；README 写清前提。

English: `memory-mcp.js`, one combined server over both stores with five tools and cross-check marks; package renamed to `javmem-mcp`; MIT licence; README prerequisites.

## 0.1.0

- `memv2-mcp.js`、`javis-mcp.js`：两个单库的只读 MCP 服务。

English: `memv2-mcp.js` and `javis-mcp.js`, the two read-only single-store MCP servers.
