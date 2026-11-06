// Renders two demo answers (search and person, on the made-up demo data) as a picture for the README, with a local
// Chrome or Edge in headless mode. Maintainers only; nothing here is packed.
//   node scripts/screenshot.mjs [--prefix memory_] [--out docs/demo.png]
// BROWSER may name the browser's executable.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ask } from './demo.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const prefix = arg('--prefix', '');
const out = resolve(arg('--out', join(root, 'docs', 'demo.png')));
const browser = [process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => p && existsSync(p));
if (!browser) {
  console.error('No Chrome or Edge found; set BROWSER to its executable.');
  process.exit(1);
}

const answers = await ask([['search', { query: '游泳课 学费' }], ['person', { name: '老陈' }]]);
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const MARKS = [
  [/（图库也有）|（memv2 也有）/g, 'same'],
  [/（图库说法不同，以这条为准）|（和 memv2 说法不同，以 memv2 为准）|图库说：/g, 'diff'],
  [/（只在图库）/g, 'only'],
  [/（未细核）/g, 'soft'],
  [/另有 \d+ 条和原文对不上，没列出。/g, 'drop'],
];
const mark = (text) => MARKS.reduce((t, [re, cls]) => t.replace(re, (m) => `<b class="${cls}">${m}</b>`), escape(text));
const blocks = answers.map(([tool, args, text]) => `
  <section>
    <div class="call"><span class="tool">${prefix}${tool}</span><span class="args">${escape(Object.values(args).join(' '))}</span></div>
    <pre>${mark(text)}</pre>
  </section>`).join('');
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  body { margin: 0; background: #eef1f5; font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif; }
  .card { margin: 24px; background: #fff; border: 1px solid #d0d7de; border-radius: 10px; padding: 18px 22px; }
  .title { color: #57606a; font-size: 14px; margin-bottom: 10px; }
  section { margin-top: 14px; }
  .call { font-size: 15px; margin-bottom: 6px; }
  .tool { background: #24292f; color: #fff; border-radius: 6px; padding: 2px 9px; font-family: Consolas, "Cascadia Mono", monospace; }
  .args { color: #24292f; margin-left: 10px; }
  pre { margin: 0; background: #f6f8fa; border-radius: 8px; padding: 12px 14px; font-size: 14px; line-height: 1.65;
        white-space: pre-wrap; word-break: break-all; font-family: Consolas, "Microsoft YaHei", "PingFang SC", monospace; color: #24292f; }
  b { font-weight: 600; border-radius: 4px; padding: 0 2px; }
  .same { background: #dafbe1; color: #116329; } .diff { background: #fff1d6; color: #9a6700; }
  .only { background: #ddf4ff; color: #0550ae; } .soft { color: #6e7781; font-weight: 400; } .drop { background: #ffebe9; color: #a40e26; }
</style></head><body><div class="card"><div class="title">javmem-mcp · 演示数据（虚构的小明一家）· 两个库对照着回答</div>${blocks}</div></body></html>`;

// Height: the frame plus each line at 23 px, a line wrapping at about 78 characters.
const lines = answers.reduce((n, [, , text]) => n + 2.6 + text.split('\n').reduce((k, l) => k + Math.max(1, Math.ceil(l.length / 78)), 0), 0);
const height = Math.round(96 + lines * 23);
const dir = mkdtempSync(join(tmpdir(), 'javmem-shot-'));
const page = join(dir, 'demo.html');
writeFileSync(page, html, 'utf8');
mkdirSync(dirname(out), { recursive: true });
// Its own profile folder, so a browser that is already open does not take the job over and drop it. A headless
// browser started right after another sometimes exits without a picture, so it gets a second try.
let r;
for (let attempt = 1; attempt <= 2 && !existsSync(out); attempt += 1) {
  r = spawnSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--user-data-dir=${join(dir, `profile-${attempt}`)}`, '--no-first-run', '--no-default-browser-check',
    `--window-size=1000,${height}`, `--screenshot=${out}`, pathToFileURL(page).href], { encoding: 'utf8', timeout: 60000 });
}
if (!existsSync(out)) {
  console.error(`The browser wrote no picture: ${r.stderr || r.error || r.status}`);
  process.exit(1);
}
console.log(`wrote ${out} (1000 x ${height})`);
