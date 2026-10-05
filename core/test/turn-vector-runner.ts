/**
 * turn 域黄金向量 runner（core-spec §2 动作谓词 / §3 结算管线 / §6 action 型 given）：
 * 读取 testdata/golden/turn/ 全部 actionApply 向量 → 装配 lite State（players 字符串 id → 下标序
 * 映射、map 图例 → tiles、villages / resources 落 tile）→ applyAction → 按 expect 出现的字段断言。
 * - `rejected: true` → 只断言拒绝成立 + 输入状态规范化序列化前后相等（状态零变化，§2 / §6 行 483），
 *   其余字段不校验；
 * - 其余字段：`units` / `cities` / `players` 完整全等（按 id 序、坐标 [y,x] 升序）、`villages` /
 *   `resources` 完整清单、`turn` / `currentPlayer` / `winner` 标量；接受路径另跑 checkInvariants。
 * 任一失败进程非零退出（npm test 失败）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { applyAction, terrainIdFromLegend, type Action, type ActionContext } from '../src/actions';
import { canonicalJson } from '../src/canonical';
import { checkInvariants, type City, type Player, type State, type Tile, type Unit } from '../src/state';
import { collectVectorFiles } from './collect-vectors';

/** 夹具单位内联 ×10 属性（§6 行 478：动作前的完整切片） */
interface InlineStats {
  maxHp: number;
  atk10: number;
  def10: number;
  move: number;
  range: number;
  counter: number[];
}

interface GivenUnit extends InlineStats {
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
  eliminated: boolean;
}

interface GivenMap {
  h: number;
  w: number;
  terrain: string[];
  roads?: number[][] | null;
  villages?: number[][] | null;
  resources?: (string | number)[][] | null;
  explored?: number[][] | null;
}

interface TurnVector {
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
    currentPlayer: string;
    turn: number;
    phase: string;
  };
  expect: Record<string, unknown>;
}

interface Assembled {
  state: State;
  playerIds: string[];
  inlineById: Map<string, InlineStats>;
  maxHpByType: Map<string, number>;
  ctx: ActionContext;
}

const VECTORS_DIR = path.resolve(__dirname, '../../../testdata/golden/turn');

let pass = 0;
let fail = 0;

/** 夹具 → lite State；任何形状 / 引用问题 throw（本向量计 FAIL，不中断其余向量） */
function assemble(vector: TurnVector): Assembled {
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

  // 行主序格号成员（动态判定 → Set）
  const roadCells = new Set<number>();
  for (const [y, x] of given.map.roads ?? []) roadCells.add(y * w + x);
  const villageCells = new Set<number>();
  for (const [y, x] of given.map.villages ?? []) villageCells.add(y * w + x);
  const resourceAt = new Map<number, string>();
  for (const entry of given.map.resources ?? []) {
    // 坐标序：§6 已定 resources 三元组 = [y, x, kind]（行主序，2026-10-05 规格澄清；输出侧本就 [y,x,kind]）
    const [ry, rx, kind] = entry as [number, number, string];
    resourceAt.set(ry * w + rx, kind);
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
      const tile: Tile = { terrain: terrainIdFromLegend(row[x]), road: roadCells.has(key), village: villageCells.has(key) };
      const resource = resourceAt.get(key);
      if (resource !== undefined) tile.resource = resource;
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
    tribe: player.id, // 夹具未声明 tribe；name 承载字符串 id（expect 不校验 tribe）
    stars: player.stars,
    techs: [...player.techs],
    met: [...player.met],
    eliminated: player.eliminated,
  }));

  const phase = given.phase;
  if (phase !== 'prep' && phase !== 'act' && phase !== 'commit') throw new Error(`phase 非法 "${phase}"`);
  const currentPlayer = playerIndex(given.currentPlayer);

  const state: State = {
    schemaVersion: 1,
    rulesVersion: vector.rulesVersion ?? '0.1.0',
    contentHash: '0000000000000000',
    seed: 0n,
    rng: 0n,
    map: { width: w, height: h },
    turn: given.turn,
    currentPlayer,
    phase,
    tiles,
    units,
    cities,
    players,
    actionLog: [],
  };

  const inlineById = new Map<string, InlineStats>();
  const maxHpByType = new Map<string, number>();
  for (const unit of given.units) {
    inlineById.set(unit.id, {
      maxHp: unit.maxHp,
      atk10: unit.atk10,
      def10: unit.def10,
      move: unit.move,
      range: unit.range,
      counter: unit.counter,
    });
    if (!maxHpByType.has(unit.type)) maxHpByType.set(unit.type, unit.maxHp);
  }

  return {
    state,
    playerIds,
    inlineById,
    maxHpByType,
    ctx: { unitTypes: given.unitTypes, techs: given.techs, resources: given.resources },
  };
}

