/**
 * meta 域黄金向量 runner（core-spec §0 行 17/18、§6 向量格式）：
 * 读取 testdata/golden/meta/ 全部向量，按 given.algorithm 独立计算并逐元素断言
 * expect.outputs；任一失败进程非零退出（npm test 失败）。
 * - splitmix64：由 given.seed（16 位小写 hex）起推 given.steps 步
 * - fnv1a64：对 given.inputs 中每个字符串按 UTF-8 计算
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Splitmix64 } from '../src/prng';
import { fnv1a64 } from '../src/hash';
import { u64Hex } from '../src/canonical';
import { collectVectorFiles } from './collect-vectors';

interface MetaVector {
  id?: string;
  rulesVersion?: string;
  source?: string;
  given: {
    algorithm: string;
    seed?: string;
    steps?: number;
    inputs?: string[];
  };
  expect: { outputs: string[] };
  notes?: string;
}

const VECTORS_DIR = path.resolve(__dirname, '../../../testdata/golden/meta');

/** 按算法计算实际输出；输入形态非法 → throw（计入该向量 FAIL）。 */
function computeOutputs(given: MetaVector['given']): string[] {
  if (given.algorithm === 'splitmix64') {
    if (typeof given.seed !== 'string' || !/^[0-9a-f]{16}$/.test(given.seed)) {
      throw new Error(`splitmix64: given.seed 须为 16 位小写 hex，得到 ${String(given.seed)}`);
    }
    if (!Number.isInteger(given.steps) && given.steps !== undefined) {
      throw new Error(`splitmix64: given.steps 须为整数，得到 ${String(given.steps)}`);
    }
    const rng = new Splitmix64(BigInt(`0x${given.seed}`));
    const outputs: string[] = [];
    for (let i = 0; i < (given.steps ?? 0); i++) {
      outputs.push(u64Hex(rng.next()));
    }
    return outputs;
  }
  if (given.algorithm === 'fnv1a64') {
    if (!Array.isArray(given.inputs) || given.inputs.some((value) => typeof value !== 'string')) {
      throw new Error('fnv1a64: given.inputs 须为字符串数组');
    }
    return given.inputs.map((input) => u64Hex(fnv1a64(input)));
  }
  throw new Error(`unknown algorithm: ${String(given.algorithm)}`);
}

let pass = 0;
let fail = 0;

for (const file of collectVectorFiles(VECTORS_DIR)) {
  const vector = JSON.parse(fs.readFileSync(file, 'utf8')) as MetaVector;
  const label = vector.id ?? path.relative(VECTORS_DIR, file);
  const mismatches: string[] = [];

  try {
    const actual = computeOutputs(vector.given);
    const expected = vector.expect?.outputs;
    if (!Array.isArray(expected) || expected.length === 0) {
      mismatches.push('expect.outputs 为空（vacuous vector）');
    } else if (actual.length !== expected.length) {
      mismatches.push(`outputs 长度: expected ${expected.length}, got ${actual.length}`);
    } else {
      expected.forEach((value, index) => {
        if (actual[index] !== value) {
          mismatches.push(`outputs[${index}]: expected ${value}, got ${actual[index]}`);
        }
      });
    }
  } catch (error) {
    mismatches.push(error instanceof Error ? error.message : String(error));
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
