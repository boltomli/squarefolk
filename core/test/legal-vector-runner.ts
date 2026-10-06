/**
 * legal 域黄金向量 runner（core-spec §8.1 / §6.1 legalActions 型 given）：
 * 读取 testdata/golden/legal/ 全部向量 → 装配 lite State（players 字符串 id → 下标序映射、
 * map 图例 → tiles、villages / resources / improved 落 tile，装配逻辑与 turn-vector-runner 同构）→
 * `legalActions(state, ctx, { explored })` → `expect.legalActions` **全量精确数组**比较
 * （长度 + 逐元素深度等值，键序无关 —— §6.1「钉完备性 + 排序」）。
 * 未知 expect 字段 = FAIL（防向量字段拼错静默通过）。任一失败进程非零退出（npm test 失败）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { legalActions, terrainIdFromLegend, type ActionContext } from '../src/actions';
import { checkInvariants, type City, type Player, type State, type Tile, type Unit } from '../src/state';
import { collectVectorFiles } from './collect-vectors';

interface GivenUnit {
  id: string;
  owner: string;
  type: string;
  x: number;
  y: number;
  hp: number;
  homeCity: string | null;
  kills: number;
  promoted: boolean;
  moved: boolean;
  attacked: boolean;
  healed: boolean;
}

interface GivenCity {
  id: string;
  x: number;
  y: number;
  owner: string;
  level: number;
  population: number;
  hasWorkshop: boolean;
  hasWall: boolean;
  wallDurability: number;
  isCapital: boolean;
}

interface GivenPlayer {
  id: string;
  stars: number;
  techs: string[];
  met: number[];
  noCityTurns?: number;
  eliminated: boolean;
}

interface GivenMap {
  h: number;
  w: number;
  terrain: string[];
  roads?: number[][] | null;
  villages?: number[][] | null;
  resources?: (string | number)[][] | null;
  improved?: (string | number)[][] | null;
  explored?: number[][] | null;
}

interface LegalVector {
  id?: string;
  rulesVersion?: string;
  given: {
    fixture: string;
    map: GivenMap;
    units: GivenUnit[];
    cities: GivenCity[];
    players: GivenPlayer[];
    unitTypes: ActionContext['unitTypes'];
    techs: ActionContext['techs'];
    resources: ActionContext['resources'];
    improvementTypes?: ActionContext['improvementTypes'];
    currentPlayer: string;
    turn: number;
    phase: string;
  };
  expect: Record<string, unknown>;
}

interface Assembled {
  state: State;
  ctx: ActionContext;
  explored: number[][] | null;
}

const VECTORS_DIR = path.resolve(__dirname, '../../../testdata/golden/legal');

let pass = 0;
let fail = 0;

/** 夹具 → lite State（与 turn-vector-runner 同构；任何形状 / 引用问题 throw → 本向量计 FAIL） */
function assemble(vector: LegalVector): Assembled {
  const given = vector.given;
  const { h, w } = given.map;
  if (!Number.isInteger(h) || !Number.isInteger(w) || h < 1 || w < 1) {
    throw new Error(`map 尺寸非法：${String(h)}×${String(w)}`);
  }

  const playerIds = given.players.map((player) => player.id);
  const playerIndex = (id: string): number => {
    const index = playerIds.indexOf(id);
    if (index === -1) throw new Error(`players 中无 id "${id}"`);
    return index;
  };

  const roadCells = new Set<number>();
  for (const [y, x] of given.map.roads ?? []) roadCells.add(y * w + x);
  const villageCells = new Set<number>();
  for (const [y, x] of given.map.villages ?? []) villageCells.add(y * w + x);
  const resourceAt = new Map<number, string>();
  for (const entry of given.map.resources ?? []) {
    const [ry, rx, kind] = entry as [number, number, string];
    resourceAt.set(ry * w + rx, kind);
  }
  const improvedAt = new Map<number, string>();
  for (const entry of given.map.improved ?? []) {
    const [iy, ix, kind] = entry as [number, number, string];
    improvedAt.set(iy * w + ix, kind);
  }
  const cityAt = new Map<number, string>();
  for (const city of given.cities) cityAt.set(city.y * w + city.x, city.id);

  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y += 1) {
    const row = given.map.terrain[y] ?? '';
    if (row.length !== w) throw new Error(`terrain[${y}] 长度 ${row.length} ≠ w=${w}`);
    const tilesRow: Tile[] = [];
    for (let x = 0; x < w; x += 1) {
      const key = y * w + x;
      const tile: Tile = {
        terrain: terrainIdFromLegend(row[x]),
        road: roadCells.has(key),
        village: villageCells.has(key),
      };
      const resource = resourceAt.get(key);
      if (resource !== undefined) tile.resource = resource;
      const improved = improvedAt.get(key);
      if (improved !== undefined) tile.improved = improved;
      const cityId = cityAt.get(key);
      if (cityId !== undefined) tile.cityId = cityId;
      tilesRow.push(tile);
    }
    tiles.push(tilesRow);
  }

  const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const units: Unit[] = given.units
    .map((unit) => ({
      id: unit.id,
      owner: playerIndex(unit.owner),
      type: unit.type,
      x: unit.x,
      y: unit.y,
      hp: unit.hp,
      moved: unit.moved,
      attacked: unit.attacked,
      healed: unit.healed,
      kills: unit.kills,
      promoted: unit.promoted,
      homeCity: unit.homeCity,
    }))
    .sort(byId);
  const cities: City[] = given.cities
    .map((city) => ({
      id: city.id,
      x: city.x,
      y: city.y,
      owner: playerIndex(city.owner),
      level: city.level,
      population: city.population,
      hasWorkshop: city.hasWorkshop,
      hasWall: city.hasWall,
      wallDurability: city.wallDurability,
      isCapital: city.isCapital,
    }))
    .sort(byId);
  const players: Player[] = given.players.map((player, idx) => ({
    idx,
    name: player.id,
    tribe: player.id,
    stars: player.stars,
    techs: [...player.techs],
    met: [...player.met],
    noCityTurns: player.noCityTurns ?? 0,
    eliminated: player.eliminated,
  }));

  const phase = given.phase;
  if (phase !== 'prep' && phase !== 'act' && phase !== 'commit') throw new Error(`phase 非法 "${phase}"`);

  const state: State = {
    schemaVersion: 1,
    rulesVersion: vector.rulesVersion ?? '0.1.0',
    contentHash: '0000000000000000',
    seed: 0n,
    rng: 0n,
    map: { width: w, height: h },
    turn: given.turn,
    currentPlayer: playerIndex(given.currentPlayer),
    phase,
    tiles,
    units,
    cities,
    players,
    actionLog: [],
  };

  return {
    state,
    ctx: {
      unitTypes: given.unitTypes,
      techs: given.techs,
      resources: given.resources,
      improvementTypes: given.improvementTypes ?? {}, // §6 行 498：缺省 = 空表
    },
    explored: given.map.explored ?? null,
  };
}

