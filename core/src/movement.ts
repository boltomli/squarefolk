/**
 * reachable —— core-spec §4.2「移动与 ZOC」可达集纯函数 + §6 map 型夹具解析。
 *
 * 硬红线（AGENTS.md）：仅整数运算（Math.floor），禁随机 / 浮点中间值 / 系统时间 / I/O。
 * 一切可调常数由 data/balance.json 的 movement 段读入，来源规格行：
 * - halfPointsPerPoint = 2：§4.2「起始 budget2 = move × 2」与
 *   「ceil_to_whole(b) = ((b + 1) // 2) × 2」（半点定点，§0 数值定点）
 * - cost2 = { road: 1, city: 1, swamp: 3, default: 2 }：§4.2「格消耗 cost2：
 *   普通地形 2、道路 / 城市 / 村庄 1、沼泽 3」（城 / 村共用 city 1，§6「城 / 村格 cost 1」）
 * - overshootAllowance2 = 1：§4.2「可达上界 dist ≤ budget2 + 1」
 *
 * 算法（§4.2 可达集）：Dijkstra，排序键 (dist, y, x)，邻接枚举序 N, NE, E, SE, S, SW, W, NW；
 * 进入判定 ceil_to_whole(remaining2) ≥ cost2（b 可为负 → ceil ≤ 0 → 判定必假，自然停）；
 * 扣减 budget2 − dist 允许为负。停止规则：与敌方单位相邻格（ZOC，道路不豁免）与
 * 粗地形（森林 / 山地且无路）可进不可穿；带路森林可穿过。过滤：目的地与路径经过格
 * 均须无单位（占位不可穿越）、非 hidden；explored 缺省或 [] = 全图已探索。
 * 出发格不算目的地（且不受 ZOC / 粗地形停走影响 —— 规则作用于「进入」，§4.2 停止规则）。
 */
import balance from '../../data/balance.json';

export interface Coord {
  y: number;
  x: number;
}

/** map 型 given 的 map 字段（§6：坐标一律 [y,x]；explored 缺省或 [] = 全图已探索） */
export interface MapFixture {
  h: number;
  w: number;
  /** 每行一个字符串，图例：`.`平原 `f`森林 `m`山地 `s`沼泽 `w`水域（陆地单位不可通行） */
  terrain: readonly string[];
  /** [y,x] 叠加在地形之上：路格 cost 1（森林 + 路 = 可穿过） */
  roads?: readonly (readonly number[])[] | null;
  /** [y,x] 叠加在地形之上：城 / 村格 cost 1（占领属 turn/*，移动只测通行） */
  cities?: readonly (readonly number[])[] | null;
  /** [y,x]；缺省或空数组 = 全图已探索，其外即 hidden */
  explored?: readonly (readonly number[])[] | null;
}

/** 夹具单位；units[0] = 发起移动的单位（§6 map 型 given），其余为占位 / ZOC 源 */
export interface MoveUnit {
  id: string;
  owner: string;
  /** 列 */
  x: number;
  /** 行 */
  y: number;
  /** 整点移动力；budget2 = move × halfPointsPerPoint */
  move: number;
}

interface MovementBalance {
  halfPointsPerPoint: number;
  cost2: { road: number; city: number; swamp: number; default: number };
  overshootAllowance2: number;
}

const movement: MovementBalance = balance.movement;

type TerrainKind = 'plain' | 'forest' | 'mountain' | 'swamp' | 'water';

/** §6 map 型 given 地形图例 */
const TERRAIN_LEGEND: Readonly<Record<string, TerrainKind>> = {
  '.': 'plain',
  f: 'forest',
  m: 'mountain',
  s: 'swamp',
  w: 'water',
};

/** §4.2 邻接枚举序：N, NE, E, SE, S, SW, W, NW */
const NEIGHBORS: readonly (readonly [number, number])[] = [
  [-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1],
];

interface ParsedMap {
  w: number;
  h: number;
  /** 每格 cost2；null = 水域不可入 */
  cost2: (number | null)[];
  /** 粗地形（森林 / 山地且该格无路）→ 可进不可穿 */
  rough: boolean[];
  /** null = 全图已探索；否则 1 = 已探索、0 = hidden */
  explored: Uint8Array | null;
}

