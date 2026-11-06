# 发版步骤

给维护者看的。推送、打标签、发 GitHub Release、发 npm，都要仓库主人点头后再做；npm 由主人自己登录。

1. **改版本号**：`package.json` 的 `version`；在 `CHANGELOG.md` 最上面写这一版的变化（中英文各一段），标题写 `## <版本>`。
2. **提交，再打包**：`node scripts/pack.mjs`。它从已提交的内容打包，所以换行都是 LF（Windows 上的工作区是 CRLF，直接 `npm pack` 会让 Linux 和 macOS 上的命令起不来）。它先跑 `node test/smoke.mjs`，再在 `dist/` 里生成：
   - `javmem-mcp-<版本>.tgz`：发 npm 用；
   - `javmem-mcp.tgz`：同一个文件，名字不带版本号，作为 GitHub Release 的附件；
   - `SHA256SUMS`；`release-notes.md`（这一版的更新记录，贴进 Release 说明）。
3. **推送并打标签**：
   ```bash
   git push origin main
   git tag v<版本>
   git push origin v<版本>
   ```
4. **发 GitHub Release**：仓库的 Releases 页 → Draft a new release → 选标签 `v<版本>`，标题 `v<版本>`，说明贴 `dist/release-notes.md`，附件传 `dist/javmem-mcp.tgz`。
5. **发 npm**：先 `npm login`（自己登录），再 `npm publish dist/javmem-mcp-<版本>.tgz`。
6. **插件那边**：在 javmem-dsh-plugin 里运行 `node scripts/vendor-mcp.mjs <本仓库目录>`，把新版服务复制过去，再按那边的 RELEASING.md 发版。