/** 深度全等：数组顺序敏感、对象键集双向相等（§6「出现的数组必须是完整期望值」） */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    if (!deepEqual(keysA, keysB)) return false;
    const recordA = a as Record<string, unknown>;
    const recordB = b as Record<string, unknown>;
    return keysA.every((key) => deepEqual(recordA[key], recordB[key]));
  }
  return false;
}

for (const file of collectVectorFiles(VECTORS_DIR)) {
  const raw = fs.readFileSync(file, 'utf8');
  const vector = JSON.parse(raw) as LegalVector;
  const label = vector.id ?? path.relative(VECTORS_DIR, file);
  const mismatches: string[] = [];
  try {
    if (vector.given?.fixture !== 'legalActions') {
      throw new Error(`unsupported fixture: ${JSON.stringify(vector.given?.fixture)}`);
    }
    const assembled = assemble(vector);
    const maxHpOf = (type: string): number | undefined => assembled.ctx.unitTypes[type]?.hp;
    for (const error of checkInvariants(assembled.state, maxHpOf)) {
      mismatches.push(`装配状态违规: ${error}`);
    }

    const expect = vector.expect;
    if (expect === null || typeof expect !== 'object' || !Array.isArray((expect as Record<string, unknown>).legalActions)) {
      throw new Error('expect.legalActions 缺失或非数组');
    }
    for (const key of Object.keys(expect)) {
      if (key !== 'legalActions') mismatches.push(`expect 未知字段 "${key}"`);
    }

    const actual = legalActions(assembled.state, assembled.ctx, { explored: assembled.explored });
    const expected = expect.legalActions as unknown[];
    if (actual.length !== expected.length) {
      mismatches.push(`legalActions.length: expected ${expected.length}, got ${actual.length}`);
    } else {
      for (let i = 0; i < expected.length; i += 1) {
        if (!deepEqual(actual[i], expected[i])) {
          mismatches.push(`[${i}] expected ${JSON.stringify(expected[i])}, got ${JSON.stringify(actual[i])}`);
        }
      }
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
