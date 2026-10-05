/**
 * npm run demo 后半程：把 esbuild 产物（JS / CSS）内联进 HTML 模板 → demo/squarefolk.html。
 * 打包自检：文件存在、含 <!DOCTYPE html>、无 src= / href= 外链（file:// 双击即玩，零外部请求）。
 */
import { readFile, stat, writeFile } from 'node:fs/promises';

const JS_PATH = 'demo/.build/bundle.js';
const CSS_PATH = 'demo/.build/bundle.css';
const TEMPLATE_PATH = 'demo/template.html';
const OUT_PATH = 'demo/squarefolk.html';

const template = await readFile(TEMPLATE_PATH, 'utf8');
const js = await readFile(JS_PATH, 'utf8').catch(() => null);
const css = await readFile(CSS_PATH, 'utf8').catch(() => null);
if (js === null || css === null) {
  console.error(`✗ 缺少 esbuild 产物：${js === null ? JS_PATH : ''} ${css === null ? CSS_PATH : ''}`.trim());
  process.exit(1);
}

for (const [placeholder, payload] of [
  ['/*__CSS__*/', css],
  ['/*__JS__*/', js],
]) {
  if (!template.includes(placeholder)) {
    console.error(`✗ 模板缺少占位符 ${placeholder}`);
    process.exit(1);
  }
}

// 函数型替换值：避免 JS/CSS 里的 $& $1 等被当成替换模式
const html = template
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => js);

await writeFile(OUT_PATH, html);

// ── 自检 ──
const failures = [];
if (!/<!\s*DOCTYPE html>/i.test(html)) failures.push('缺少 <!DOCTYPE html>');
if (/\s(?:src|href)\s*=/i.test(html)) failures.push('存在 src= / href= 外链');
const remote = html.match(/https?:\/\/[^\s"')]+/g);
if (remote !== null) console.warn(`! 含 URL 文本（非外链，仅提示）：${[...new Set(remote)].slice(0, 5).join(', ')}`);

if (failures.length > 0) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  process.exit(1);
}

const info = await stat(OUT_PATH);
const kb = (info.size / 1024).toFixed(1);
console.log(`✓ ${OUT_PATH} · ${info.size} bytes（${kb} KiB）· JS ${js.length} B · CSS ${css.length} B`);
console.log(`✓ <!DOCTYPE html> 存在 · 无 src= / href= 外链 · file:// 双击即玩`);