/**
 * §6 action 型夹具：动作对象扁平、判别键 `type` 平铺于载荷。train 载荷兵种键已按规格修正为
 * `unitType`（2026-10-05，与判别键避撞 —— 原 `type` 重复键会让 JSON.parse 后写覆盖前写）。
 * 本函数仍按原文本逐字段扫描：首个 `type` = 动作类型，其余键平铺进载荷（`unitType` 直通）。
 */
function parseAction(raw: string): Action {
  const match = raw.match(/"action"\s*:\s*\{([^}]*)\}/);
  if (match === null) throw new Error('given.action 缺失或非扁平对象');
  const fields = [...match[1].matchAll(/"([^"]+)"\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+|true|false|null)/g)].map(
    (entry) => [entry[1], JSON.parse(entry[2])] as const,
  );
  const typeField = fields.find(([key]) => key === 'type');
  if (typeField === undefined) throw new Error('given.action.type 缺失');
  const payload: Record<string, unknown> = {};
  let firstType = true;
  for (const [key, value] of fields) {
    if (key !== 'type') {
      payload[key] = value;
    } else if (firstType) {
      firstType = false;
    } else {
      payload.unitType = value;
    }
  }
  return { type: String(typeField[1]), ...payload } as Action;
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

/** 后继状态 → expect.units 视图：状态字段 + 属性（内联优先，新单位取 unitTypes） */
function projectUnits(assembled: Assembled, state: State): Record<string, unknown>[] {
  return state.units.map((unit) => {
    const inline = assembled.inlineById.get(unit.id);
    const typeDef = assembled.ctx.unitTypes[unit.type];
    if (inline === undefined && typeDef === undefined) {
      throw new Error(`stats: 单位 ${unit.id} 无内联属性且 unitTypes 缺 ${unit.type}`);
    }
    return {
      id: unit.id,
      owner: assembled.playerIds[unit.owner],
      type: unit.type,
      x: unit.x,
      y: unit.y,
      hp: unit.hp,
      maxHp: inline?.maxHp ?? typeDef?.hp,
      atk10: inline?.atk10 ?? typeDef?.atk10,
      def10: inline?.def10 ?? typeDef?.def10,
      move: inline?.move ?? typeDef?.move,
      range: inline?.range ?? typeDef?.range,
      counter: inline?.counter ?? typeDef?.counter,
      homeCity: unit.homeCity,
      kills: unit.kills,
      promoted: unit.promoted,
      moved: unit.moved,
      attacked: unit.attacked,
      healed: unit.healed,
    };
  });
}

function projectCities(state: State, playerIds: string[]): Record<string, unknown>[] {
  return state.cities.map((city) => ({
    id: city.id,
    x: city.x,
    y: city.y,
    owner: playerIds[city.owner],
    level: city.level,
    population: city.population,
    hasWorkshop: city.hasWorkshop,
    hasWall: city.hasWall,
    wallDurability: city.wallDurability,
    isCapital: city.isCapital,
  }));
}

function projectPlayers(state: State): Record<string, unknown>[] {
  return state.players.map((player) => ({
    id: player.name,
    stars: player.stars,
    techs: player.techs,
    met: player.met,
    eliminated: player.eliminated,
  }));
}

