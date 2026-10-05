/**
 * 领地归属纯函数 —— core-spec §4.3「领地模型（方案 C：动态扩边）」（行 250–260）、
 * §6 territory 型 given（行 438–457）。
 *
 * balance 来源（data/balance.json territory 段，spec 行见该段 `source`）：
 * - borderRadiusByLevel {1:1, 2:1, 3:2, 4:2, 5:3, 6:3} ← §4.3 行 252
 *   「radius(city) = ceil(level ÷ 2)」默认表（公式只是默认，逐级可改）
 *
 * 规则要点（§4.3 行 254）：
 * - 每个格子归**全城池中最近的城市**：切比雪夫距离、与城市阵营无关地比较
 * - 距离并列 → `city id` 字典序小者胜
 * - 格子在**其归属城市** `radius` 内 → 属该城 `owner`；否则 `unowned`
 *   （即使更远的别的城市半径覆盖到这里也不算，§6 行 455）
 *
 * 领地是衍生量不入状态（§1 行 47；§4.3 行 256），每动作后重算。
 * 硬红线（AGENTS.md）：纯函数，仅整数运算，禁随机 / 浮点中间值 / 系统时间 / I/O；
 * 输出列表按行主序 `[y, x]` 升序（红线 3）。
 */
import balance from '../../data/balance.json';

interface TerritoryBalance {
  source: string;
  borderRadiusByLevel: Record<string, number>;
}

const territoryBalance: TerritoryBalance = balance.territory;

/** 无主格的键（§6 行 457：`expect.territory` 键 = owner id，无主格键 = `"unowned"`） */
export const UNOWNED_KEY = 'unowned';

/** territory 夹具 / 领地结算的城市：`radius` 为已解析值（level → balance 映射不属夹具，§6 行 456） */
export interface TerritoryCity {
  id: string;
  x: number;
  y: number;
  owner: string;
  radius: number;
}

/** 领地图：owner id（或 `UNOWNED_KEY`）→ `[y, x]` 升序列表；空列表的键不输出 */
export type TerritoryGrid = Record<string, [number, number][]>;

/**
 * `level → borderRadiusByLevel` 解析（§4.3 行 252）。
 * 表外等级 = 规格空白（balance 表只定义 1–6）→ 抛错报告而非静默取值。
 */
export function resolveBorderRadius(level: number): number {
  const radius = territoryBalance.borderRadiusByLevel[String(level)];
  if (radius === undefined) {
    throw new Error(`territory.borderRadiusByLevel 缺少 level=${level} 的条目（§4.3 行 252）`);
  }
  return radius;
}

/** 切比雪夫距离（§0 行 16），仅整数运算 */
function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx > 0 ? ax - bx : bx - ax;
  const dy = ay - by > 0 ? ay - by : by - ay;
  return dx > dy ? dx : dy;
}

/**
 * 领地图结算（§4.3 行 254）：每格归全城池中最近城市（切比雪夫、与阵营无关；
 * 并列 → city id 字典序小者），再查该城 `radius`（内 → owner，外 → unowned）。
 * 归属比较是 `(距离, city id)` 全序 → 与 cities 传入顺序无关（确定性）。
 */
export function territoryGrid(h: number, w: number, cities: readonly TerritoryCity[]): TerritoryGrid {
  const grid: TerritoryGrid = {};
  const push = (owner: string, y: number, x: number): void => {
    const list = grid[owner];
    if (list === undefined) {
      grid[owner] = [[y, x]];
    } else {
      list.push([y, x]);
    }
  };

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let best: TerritoryCity | null = null;
      let bestDistance = 0;
      for (const city of cities) {
        const distance = chebyshev(x, y, city.x, city.y);
        if (best === null || distance < bestDistance || (distance === bestDistance && city.id < best.id)) {
          best = city;
          bestDistance = distance;
        }
      }
      if (best !== null && bestDistance <= best.radius) {
        push(best.owner, y, x);
      } else {
        push(UNOWNED_KEY, y, x);
      }
    }
  }
  return grid;
}
