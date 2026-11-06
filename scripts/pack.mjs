// Builds the release files from the committed tree (HEAD), so the package has LF line endings whatever this checkout
// uses, and nothing uncommitted slips in. The tests run on that copy first. Writes, in dist/:
//   <name>-<version>.tgz   for npm publish
//   <name>.tgz             the same file under a version-free name: the GitHub Release asset, so a
//                          releases/latest/download/<name>.tgz link keeps working after the next release
//   SHA256SUMS             checksums of both
//   release-notes.md       this version's section of CHANGELOG.md, for the GitHub Release text
//   node scripts/pack.mjs
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const copy = join(dist, '.pack');
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
const git = (args, encoding = 'utf8') => {
  const r = spawnSync('git', args, { cwd: root, encoding, maxBuffer: 64 << 20 });
  if (r.status !== 0) fail(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
};

if (git(['status', '--porcelain']).trim()) fail('The working tree has uncommitted changes. Commit them first: the package is built from HEAD.');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// The committed files, byte for byte as git stores them (LF), in dist/.pack/.
rmSync(copy, { recursive: true, force: true });
for (const path of git(['ls-tree', '-r', '-z', '--name-only', 'HEAD']).split('\0').filter(Boolean)) {
  const file = join(copy, path);
  const bytes = git(['cat-file', 'blob', `HEAD:${path}`], 'buffer');
  if (['.js', '.mjs', '.json', '.md', '.yml'].includes(extname(path)) && bytes.includes(13)) fail(`${path} has CR line endings in git`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}

// The package's own tests, on the copy.
const [command, ...args] = String(pkg.scripts?.test || '').split(/\s+/);
if (command !== 'node') fail('package.json scripts.test must be a node command');
if (spawnSync(process.execPath, args, { cwd: copy, stdio: 'inherit' }).status !== 0) fail('The tests failed; nothing was packed.');

mkdirSync(dist, { recursive: true });
const windows = process.platform === 'win32';
const packed = windows
  ? spawnSync(`npm pack --json --pack-destination "${dist}"`, { cwd: copy, encoding: 'utf8', shell: true })
  : spawnSync('npm', ['pack', '--json', '--pack-destination', dist], { cwd: copy, encoding: 'utf8' });
if (packed.status !== 0) fail(`npm pack failed: ${packed.stderr}`);
const info = JSON.parse(packed.stdout)[0];
const versioned = join(dist, info.filename);
const plain = `${pkg.name}.tgz`;
copyFileSync(versioned, join(dist, plain));
const sha = createHash('sha256').update(readFileSync(versioned)).digest('hex');
writeFileSync(join(dist, 'SHA256SUMS'), `${sha}  ${info.filename}\n${sha}  ${plain}\n`);

// This version's CHANGELOG section: from its "## <version>" heading to the next "## ".
const lines = readFileSync(join(copy, 'CHANGELOG.md'), 'utf8').split('\n');
const start = lines.findIndex((l) => l.startsWith(`## ${pkg.version}`));
if (start < 0) fail(`CHANGELOG.md has no "## ${pkg.version}" section`);
const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
writeFileSync(join(dist, 'release-notes.md'), `${lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim()}\n`);

rmSync(copy, { recursive: true, force: true });
console.log(`${info.filename} (${info.size} bytes, ${info.entryCount} files, from ${git(['rev-parse', '--short', 'HEAD']).trim()})`);
for (const f of info.files) console.log(`  ${f.path}`);
console.log(`sha256 ${sha}\nalso ${plain}, SHA256SUMS, release-notes.md in ${dist}`);
