/**
 * 黄金向量 runner（core-spec §6）：
 * 读取 testdata/golden/combat/ 下全部 fixture 型向量，逐文件对 expect 的
 * 每个字段断言，打印 PASS/FAIL；任一失败则进程非零退出（npm test 失败）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveCombat, type Combatant } from '../src/combat';
import { collectVectorFiles } from './collect-vectors';

interface GoldenVector {
  id?: string;
  rulesVersion?: string;
  source?: string;
  given: {
    fixture: string;
    attacker: Combatant;
    defender: Combatant;
  };
  expect: Record<string, unknown>;
  notes?: string;
}

const VECTORS_DIR = path.resolve(__dirname, '../../../testdata/golden/combat');

let pass = 0;
let fail = 0;

for (const file of collectVectorFiles(VECTORS_DIR)) {
  const vector = JSON.parse(fs.readFileSync(file, 'utf8')) as GoldenVector;
  const label = vector.id ?? path.relative(VECTORS_DIR, file);
  const expectedKeys = Object.keys(vector.expect);
  const mismatches: string[] = [];

  if (vector.given?.fixture !== 'combat1v1') {
    mismatches.push(`unsupported fixture: ${JSON.stringify(vector.given?.fixture)}`);
  }
  if (expectedKeys.length === 0) {
    mismatches.push('expect is empty (vacuous vector)');
  }

  if (mismatches.length === 0) {
    const result = resolveCombat(vector.given.attacker, vector.given.defender) as unknown as Record<string, unknown>;
    for (const key of expectedKeys) {
      const expected = vector.expect[key];
      const actual = result[key];
      if (actual !== expected) {
        mismatches.push(`${key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    }
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
