/**
 * 视野可见集 + `viewFor` 三态裁剪 —— core-spec §4.5（行 276–288）、§6 vision 型 given（行 419–436）。
 *
 * balance 来源（data/balance.json vision 段，spec 行见该段 `source`）：
 * - unitRadius = 1、mountainUnitRadius = 2、cityRadius = 2 ← §4.5 行 280「视野源与半径」
 *
 * 规则要点：
 * - 视野源只算观察者己方：己方单位 1；**位于山地的己方单位** 2；己方城市 2；距离 = 切比雪夫；取并集
 *   （§4.5 行 280–281；§6 行 433–435）
 * - 空山地不是源；敌方单位 / 敌城 / 中立城永不是观察者的源（§6 行 435）
 * - `viewFor` 三态输出（§4.5 行 283–285）：`visible` 全量（地形、资源、建筑、敌方单位）；
 *   `explored` 有地形与建筑轮廓、无单位；`hidden` 仅"未探索"标记
 *
 * 已探索历史不在 State（§1 行 47：视野三态衍生量不入状态；§4.5 行 281：`explored` 一旦成立不回退）
 * → 按 design §2.5「每玩家迷雾位图」作为 `viewFor` 的输入传入（§6 行 414 同语义：缺省或空 = 全图已探索）。
 * 山地地形 id 属 content 层 terrain.json（未入库）→ 注入参数，同 state.ts `MaxHpLookup` 惯例。
 *
 * 硬红线（AGENTS.md）：纯函数，仅整数运算，禁随机 / 浮点中间值 / 系统时间 / I/O；
 * 集合输出按行主序 `[y, x]` 升序（红线 3：显式排序，不依赖哈希序）。
 */
import balance from '../../data/balance.json';
import type { State } from './state';

export interface Coord {
  y: number;
  x: number;
}

interface VisionBalance {
  source: string;
  unitRadius: number;
  mountainUnitRadius: number;
  cityRadius: number;
}

const vision: VisionBalance = balance.vision;

/** §6 vision 型 given 的 map 字段（行 421–426）：terrain 图例同 map 型底座（`m` = 山地），cities 为 [y,x,owner] 三元组 */
export interface VisionMapFixture {
  h: number;
  w: number;
  terrain: readonly string[];
  cities?: readonly (readonly [y: number, x: number, owner: string])[] | null;
}

export interface VisionUnit {
  id: string;
  owner: string;
  x: number;
  y: number;
}

/** 视野源：源格 + 半径 */
interface Source {
  y: number;
  x: number;
  radius: number;
}

/** 切比雪夫距离（§0 行 16：max(|dx|, |dy|)），仅整数运算 */
function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx > 0 ? ax - bx : bx - ax;
  const dy = ay - by > 0 ? ay - by : by - ay;
  return dx > dy ? dx : dy;
}

/** 所有源的切比雪夫圆盘并集（地图内裁剪），按行主序输出 [y,x] 升序 */
function unionOfSources(w: number, h: number, sources: readonly Source[]): Coord[] {
  const seen = new Uint8Array(w * h);
  for (const source of sources) {
    const y0 = source.y - source.radius;
    const y1 = source.y + source.radius;
    const x0 = source.x - source.radius;
    const x1 = source.x + source.radius;
    for (let y = y0 <= 0 ? 0 : y0; y <= y1 && y < h; y += 1) {
      for (let x = x0 <= 0 ? 0 : x0; x <= x1 && x < w; x += 1) {
        seen[y * w + x] = 1;
      }
    }
  }
  const cells: Coord[] = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (seen[y * w + x] === 1) {
        cells.push({ y, x });
      }
    }
  }
  return cells;
}

/**
 * vision 夹具的可见集（§6 行 419–436）：观察者 = `viewer`（owner 字符串），
 * 源 = 己方单位（山地地形 `m` 上 → 半径 2）与己方城市三元组（半径 2），并集。
 */
export function visibleCells(viewer: string, map: VisionMapFixture, units: readonly VisionUnit[]): Coord[] {
  const sources: Source[] = [];
  for (const unit of units) {
    if (unit.owner !== viewer) {
      continue; // §6 行 435：敌方单位永不是观察者的源
    }
    const row = map.terrain[unit.y];
    const onMountain = row !== undefined && row[unit.x] === 'm'; // 空山地不是源 —— 只看单位脚下的地形
    sources.push({
      y: unit.y,
      x: unit.x,
      radius: onMountain ? vision.mountainUnitRadius : vision.unitRadius,
    });
  }
  for (const city of map.cities ?? []) {
    // §6 行 434：cities 为 [y,x,owner]；只有己方城成源（敌城 / 中立城永不是源）
    if (city[2] === viewer) {
      sources.push({ y: city[0], x: city[1], radius: vision.cityRadius });
    }
  }
  return unionOfSources(map.w, map.h, sources);
}

/**
 * State 级可见集（§4.5 行 280）：`viewerIdx` 为 `players[]` 下标。
 * `mountainTerrainId` = content 层山地地形 id（terrain.json 未入库 → 注入）。
 */