/** 解析 [y,x] 坐标列表，越界 / 形状非法 throw（runner 计入 FAIL）。 */
function parseCoordList(
  entries: readonly (readonly number[])[] | null | undefined,
  label: string,
  h: number,
  w: number,
): Set<number> {
  const keys = new Set<number>();
  if (entries == null) {
    return keys;
  }
  entries.forEach((pair, index) => {
    if (!Array.isArray(pair) || pair.length !== 2 || !Number.isInteger(pair[0]) || !Number.isInteger(pair[1])) {
      throw new Error(`map: ${label}[${index}] 须为 [y, x] 整数对，得到 ${JSON.stringify(pair)}`);
    }
    const [y, x] = pair;
    if (y < 0 || y >= h || x < 0 || x >= w) {
      throw new Error(`map: ${label}[${index}] 越界 [${y}, ${x}]（地图 ${h}×${w}）`);
    }
    keys.add(y * w + x);
  });
  return keys;
}

/** 校验并物化地图：图例 → 地形 cost；roads / cities 叠加优先；explored 位图。 */
function parseMap(map: MapFixture): ParsedMap {
  const { h, w } = map;
  if (!Number.isInteger(h) || !Number.isInteger(w) || h < 1 || w < 1) {
    throw new Error(`map: h/w 须为正整数，得到 h=${String(h)} w=${String(w)}`);
  }
  if (!Array.isArray(map.terrain) || map.terrain.length !== h) {
    throw new Error(`map: terrain 行数须等于 h=${h}，得到 ${JSON.stringify(map.terrain)}`);
  }

  const roads = parseCoordList(map.roads, 'roads', h, w);
  const cities = parseCoordList(map.cities, 'cities', h, w);
  const exploredEntries = parseCoordList(map.explored, 'explored', h, w);

  const cost2: (number | null)[] = new Array(h * w);
  const rough: boolean[] = new Array(h * w);
  for (let y = 0; y < h; y += 1) {
    const row: string = map.terrain[y];
    if (typeof row !== 'string' || row.length !== w) {
      throw new Error(`map: terrain[${y}] 须为长度 ${w} 的字符串，得到 ${JSON.stringify(row)}`);
    }
    for (let x = 0; x < w; x += 1) {
      const kind: TerrainKind | undefined = TERRAIN_LEGEND[row[x]];
      if (kind === undefined) {
        throw new Error(`map: terrain[${y}][${x}] 未知图例字符 ${JSON.stringify(row[x])}`);
      }
      const idx = y * w + x;
      const hasRoad = roads.has(idx);
      if (kind === 'water') {
        cost2[idx] = null; // 水域不可入 —— 无条件优先于路 / 城叠加（v1 无海军，路也不能修在水上 §4.3）
      } else if (hasRoad) {
        cost2[idx] = movement.cost2.road;
      } else if (cities.has(idx)) {
        cost2[idx] = movement.cost2.city;
      } else if (kind === 'swamp') {
        cost2[idx] = movement.cost2.swamp;
      } else {
        cost2[idx] = movement.cost2.default;
      }
      rough[idx] = !hasRoad && (kind === 'forest' || kind === 'mountain');
    }
  }

  const explored = exploredEntries.size === 0 ? null : new Uint8Array(h * w);
  if (explored !== null) {
    for (const idx of exploredEntries) {
      explored[idx] = 1;
    }
  }
  return { w, h, cost2, rough, explored };
}

/** §4.2 进入判定：ceil_to_whole(b) = ((b + 1) // 2) × 2，b 可为负（floor 除法取上整到整点）。 */
function ceilToWhole(budget2: number): number {
  const n = movement.halfPointsPerPoint;
  return Math.floor((budget2 + n - 1) / n) * n;
}

/** 优先队列条目：排序键 (dist, y, x)（§4.2）。 */
interface HeapEntry {
  d: number;
  y: number;
  x: number;
}

function compareEntry(a: HeapEntry, b: HeapEntry): number {
  if (a.d !== b.d) return a.d - b.d;
  if (a.y !== b.y) return a.y - b.y;
  return a.x - b.x;
}

/** 二叉小根堆（确定性：比较键全序，无平局歧义）。 */
class MinHeap {
  private readonly items: HeapEntry[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: HeapEntry): void {
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (compareEntry(items[i], items[parent]) >= 0) break;
      const tmp = items[i];
      items[i] = items[parent];
      items[parent] = tmp;
      i = parent;
    }
  }

  pop(): HeapEntry {
    const items = this.items;
    const top = items[0];
    const last = items.pop() as HeapEntry;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let min = i;
        if (left < items.length && compareEntry(items[left], items[min]) < 0) min = left;
        if (right < items.length && compareEntry(items[right], items[min]) < 0) min = right;
        if (min === i) break;
        const tmp = items[i];
        items[i] = items[min];
        items[min] = tmp;
        i = min;
      }
    }
    return top;
  }
}

