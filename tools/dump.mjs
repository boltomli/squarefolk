#!/usr/bin/env node
/**
 * Squarefolk `dump` CLI —— design §6.1 的**薄壳**：fs 读五件数据 + JSON.parse + 调纯核心。
 * 渲染逻辑在 tools/dump-core.mjs（纯函数、零 node API），CLI 与桌面编辑器「导出」共用。
 *
 * 用法：node tools/dump.mjs [dataDir] [outFile]
 *   dataDir 默认 <repo>/data；outFile 缺省打印到 stdout。
 * 退出码：0 = 成功；1 = 读取/解析失败。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dumpMarkdown } from './dump-core.mjs';
import { CONTENT_PAIRS } from './validate-core.mjs';

const REPO_DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

/** 读 dataDir 下五个数据文件（schema 不需要）→ 对象；失败抛错 */
export function loadContent(dataDir = REPO_DATA_DIR) {
  const files = {};
  for (const [dataFile] of CONTENT_PAIRS) {
    files[dataFile] = JSON.parse(readFileSync(path.join(dataDir, dataFile), 'utf8'));
  }
  const { 'units.json': units, 'techs.json': techs, 'improvements.json': improvements, 'resources.json': resources, 'balance.json': balance } = files;
  return { units, techs, improvements, resources, balance };
}

// ── CLI ──
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dataDir = process.argv[2] ? path.resolve(process.argv[2]) : REPO_DATA_DIR;
  const outFile = process.argv[3] ? path.resolve(process.argv[3]) : null;
  let markdown;
  try {
    markdown = dumpMarkdown(loadContent(dataDir));
  } catch (e) {
    console.error(`dump FAIL — ${e.message}`);
    process.exit(1);
  }
  if (outFile) {
    writeFileSync(outFile, markdown);
    console.log(`dump OK — ${path.relative(process.cwd(), outFile)}（${markdown.length} 字节）`);
  } else {
    process.stdout.write(markdown);
  }
}