export function visibleCellsFor(viewerIdx: number, state: State, mountainTerrainId: string): Coord[] {
  const sources: Source[] = [];
  for (const unit of state.units) {
    if (unit.owner !== viewerIdx) {
      continue;
    }
    const tile = state.tiles[unit.y]?.[unit.x];
    const onMountain = tile !== undefined && tile.terrain === mountainTerrainId;
    sources.push({
      y: unit.y,
      x: unit.x,
      radius: onMountain ? vision.mountainUnitRadius : vision.unitRadius,
    });
  }
  for (const city of state.cities) {
    if (city.owner === viewerIdx) {
      sources.push({ y: city.y, x: city.x, radius: vision.cityRadius });
    }
  }
  return unionOfSources(state.map.width, state.map.height, sources);
}

export type TileVisibility = 'hidden' | 'explored' | 'visible';

/** `visible` 格上的敌方单位（§4.5 行 283；己方单位由客户端全局已知，不进视图） */
export interface ViewEnemyUnit {
  id: string;
  owner: number;
  type: string;
  x: number;
  y: number;
  hp: number;
}

/** 单格视图输出（§4.5 行 283–285；缺省字段不输出，与 §0 行 19 缺省剔除一致） */
export interface ViewTile {
  y: number;
  x: number;
  visibility: TileVisibility;
  /** `hidden` → null；`visible` / `explored` → 地形 id（行 284–285） */
  terrain: string | null;
  /** 仅 `visible`：资源（行 283） */
  resource?: string;
  /** 建筑（城市 / 改良 / 道路）：`visible` 全量（行 283）、`explored` 轮廓（行 284）、`hidden` 无 */
  building?: { cityId?: string | null; improved?: string | null; road?: boolean };
  /** 仅 `visible`：敌方单位（行 283）；`explored` 无单位（行 284） */
  enemyUnits?: ViewEnemyUnit[];
}

export interface ViewForOptions {
  /**
   * 该玩家已探索格 `[y,x]`；缺省或空 = 全图已探索（§6 行 414）。
   * `explored` 历史不在 State（§1 行 47 / §4.5 行 281），按 design §2.5 每玩家迷雾位图传入。
   */
  explored?: readonly (readonly number[])[] | null;
  /** 山地地形 id（content 层未入库 → 注入，同 `MaxHpLookup` 惯例） */
  mountainTerrainId: string;
}

/**
 * `viewFor(player)` 三态裁剪（§4.5 行 282–286）：按行主序返回每格视图。
 * `visible` = 源并集实时计算；`explored` 取输入位图（不回退）；两者皆无 → `hidden`。
 * 纯函数：无随机 / 浮点 / 系统时间 / I/O。
 */
export function viewFor(viewerIdx: number, state: State, options: ViewForOptions): ViewTile[] {
  const width = state.map.width;
  const height = state.map.height;
  const visibleFlags = new Uint8Array(width * height);
  for (const cell of visibleCellsFor(viewerIdx, state, options.mountainTerrainId)) {
    visibleFlags[cell.y * width + cell.x] = 1;
  }

  const exploredEntries = new Set<number>();
  for (const pair of options.explored ?? []) {
    const y = pair[0];
    const x = pair[1];
    if (y >= 0 && y < height && x >= 0 && x < width) {
      exploredEntries.add(y * width + x);
    }
  }
  const exploredAll = exploredEntries.size === 0; // §6 行 414：缺省或空 = 全图已探索

  // 敌方单位按坐标分桶（行主序遍历天然有序；§1 行 27：units 按 id 存储序 → 桶内 id 序稳定）
  const enemyByCell = new Map<number, ViewEnemyUnit[]>();
  for (const unit of state.units) {
    if (unit.owner === viewerIdx) {
      continue;
    }
    const key = unit.y * width + unit.x;
    const bucket = enemyByCell.get(key);
    const entry: ViewEnemyUnit = { id: unit.id, owner: unit.owner, type: unit.type, x: unit.x, y: unit.y, hp: unit.hp };
    if (bucket === undefined) {
      enemyByCell.set(key, [entry]);
    } else {
      bucket.push(entry);
    }
  }

  const view: ViewTile[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const key = y * width + x;
      const tile = state.tiles[y][x];
      const isVisible = visibleFlags[key] === 1;
      const isExplored = exploredAll || exploredEntries.has(key);

      if (isVisible) {
        // 行 283：visible 格 → 地形、资源、建筑、敌方单位
        const out: ViewTile = { y, x, visibility: 'visible', terrain: tile.terrain };
        if (tile.resource !== undefined && tile.resource !== null) {
          out.resource = tile.resource;
        }
        const building = {
          cityId: tile.cityId ?? null,
          improved: tile.improved ?? null,
          road: tile.road,
        };
        if (building.cityId !== null || building.improved !== null || building.road) {
          out.building = building;
        }
        const enemyUnits = enemyByCell.get(key);
        if (enemyUnits !== undefined && enemyUnits.length > 0) {
          out.enemyUnits = enemyUnits;
        }
        view.push(out);
      } else if (isExplored) {
        // 行 284：explored 格 → 地形与建筑轮廓，无单位、无资源
        const out: ViewTile = { y, x, visibility: 'explored', terrain: tile.terrain };
        const building = {
          cityId: tile.cityId ?? null,
          improved: tile.improved ?? null,
          road: tile.road,
        };
        if (building.cityId !== null || building.improved !== null || building.road) {
          out.building = building;
        }
        view.push(out);
      } else {
        // 行 285：hidden 格 → 仅"未探索"标记
        view.push({ y, x, visibility: 'hidden', terrain: null });
      }
    }
  }
  return view;
}
