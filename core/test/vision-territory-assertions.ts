/**
 * 视野 / 领地边角单测（core-spec §4.5、§4.3），不依赖黄金向量；并入 npm test。
 * 覆盖：viewFor 三态各一（行 283–285）、radius 映射（行 252）、并列 tie-break（行 254）、无源观察者空集。
 * 逐条 PASS/FAIL + 汇总；任一失败进程非零退出。
 */
import { resolveBorderRadius, territoryGrid, type TerritoryCity } from '../src/territory';
import { visibleCells, viewFor, type VisionMapFixture, type VisionUnit } from '../src/vision';
import type { State, Tile } from '../src/state';

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

/** 断言 JSON 全等（用于视图条目与领地图） */
function expectEqual(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  record(label, a === e ? [] : [`expected ${e}, got ${a}`]);
}

// ── viewFor 测试底座：5×5 State，观察者 = player 0 ──
function plain(overrides?: Partial<Tile>): Tile {
  return { terrain: 'plain', road: false, village: false, ...overrides };
}

function makeViewForState(): State {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 5; y += 1) {
    const row: Tile[] = [];
    for (let x = 0; x < 5; x += 1) {
      row.push(plain());
    }
    tiles.push(row);
  }
  tiles[0][0] = plain({ resource: 'res.fruit' }); // visible 格，验资源
  tiles[1][2] = plain({ road: true, improved: 'imp.farm' }); // explored 格，验建筑轮廓
  return {
    schemaVersion: 1,
    rulesVersion: '0.1.0',
    contentHash: '0000000000000000',
    seed: 0n,
    rng: 0n,
    map: { width: 5, height: 5 },
    turn: 0,
    currentPlayer: 0,
    phase: 'act',
    tiles,
    units: [
      // 观察者己方单位 (0,0) 平原 → 半径 1 → visible = {(0,0),(0,1),(1,0),(1,1)}
      { id: 'u1', owner: 0, type: 'warrior', x: 0, y: 0, hp: 10, moved: false, attacked: false, healed: false, kills: 0, promoted: false, homeCity: null },
      // 敌方单位在 visible 格 (0,1)
      { id: 'e1', owner: 1, type: 'warrior', x: 1, y: 0, hp: 10, moved: false, attacked: false, healed: false, kills: 0, promoted: false, homeCity: null },
    ],
    cities: [],
    players: [
      { idx: 0, name: 'p0', tribe: 'tribe.a', stars: 5, techs: [], met: [], eliminated: false },
      { idx: 1, name: 'p1', tribe: 'tribe.b', stars: 5, techs: [], met: [], eliminated: false },
    ],
    actionLog: [],
  };
}

/** 已探索：visible 四格 + (1,2)；其外均 hidden */
const EXPLORED: number[][] = [[0, 0], [0, 1], [1, 0], [1, 1], [1, 2]];

const view = viewFor(0, makeViewForState(), { explored: EXPLORED, mountainTerrainId: 'mountain' });
const tileAt = (y: number, x: number) => view[y * 5 + x];

// ── §4.5 行 283：visible 格 → 地形、资源、建筑、敌方单位全量 ──
expectEqual(
  'viewFor: visible 格输出地形+资源+敌方单位',
  { cell: tileAt(0, 0), enemy: tileAt(0, 1) },
  {
    cell: { y: 0, x: 0, visibility: 'visible', terrain: 'plain', resource: 'res.fruit' },
    enemy: {
      y: 0, x: 1, visibility: 'visible', terrain: 'plain',
      enemyUnits: [{ id: 'e1', owner: 1, type: 'warrior', x: 1, y: 0, hp: 10 }],
    },
  },
);

// ── §4.5 行 284：explored 格 → 地形与建筑轮廓，无资源、无单位 ──
expectEqual(
  'viewFor: explored 格有地形+建筑轮廓、无资源无单位',
  tileAt(1, 2),
  { y: 1, x: 2, visibility: 'explored', terrain: 'plain', building: { cityId: null, improved: 'imp.farm', road: true } },
);

// ── §4.5 行 285：hidden 格 → 仅"未探索"标记 ──
expectEqual(
  'viewFor: hidden 格仅标记',
  tileAt(4, 4),
  { y: 4, x: 4, visibility: 'hidden', terrain: null },
);

// ── §4.3 行 252：level → borderRadiusByLevel 映射（L2→1 / L3→2） ──
record(
  'radius: L2→1 / L3→2（borderRadiusByLevel）',
  resolveBorderRadius(2) === 1 && resolveBorderRadius(3) === 2
    ? []
    : [`got L2=${resolveBorderRadius(2)}, L3=${resolveBorderRadius(3)}`],
);

// ── §4.3 行 254：距离并列 → city id 字典序小者胜（且与 cities 传入顺序无关：b 在前 a 在后） ──
const tieCities: TerritoryCity[] = [
  { id: 'city.beta', x: 2, y: 0, owner: 'B', radius: 1 },
  { id: 'city.alpha', x: 0, y: 0, owner: 'A', radius: 1 },
];
expectEqual(
  'territory: 并列 tie-break 归 id 小者，与传入顺序无关',
  territoryGrid(1, 3, tieCities),
  { A: [[0, 0], [0, 1]], B: [[0, 2]] },
);

// ── §4.5 行 280 / §6 行 435：无己方源的观察者 → 空集（敌方单位不算源） ──
const noSources: VisionMapFixture = { h: 3, w: 3, terrain: ['m..', '...', '...'], cities: [[0, 0, 'B']] };
const enemyOnly: VisionUnit[] = [{ id: 'e1', owner: 'B', x: 1, y: 1 }];
expectEqual(
  'vision: 无己方源观察者 → 空集',
  visibleCells('A', noSources, enemyOnly),
  [],
);

console.log(`${pass}/${pass + fail} PASS`);
if (fail > 0) {
  process.exitCode = 1;
}
