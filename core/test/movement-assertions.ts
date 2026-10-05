/**
 * 移动可达集边角单测（core-spec §4.2 / §5 移动清单），不依赖黄金向量；并入 npm test。
 * 逐条 PASS/FAIL + 汇总；任一失败进程非零退出。
 */
import { reachable, type MapFixture, type MoveUnit } from '../src/movement';

let pass = 0;
let fail = 0;

function record(label: string, mismatches: string[]): void {
  if (mismatches.length === 0) {
    pass += 1;
    console.log(`PASS ${label}`);
  } else {
    fail += 1;
    console.log(`FAIL ${label} → ${mismatches.join('; ')}`);
  }
}

/** 对夹具调用 reachable，断言目的地按 [y,x] 逐元素全等（顺序敏感）。 */
function expectDest(label: string, map: MapFixture, units: MoveUnit[], expected: number[][]): void {
  try {
    const dest = reachable(units[0], map, units).map((coord) => [coord.y, coord.x]);
    record(label, JSON.stringify(dest) === JSON.stringify(expected) ? [] : [
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(dest)}`,
    ]);
  } catch (error) {
    record(label, [`threw ${error instanceof Error ? error.message : String(error)}`]);
  }
}

// ── §4.2 扣减允许为负：ceil_to_whole(负) ≤ 0 → 进入判定必假，自然停止 ──
// budget2=2：(0,1)路 cost1 → rem 1 → (0,2)平原 ceil(1)=2≥2 可进 → rem −1 →
// ceil(−1)=0 < 2 → (0,3) 被拒（若负预算仍扩张，(0,3) 会以 dist5 多出来）
expectDest(
  'movement: 扣减为负后自然停止',
  { h: 1, w: 4, terrain: ['....'], roads: [[0, 1]], cities: [], explored: [] },
  [{ id: 'u1', owner: 'A', x: 0, y: 0, move: 1 }],
  [[0, 1], [0, 2]],
);

// ── §6 图例 w：水域不可入，且作为路径格不可穿越 ──
expectDest(
  'movement: 水域阻挡且不可穿',
  { h: 1, w: 4, terrain: ['..w.'], roads: [], cities: [], explored: [] },
  [{ id: 'u1', owner: 'A', x: 0, y: 0, move: 2 }],
  [[0, 1]],
);

// ── §4.2 输出按 (y, x) 字典序：同 dist 三格的发现序为 E, SE, S，输出须为 [y,x] 序 ──
expectDest(
  'movement: 同 dist 按 [y,x] 字典序稳定输出',
  { h: 2, w: 2, terrain: ['..', '..'], roads: [], cities: [], explored: [] },
  [{ id: 'u1', owner: 'A', x: 0, y: 0, move: 2 }],
  [[0, 1], [1, 0], [1, 1]],
);

console.log(`${pass}/${pass + fail} PASS`);
if (fail > 0) {
  process.exitCode = 1;
}
