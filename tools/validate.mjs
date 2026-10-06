#!/usr/bin/env node
/**
 * Squarefolk `validate` CLI —— design §6.1 的**薄壳**：fs 读文件 + JSON.parse + 调纯核心。
 * 校验逻辑（Schema 子集解释器 + 交叉引用）全部在 tools/validate-core.mjs（纯函数、零 node API），
 * CLI / validate-selftest / 桌面编辑器 webview 三个宿主共用同一核心，禁止在宿主里重实现。
 *
 * 用法：node tools/validate.mjs [dataDir]   （默认 <repo>/data）
 * 退出码：0 = 全部通过；1 = 有错误（或数据/schema文件缺失 / schema 用了子集外关键字）。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CONTENT_PAIRS, validateDataFiles } from './validate-core.mjs';

const REPO_DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

/** 读 JSON；失败时把错误写进 errors 并返回 null */
function loadJson(file, label, errors) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    errors.push(`${label}: 读取/解析失败 — ${e.message}`);
    return null;
  }
}

/** 全量校验：dataDir 下五个数据文件 + dataDir/schemas 下五个 schema → 错误数组（空 = 通过） */
export function runValidate(dataDir = REPO_DATA_DIR) {
  const errors = [];
  const data = {};
  const schemas = {};
  for (const [dataFile, schemaFile] of CONTENT_PAIRS) {
    data[dataFile] = loadJson(path.join(dataDir, dataFile), dataFile, errors);
    schemas[schemaFile] = loadJson(path.join(dataDir, 'schemas', schemaFile), `schemas/${schemaFile}`, errors);
  }
  errors.push(...validateDataFiles({ data, schemas }));
  return errors;
}

// ── CLI ──
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dataDir = process.argv[2] ? path.resolve(process.argv[2]) : REPO_DATA_DIR;
  const errors = runValidate(dataDir);
  for (const e of errors) console.error(`FAIL ${e}`);
  if (errors.length > 0) {
    console.error(`validate: ${errors.length} 个错误 — ${dataDir}`);
    process.exit(1);
  }
  console.log(`validate OK — ${path.relative(process.cwd(), dataDir) || '.'}：5 个数据文件 schema 校验 + 交叉引用检查，0 错误`);
}
