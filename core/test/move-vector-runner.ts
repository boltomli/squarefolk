/**
 * move 域黄金向量 runner（core-spec §4.2、§6 map 型 given）：
 * 读取 testdata/golden/move/ 全部 moveReachable 向量，调用
 * reachable(units[0], map, units)，对 expect.dest 逐元素全等断言
 * （顺序敏感，[y, x] 字典序）；任一失败进程非零退出（npm test 失败）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { reachable, type MapFixture, type MoveUnit } from '../src/movement';
import { collectVectorFiles } from './collect-vectors';

interface MoveVector {
  id?: string;
  rulesVersion?: string;
  source?: string;
  given: {
    fixture: string;
    map: MapFixture;
    units: MoveUnit[];
  };
  expect: { dest: number[][] };
  notes?: string;
}

const VECTORS_DIR = path.resolve(__dirname, '../../../testdata/golden/move');

let pass = 0;
let fail = 0;

for (const file of collectVectorFiles(VECTORS_DIR)) {
  const vector = JSON.parse(fs.readFileSync(file, 'utf8')) as MoveVector;
  const label = vector.id ?? path.relative(VECTORS_DIR, file);
  const mismatches: string[] = [];
  const expected = vector.expect?.dest;

  if (vector.given?.fixture !== 'moveReachable') {
    mismatches.push(`unsupported fixture: ${JSON.stringify(vector.given?.fixture)}`);
  }
  if (!Array.isArray(expected) || expected.length === 0) {
    mismatches.push('expect.dest 缺失或为空（vacuous vector）');
  }
  if (!Array.isArray(vector.given?.units) || vector.given.units.length === 0) {
    mismatches.push('given.units 缺失或为空');
  }

  if (mismatches.length === 0 && Array.isArray(expected)) {
    try {
      const dest = reachable(vector.given.units[0], vector.given.map, vector.given.units).map(
        (coord) => [coord.y, coord.x],
      );
      if (dest.length !== expected.length) {
        mismatches.push(`dest 长度: expected ${expected.length}, got ${dest.length}`);
      } else {
        expected.forEach((pair, index) => {
          if (!Array.isArray(pair) || pair[0] !== dest[index][0] || pair[1] !== dest[index][1]) {
            mismatches.push(`dest[${index}]: expected ${JSON.stringify(pair)}, got ${JSON.stringify(dest[index])}`);
          }
        });
      }
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
