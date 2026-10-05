/**
 * 手工地图与初始 State 构造 —— 壳层职责（core-spec §1 行 47：迷雾不入 State；
 * 初始状态构造属壳层，规则只经 core API）。
 *
 * 10×10 非对称沙盒：玩家首都 1、中立村 3、🍎×4 / 🐗×2、森林 / 山地 / 沼泽 / 小湖若干。
 * 地形图例复用 core 的 §6 图例（. f m s w），不另造约定。
 */
import { terrainIdFromLegend } from '../../core/src/actions';
import type { City, Player, State, Tile, Unit } from '../../core/src/state';
import { CONTENT, START_STARS, START_TECHS } from './config';

export const MAP_W = 10;
export const MAP_H = 10;
export const PLAYER_IDX = 0;

/** 行主序地形（y=0 顶），图例见 core §6：`.`平原 `f`森林 `m`山地 `s`沼泽 `w`水域 */
const TERRAIN_ROWS: readonly string[] = [
  '...f...m..',
  '.f....s...',
  '....s...w.',
  '..f.ss..w.',
  '.....wwf..',
  '........m.',
  '......s...',
  '.....fs...',
  '.....ww.m.',
  '....ww....',
];

const CAPITAL = { x: 1, y: 8 };
const VILLAGES: readonly { x: number; y: number }[] = [
  { x: 3, y: 5 },
  { x: 7, y: 7 },
  { x: 4, y: 1 },
];
// 🍎×4 全在首都 radius 1 领地内：升 L2 需 2 人口，不必扫光全图（引导修缮）
const RESOURCES: readonly { x: number; y: number; id: string }[] = [
  { x: 1, y: 7, id: 'fruit' },
  { x: 0, y: 8, id: 'fruit' },
  { x: 0, y: 9, id: 'fruit' },
  { x: 2, y: 9, id: 'fruit' },
  { x: 2, y: 5, id: 'beast' },
  { x: 7, y: 6, id: 'beast' },
];
const START_UNITS: readonly { x: number; y: number }[] = [
  { x: 1, y: 8 },
  { x: 2, y: 7 },
];

/** 完成条件之一：中立村总数 */
export const VILLAGE_TOTAL = VILLAGES.length;
export const CAPITAL_ID = 'city.000001';

function fail(message: string): never {
  throw new Error(`demo/map: ${message}`);
}

/** 手工地图自检：行列长、特征落在平原上（装配错误早抛，不静默） */
function validate(): void {
  if (TERRAIN_ROWS.length !== MAP_H) fail(`地形行数 ${TERRAIN_ROWS.length} ≠ ${MAP_H}`);
  for (const [y, row] of TERRAIN_ROWS.entries()) {
    if (row.length !== MAP_W) fail(`第 ${y} 行长度 ${row.length} ≠ ${MAP_W}`);
  }
  const plain = (x: number, y: number, what: string): void => {
    if (TERRAIN_ROWS[y][x] !== '.') fail(`${what} (${x},${y}) 不在平原上`);
  };
  plain(CAPITAL.x, CAPITAL.y, '首都');
  for (const village of VILLAGES) plain(village.x, village.y, '中立村');
  for (const resource of RESOURCES) plain(resource.x, resource.y, '资源');
  for (const unit of START_UNITS) plain(unit.x, unit.y, '初始单位');
}

/** 初始 State（§1 冻结 v0.1 字段；确定性：seed/rng 固定 0，全程无随机） */
export function createInitialState(): State {
  validate();

  const tiles: Tile[][] = TERRAIN_ROWS.map((row, y) =>
    [...row].map((ch, x) => {
      let terrain: string;
      try {
        terrain = terrainIdFromLegend(ch);
      } catch (error) {
        return fail(`(${x},${y}) 图例非法：${String(error)}`);
      }
      return { terrain, resource: null, cityId: null, village: false, road: false, improved: null };
    }),
  );
  for (const resource of RESOURCES) tiles[resource.y][resource.x].resource = resource.id;
  for (const village of VILLAGES) tiles[village.y][village.x].village = true;
  tiles[CAPITAL.y][CAPITAL.x].cityId = CAPITAL_ID;

  const warriorHp = CONTENT.unitTypes['unit.warrior'].hp;
  const cities: City[] = [
    {
      id: CAPITAL_ID,
      x: CAPITAL.x,
      y: CAPITAL.y,
      owner: PLAYER_IDX,
      level: 1,
      population: 0,
      hasWorkshop: false,
      hasWall: false,
      wallDurability: 0,
      isCapital: true,
    },
  ];
  // 初始步兵无母城（homeCity=null）：否则 L1 首都容量 1 被 2 名起始兵占满，训练分支永远进不去
  const units: Unit[] = START_UNITS.map((point, index) => ({
    id: `unit.${String(index + 1).padStart(6, '0')}`,
    owner: PLAYER_IDX,
    type: 'unit.warrior',
    x: point.x,
    y: point.y,
    hp: warriorHp,
    moved: false,
    attacked: false,
    healed: false,
    kills: 0,
    promoted: false,
    homeCity: null,
  }));
  const players: Player[] = [
    { idx: PLAYER_IDX, name: '方族', tribe: 'tribe.square', stars: START_STARS, techs: [...START_TECHS], met: [], noCityTurns: 0, eliminated: false },
  ];

  return {
    schemaVersion: 1,
    rulesVersion: '0.1.0',
    contentHash: '0000000000000000',
    seed: 0n,
    rng: 0n,
    map: { width: MAP_W, height: MAP_H },
    turn: 0,
    currentPlayer: PLAYER_IDX,
    phase: 'act',
    tiles,
    units,
    cities,
    players,
    actionLog: [],
  };
}