/**
 * 可达集（§4.2）：以 budget2 为预算的 Dijkstra，返回合法目的地坐标，
 * 按 [y, x] 字典序排序，不含出发格。纯函数：无 I/O、无随机、无系统时间。
 */
export function reachable(unit: MoveUnit, map: MapFixture, units: readonly MoveUnit[]): Coord[] {
  const parsed = parseMap(map);
  const { w, h } = parsed;
  if (!Number.isInteger(unit.x) || !Number.isInteger(unit.y) || unit.x < 0 || unit.x >= w || unit.y < 0 || unit.y >= h) {
    throw new Error(`units[0]: 坐标越界或非整数 [y=${String(unit.y)}, x=${String(unit.x)}]（地图 ${h}×${w}）`);
  }
  if (!Number.isInteger(unit.move) || unit.move < 0) {
    throw new Error(`units[0].move 须为非负整点整数，得到 ${String(unit.move)}`);
  }

  const budget2 = unit.move * movement.halfPointsPerPoint;
  const bound2 = budget2 + movement.overshootAllowance2;

  // 占位（任何单位所在格不可作目的地亦不可穿越）与 ZOC 源（owner 不同 = 敌方）
  const occupied = new Set<number>();
  const enemyCells: Coord[] = [];
  for (const other of units) {
    if (!Number.isInteger(other.x) || !Number.isInteger(other.y) || other.x < 0 || other.x >= w || other.y < 0 || other.y >= h) {
      throw new Error(`units: 单位 ${JSON.stringify(other.id)} 坐标越界或非整数 [y=${String(other.y)}, x=${String(other.x)}]（地图 ${h}×${w}）`);
    }
    occupied.add(other.y * w + other.x);
    if (other.owner !== unit.owner) {
      enemyCells.push({ y: other.y, x: other.x });
    }
  }

  const originIdx = unit.y * w + unit.x;
  const dist = new Int32Array(w * h).fill(-1);
  dist[originIdx] = 0;
  const heap = new MinHeap();
  heap.push({ d: 0, y: unit.y, x: unit.x });
  const dests: Coord[] = [];

  while (heap.size > 0) {
    const cur = heap.pop();
    const curIdx = cur.y * w + cur.x;
    if (dist[curIdx] !== cur.d) {
      continue; // 陈旧堆条目（松弛改进后遗留）
    }
    const isOrigin = curIdx === originIdx;
    if (!isOrigin) {
      dests.push({ y: cur.y, x: cur.x });
      // 停止规则（§4.2）：ZOC 优先级最高、道路不豁免；粗地形可进不可穿 —— 合法目的地但不扩张
      const inZoc = enemyCells.some(
        (enemy) => Math.abs(enemy.y - cur.y) <= 1 && Math.abs(enemy.x - cur.x) <= 1,
      );
      if (inZoc || parsed.rough[curIdx]) {
        continue;
      }
    }
    // 出发格：规则作用于「进入」，ZOC / 粗地形不冻结原地出发
    for (const [dy, dx] of NEIGHBORS) {
      const ny = cur.y + dy;
      const nx = cur.x + dx;
      if (ny < 0 || ny >= h || nx < 0 || nx >= w) {
        continue;
      }
      const nIdx = ny * w + nx;
      const cost = parsed.cost2[nIdx];
      if (cost === null) {
        continue; // 水域不可入
      }
      if (occupied.has(nIdx)) {
        continue; // 占位不可穿越（目的地与路径经过格均须无单位）
      }
      if (parsed.explored !== null && parsed.explored[nIdx] === 0) {
        continue; // hidden 过滤（explored 缺省或 [] = 全图已探索）
      }
      const nd = cur.d + cost;
      if (nd > bound2) {
        continue; // 可达上界 dist ≤ budget2 + 1
      }
      if (ceilToWhole(budget2 - cur.d) < cost) {
        continue; // 进入判定：ceil_to_whole(remaining2) ≥ cost2（负预算在此自然停）
      }
      if (dist[nIdx] === -1 || nd < dist[nIdx]) {
        dist[nIdx] = nd;
        heap.push({ d: nd, y: ny, x: nx });
      }
    }
  }

  dests.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));
  return dests;
}
