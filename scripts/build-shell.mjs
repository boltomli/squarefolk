#!/usr/bin/env node
/**
 * shell 构建：demo 单文件 → Neutralinojs 壳 → 跨平台可执行（design §5.9.1 轨 B / v0.27）。
 *
 * 步骤：清 exFAT `._*` → `npm run demo` → 拷 `resources/game.html` → `neu build --embed-resources`
 * →（macOS）自建真 `.app`。
 *
 * 两个实测事实（2026-10-07，勿回退）：
 * 1. **必须 `--embed-resources`**：分发二进制与 `resources.neu` 不同目录时会回落
 *    Neutralinojs 官方欢迎页（用户报的「打开是项目主页」）；嵌入后单文件即游戏。
 * 2. `neu build --macos-bundle` 在 neu v11.8 只把裸二进制改名 `.app`（`open` 报
 *    incorrect executable format）→ 真 bundle 由本脚本 assembleApp() 自建。
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHELL = join(ROOT, 'shell');
const DIST = join(SHELL, 'dist', 'squarefolk');

/** 解析 neu：PATH 可能不含 homebrew（实测丢过）、neu 可能装在 npm global bin —— 逐位探测 */
function findNeu() {
  const candidates = [
    '/opt/homebrew/bin/neu', '/usr/local/bin/neu',
    join(process.env.HOME ?? '', '.local/bin/neu'),
    join(process.env.HOME ?? '', '.npm-global/bin/neu'),
    join(dirname(process.execPath), 'neu'), // npm prefix -g 的 bin（node 同目录）
    join(process.env.HOME ?? '', '.bun/bin/neu'),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return 'neu'; // 让 spawnSync 走 PATH，找不到时由 run() 报安装提示
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.error && r.error.code === 'ENOENT') {
    console.error(`✗ 找不到 ${cmd} —— 若是 neu：npm i -g @neutralinojs/neu`);
    process.exit(1);
  }
  if (r.status !== 0) { console.error(`✗ ${cmd} ${args.join(' ')} 失败（${r.status}）`); process.exit(r.status ?? 1); }
}

/** exFAT 会持续生成 AppleDouble 幽灵，会打进 resources.neu/产物 —— 构建前清干净 */
function cleanAppleDouble(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.name.startsWith('._')) rmSync(p, { force: true });
    else if (e.isDirectory()) cleanAppleDouble(p);
  }
}

/** macOS 真 .app：Info.plist + embed 二进制（见文件头事实 2） */
function assembleApp() {
  const bin = join(DIST, 'squarefolk-mac_arm64');
  if (!existsSync(bin)) { console.error(`✗ 找不到 ${bin}`); process.exit(1); }
  const app = join(DIST, 'Squarefolk.app');
  rmSync(app, { recursive: true, force: true });
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
  cpSync(bin, join(app, 'Contents', 'MacOS', 'squarefolk'));
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>squarefolk</string>
  <key>CFBundleIdentifier</key><string>app.squarefolk.demo</string>
  <key>CFBundleName</key><string>Squarefolk</string>
  <key>CFBundleDisplayName</key><string>Squarefolk</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`;
  writeFileSync(join(app, 'Contents', 'Info.plist'), plist);
  // exFAT 在文件写入瞬间生成 ._ 幽灵，会把 codesign 绊倒（实测 "code object is not signed at all /
  // In subcomponent: ._Info.plist"）→ 签名前把包内幽灵清干净
  cleanAppleDouble(app);
  // macOS 27 的 launchd 拒绝无签名 bundle（errno 163 spawn failed，2026-10-07 实测）→ adhoc 签名必须有
  const cs = spawnSync('codesign', ['-s', '-', '--force', app], { stdio: 'inherit' });
  if (cs.status !== 0) { console.error('✗ codesign adhoc 失败'); process.exit(1); }
  console.log(`✓ ${app}（已 adhoc 签名）`);
}

function human(kb) { return `${(kb / 1024).toFixed(1)} MB`; }

// ── 主流程 ──
cleanAppleDouble(SHELL);

console.log('→ npm run demo');
run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'demo'], ROOT);

mkdirSync(join(SHELL, 'resources'), { recursive: true });
// 入口必须叫 index.html：运行时资源加载器只认 /resources/index.html（config 的 url 字段实测不生效，
// 2026-10-07 日志 NE_RS_UNBLDRE 实证；PoC 能跑是因为模板自带 index.html）
cpSync(join(ROOT, 'demo', 'squarefolk.html'), join(SHELL, 'resources', 'index.html'));
console.log('→ resources/index.html 已同步');

// 平台二进制（bin/ 不入库）：缺则拉取。GitHub 对本机网络间歇超时且 neu 无自动重试 → 手动重试一次（PoC 实录坑）
if (!existsSync(join(SHELL, 'bin'))) {
  console.log('→ neu update（拉取平台二进制）');
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const r = spawnSync(findNeu(), ['update'], { cwd: SHELL, stdio: 'inherit' });
    if (r.status === 0) break;
    if (attempt === 2) { console.error('✗ neu update 两次失败（多半是网络超时，稍后重跑 npm run shell）'); process.exit(1); }
    console.error('! neu update 失败，3 秒后重试一次…');
    spawnSync(process.platform === 'win32' ? 'timeout' : 'sleep', process.platform === 'win32' ? ['3'] : ['3'], { stdio: 'inherit' });
  }
}

console.log('→ neu build --embed-resources');
run(findNeu(), ['build', '--embed-resources'], SHELL);

if (process.platform === 'darwin') assembleApp();

// 产物清单
console.log('\n产物：');
for (const f of readdirSync(DIST).sort()) {
  if (f.startsWith('._') || f === 'neutralinojs.log') continue;
  const p = join(DIST, f);
  const kb = statSync(p).isDirectory() ? Math.ceil(dirKb(p) / 1024) : Math.ceil(statSync(p).size / 1024);
  console.log(`  ${String(kb).padStart(8)} KB  ${f}`);
}
console.log('\n✓ 完成（win/linux 为裸可执行——已嵌资源，单文件即游戏；上传 itch 时按通道选对应文件）');

function dirKb(dir) {
  // 内部一律返回 BYTES，递归子目录不能再当字节加（曾把 KB 当 bytes 累加 → 产物清单显示 1KB 假数）
  let total = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    total += statSync(p).isDirectory() ? dirKb(p) : statSync(p).size;
  }
  return total;
}
