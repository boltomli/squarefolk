/**
 * vision 域黄金向量 runner（core-spec §4.5、§6 vision 型 given）：
 * 读取 testdata/golden/vision/ 全部 visionVisible 向量，调用 visibleCells(viewer, map, units)，
 * 对 expect.visible 逐元素全等断言（顺序敏感，[y,x] 字典序）；任一失败进程非零退出（npm test 失败）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { visibleCells, type VisionMapFixture, type VisionUnit } from '../src/vision';
import { collectVectorFiles } from './collect-vectors';

interface VisionVector {
  id?: string;
  rulesVersion?: string;
  source?: string;
  given: {
    fixture: string;
    viewer: string;
    map: VisionMapFixture;
    units: VisionUnit[];
  };
  expect: { visible: number[][] };
  notes?: string;
}

const VECTORS_DIR = path.resolve(__dirname, '../../../testdata/golden/vision');

let pass = 0;
let fail = 0;

for (const file of collectVectorFiles(VECTORS_DIR)) {
  const vector = JSON.parse(fs.readFileSync(file, 'utf8')) as VisionVector;
  const label = vector.id ?? path.relative(VECTORS_DIR, file);
  const mismatches: string[] = [];
  const expected = vector.expect?.visible;

  if (vector.given?.fixture !== 'visionVisible') {
    mismatches.push(`unsupported fixture: ${JSON.stringify(vector.given?.fixture)}`);
  }
  if (!Array.isArray(expected)) {
    mismatches.push('expect.visible 缺失');
  }
  if (typeof vector.given?.viewer !== 'string') {
    mismatches.push('given.viewer 缺失');
  }

  if (mismatches.length === 0 && Array.isArray(expected)) {
    try {
      const cells = visibleCells(vector.given.viewer, vector.given.map, vector.given.units ?? []).map(
        (coord) => [coord.y, coord.x],
      );
      if (cells.length !== expected.length) {
        mismatches.push(`visible 长度: expected ${expected.length}, got ${cells.length}`);
      } else {
        expected.forEach((pair, index) => {
          if (!Array.isArray(pair) || pair[0] !== cells[index][0] || pair[1] !== cells[index][1]) {
            mismatches.push(`visible[${index}]: expected ${JSON.stringify(pair)}, got ${JSON.stringify(cells[index])}`);
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