/** tiles 行主序清单：villages = 中立村庄格 [y,x]；resources = 剩余资源 [y,x,kind] */
function collectTiles(state: State): { villages: number[][]; resources: (string | number)[][] } {
  const villages: number[][] = [];
  const resources: (string | number)[][] = [];
  for (let y = 0; y < state.map.height; y += 1) {
    for (let x = 0; x < state.map.width; x += 1) {
      const tile = state.tiles[y][x];
      if (tile.village) villages.push([y, x]);
      if (tile.resource !== null && tile.resource !== undefined) resources.push([y, x, tile.resource]);
    }
  }
  return { villages, resources };
}

/** expect 出现的字段 → 断言（未知字段 = FAIL，防向量字段拼错静默通过） */
function assertFields(
  expect: Record<string, unknown>,
  assembled: Assembled,
  state: State,
  winner: number | null,
): string[] {
  const mismatches: string[] = [];
  const tiles = collectTiles(state);
  for (const [key, value] of Object.entries(expect)) {
    if (key === 'rejected') continue;
    if (key === 'winner') {
      const expected = typeof value === 'string' ? assembled.playerIds.indexOf(value) : value;
      if (expected !== winner) mismatches.push(`winner: expected ${JSON.stringify(value)} → idx ${String(expected)}, got ${winner}`);
      continue;
    }
    let actual: unknown;
    switch (key) {
      case 'units':
        actual = projectUnits(assembled, state);
        break;
      case 'cities':
        actual = projectCities(state, assembled.playerIds);
        break;
      case 'players':
        actual = projectPlayers(state);
        break;
      case 'villages':
        actual = tiles.villages;
        break;
      case 'resources':
        actual = tiles.resources;
        break;
      case 'turn':
        actual = state.turn;
        break;
      case 'currentPlayer':
        actual = assembled.playerIds[state.currentPlayer];
        break;
      default:
        mismatches.push(`expect 未知字段 "${key}"`);
        continue;
    }
    if (!deepEqual(actual, value)) {
      mismatches.push(`${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(actual)}`);
    }
  }
  return mismatches;
}

for (const file of collectVectorFiles(VECTORS_DIR)) {
  const raw = fs.readFileSync(file, 'utf8');
  const vector = JSON.parse(raw) as TurnVector;
  const label = vector.id ?? path.relative(VECTORS_DIR, file);
  const mismatches: string[] = [];
  try {
    if (vector.given?.fixture !== 'actionApply') {
      throw new Error(`unsupported fixture: ${JSON.stringify(vector.given?.fixture)}`);
    }
    const assembled = assemble(vector);
    const maxHpOf = (type: string): number | undefined =>
      assembled.maxHpByType.get(type) ?? assembled.ctx.unitTypes[type]?.hp;
    for (const error of checkInvariants(assembled.state, maxHpOf)) {
      mismatches.push(`装配状态违规: ${error}`);
    }

    const action = parseAction(raw);
    const before = canonicalJson(assembled.state);
    const result = applyAction(assembled.state, action, assembled.ctx, {
      explored: vector.given.map.explored ?? null,
    });

    const expect = vector.expect;
    if (typeof expect?.rejected !== 'boolean') throw new Error('expect.rejected 缺失');
    if (expect.rejected) {
      if (!result.rejected) {
        mismatches.push(`期望 rejected:true，实得 rejected:false（winner=${String(result.winner)}）`);
      } else if (canonicalJson(assembled.state) !== before) {
        mismatches.push('拒绝路径状态必须零变化（§2：规范化序列化前后不等）');
      }
    } else if (result.rejected) {
      mismatches.push(`期望 rejected:false，实得 rejected:true — ${result.reason}`);
    } else {
      for (const error of checkInvariants(result.state, maxHpOf)) {
        mismatches.push(`后继状态违规: ${error}`);
      }
      mismatches.push(...assertFields(expect, assembled, result.state, result.winner));
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
