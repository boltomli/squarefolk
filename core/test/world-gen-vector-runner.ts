/**
 * world 域黄金向量 runner（core-spec §4.6 自然生成算法体 / §6 world 型 given `fixture: "worldGen"`）：
 * 读取 testdata/golden/world/ 全部向量 → `{...balance.world, ...given.world}` 浅合并参数（坑⑪）
 * → `generate(seed, h, w, params)` → 按 expect 出现的字段逐字段全等断言。
 * - `expect.ok:false` → 只断言 `ok` / `reason` / `attempts`（§6：失败形状），其余字段出现即 FAIL；
 * - `expect.ok:true` → `attempts` / `terrain`（图例字符串行）/ `villages` / `resources` / `spawns` /
 *   `startValues` / `rngFinal` 完整全等（数组顺序敏感 —— 规格序即输出序，坑⑧⑨）；
 * - expect 未知字段 = FAIL（防向量字段拼错静默通过）。
 * 任一失败进程非零退出（npm test 失败）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { generate, mergeWorldParams, type WorldGenResult } from '../src/worldgen';
import { collectVectorFiles } from './collect-vectors';

interface WorldVector {
  id?: string;
  rulesVersion?: string;
  given: {
    fixture: string;
    /** §6：seed/h/w 必填；seed 为 JSON 整数（u64 hex 字符串亦可，按 §0 行 19 规范化） */
    seed: number | string;
    h: number;
    w: number;
    /** balance.world 的局部覆盖（缺省键回落 balance；{} = 全用 balance） */
    world?: Record<string, unknown>;
  };
  expect: Record<string, unknown>;
}

const VECTORS_DIR = path.resolve(__dirname, '../../../testdata/golden/world');

/** §6 行 543 expect 字段全集（ok:false 仅前三个可用） */
const OK_FIELDS = new Set(['ok', 'reason', 'attempts']);
const SUCCESS_FIELDS = new Set([
  'ok',
  'attempts',
  'terrain',
  'villages',
  'resources',
  'spawns',
  'startValues',
  'rngFinal',
]);

let pass = 0;
let fail = 0;

/** 深度全等：数组顺序敏感、对象键集双向相等（§6.2：出现的数组必须是完整期望值） */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    return ak.every((key) => key in b && deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
  }
  return false;
}

/** expect 出现的字段 → 结果断言（字段集外 = FAIL；ok:false 时只允许 ok/reason/attempts） */
function assertFields(expect: Record<string, unknown>, result: WorldGenResult): string[] {
  const mismatches: string[] = [];
  for (const key of Object.keys(expect)) {
    if (result.ok) {
      if (!SUCCESS_FIELDS.has(key)) mismatches.push(`未知 expect 字段: ${key}`);
    } else if (!OK_FIELDS.has(key)) {
      mismatches.push(`ok:false 时只可断言 ok/reason/attempts，出现: ${key}`);
    }
  }
  if (!('ok' in expect)) {
    mismatches.push('expect.ok 缺失');
    return mismatches;
  }
  if (expect.ok !== result.ok) {
    mismatches.push(`ok 期望 ${String(expect.ok)}，实得 ${String(result.ok)}`);
    return mismatches;
  }
  if (!result.ok) {
    if ('reason' in expect && expect.reason !== result.reason) {
      mismatches.push(`reason 期望 ${JSON.stringify(expect.reason)}，实得 ${JSON.stringify(result.reason)}`);
    }
    if ('attempts' in expect && expect.attempts !== result.attempts) {
      mismatches.push(`attempts 期望 ${String(expect.attempts)}，实得 ${String(result.attempts)}`);
    }
    return mismatches;
  }
  for (const key of Object.keys(expect)) {
    if (key === 'ok') continue;
    if (!deepEqual(expect[key], (result as unknown as Record<string, unknown>)[key])) {
      mismatches.push(`${key} 期望 ${JSON.stringify(expect[key])}，实得 ${JSON.stringify((result as unknown as Record<string, unknown>)[key])}`);
    }
  }
  return mismatches;
}

for (const file of collectVectorFiles(VECTORS_DIR)) {
  const vector = JSON.parse(fs.readFileSync(file, 'utf8')) as WorldVector;
  const label = vector.id ?? path.relative(VECTORS_DIR, file);
  let mismatches: string[] = [];
  try {
    if (vector.given?.fixture !== 'worldGen') {
      throw new Error(`unsupported fixture: ${JSON.stringify(vector.given?.fixture)}`);
    }
    const seed = typeof vector.given.seed === 'string' ? BigInt(`0x${vector.given.seed}`) : vector.given.seed;
    const params = mergeWorldParams(vector.given.world ?? {});
    const result = generate(seed, vector.given.h, vector.given.w, params);
    mismatches = assertFields(vector.expect, result);
  } catch (error) {
    mismatches = [error instanceof Error ? error.message : String(error)];
  }

  if (mismatches.length === 0) {
    pass += 1;
    console.log(`PASS ${label}`);
  } else {
    fail += 1;
    console.log(`FAIL ${label} → ${mismatches.join('; ')}`);
  }
}

console.log(`${pass}/${pass + fail} PASS`);
if (fail > 0) {
  process.exitCode = 1;
}
