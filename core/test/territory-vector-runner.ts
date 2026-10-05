/**
 * territory 域黄金向量 runner（core-spec §4.3、§6 territory 型 given）：
 * 读取 testdata/golden/territory/ 全部 territoryGrid 向量，调用 territoryGrid(h, w, cities)，
 * 对 expect.territory 逐键逐元素全等断言（键集双向相等、含 unowned 键，列表 [y,x] 升序敏感）；
 * 任一失败进程非零退出（npm test 失败）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { territoryGrid, type TerritoryCity, type TerritoryGrid } from '../src/territory';
import { collectVectorFiles } from './collect-vectors';

interface TerritoryVector {
  id?: string;
  rulesVersion?: string;
  source?: string;
  given: {
    fixture: string;
    map: { h: number; w: number };
    cities: TerritoryCity[];
  };
  expect: { territory: Record<string, number[][]> };
  notes?: string;
}

const VECTORS_DIR = path.resolve(__dirname, '../../../testdata/golden/territory');

let pass = 0;
let fail = 0;

/** 键集双向相等 + 每键列表逐元素全等（顺序敏感）；mismatches 空 = 全等 */
function compareTerritory(expected: Record<string, number[][]>, actual: TerritoryGrid): string[] {
  const mismatches: string[] = [];
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) {
    mismatches.push(`键集: expected ${JSON.stringify(expectedKeys)}, got ${JSON.stringify(actualKeys)}`);
  }
  for (const key of expectedKeys) {
    const want = expected[key];
    const got = actual[key];
    if (!Array.isArray(got)) {
      continue; // 键集差异已报告
    }
    if (got.length !== want.length) {
      mismatches.push(`${key} 长度: expected ${want.length}, got ${got.length}`);
      continue;
    }
    want.forEach((pair, index) => {
      if (!Array.isArray(pair) || pair[0] !== got[index][0] || pair[1] !== got[index][1]) {
        mismatches.push(`${key}[${index}]: expected ${JSON.stringify(pair)}, got ${JSON.stringify(got[index])}`);
      }
    });
  }
  return mismatches;
}

for (const file of collectVectorFiles(VECTORS_DIR)) {
  const vector = JSON.parse(fs.readFileSync(file, 'utf8')) as TerritoryVector;
  const label = vector.id ?? path.relative(VECTORS_DIR, file);
  const mismatches: string[] = [];
  const expected = vector.expect?.territory;

  if (vector.given?.fixture !== 'territoryGrid') {
    mismatches.push(`unsupported fixture: ${JSON.stringify(vector.given?.fixture)}`);
  }
  if (expected === null || typeof expected !== 'object') {
    mismatches.push('expect.territory 缺失');
  }
  if (!Array.isArray(vector.given?.cities)) {
    mismatches.push('given.cities 缺失');
  }
  if (mismatches.length === 0 && expected !== null && typeof expected === 'object') {
    try {
      const { h, w } = vector.given.map;
      mismatches.push(...compareTerritory(expected, territoryGrid(h, w, vector.given.cities)));
    } catch (error) {
      mismatches.push(error instanceof Error ? error.message : String(error));
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
