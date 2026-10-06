/**
 * 世界生成（core-spec §4.6「自然生成算法体」步骤 1–10 + 公平带挑选 + 重试；T3 冻结 2026-10-06）。
 *
 * 纯函数 `generate(seed, h, w, params)`：
 * - 随机只来自显式 seed 的 splitmix64 单流（§0 行 17 → `prng.ts` 复用，不重写）；
 *   每次尝试 attempt t 用 `seed_t = seed + t`（u64 回绕）重新初始化单流（坑⑤）
 * - 全程整数（u64 用 BigInt）、零浮点、零系统时间、零 I/O；比例处用 §0 `round_half_up`
 * - 参数合并 = `{...balance.world, ...given.world}` **浅合并**（坑⑪ → `mergeWorldParams`）
 * - `terrainWeights` 按**对象键序**累计（JSON.parse 插入序，**禁止排序**，坑①）
 *
 * 黄金向量：`testdata/golden/world/gen-*.json`（验收 = 5/5 断言通过）。
 */
import balance from '../../data/balance.json';
import { terrainLegendFromId } from './actions';
import { u64Hex } from './canonical';
import { U64_MASK } from './constants';
import { Splitmix64 } from './prng';

/** §4.6 步骤 10 的 `balance.world` 参数面（结构 = data/balance.json world 段） */
export interface WorldParams {
  source?: string;
  minMapSize: number;
  maxMapSize: number;
  terrainWeights: Readonly<Record<string, number>>;
  smoothRounds: number;
  smoothPriority: readonly string[];
  villageCount: number;
  resourceCount: Readonly<Record<string, number>>;
  resourcePlacement: Readonly<Record<string, readonly string[]>>;
  spawnTerrains: readonly string[];
  minSpawnEdge: number;
  minReach: number;
  dMin: number;
  epsilon: number;
  retryCap: number;
  spawnCount: number;
  scoreRadius: number;
  wNearVillage: number;
  wResource: number;
  wMobility: number;
  wEdge: number;
  wRuin: number;
  resourceValue: Readonly<Record<string, number>>;
}

/** 成功终态（§4.6 步骤 9）：terrain 为 §6 图例字符串行，坐标 [y,x] 升序，startValues 与 spawns 对齐 */
export interface WorldGenOk {
  ok: true;
  terrain: string[];
  villages: number[][];
  resources: (string | number)[][];
  spawns: number[][];
  attempts: number;
  startValues: number[];
  /** 成功尝试最后一次抽签后的流状态（坑⑨），u64 十六 hex 小写 */
  rngFinal: string;
}

/** 失败终态（§4.6 步骤 9：报错而非硬塞）；`attempts = retryCap + 1` */
export interface WorldGenErr {
  ok: false;
  reason: string;
  attempts: number;
}

export type WorldGenResult = WorldGenOk | WorldGenErr;

/**
 * 参数合并（坑⑪）：`{...balance.world, ...given.world}` **浅合并** —— 覆盖键整值替换
 * （含嵌套对象整表替换，非深合并），未覆盖键回落 balance（§6：`{}` = 全用 balance）。
 */
export function mergeWorldParams(overrides: Readonly<Record<string, unknown>>): WorldParams {
  return { ...(balance.world as unknown as WorldParams), ...overrides } as WorldParams;
}

/** §0 `round_half_up(n, d) = floor((2n + d) / (2d))`（输入非负；不调语言 round()） */
function roundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** 切比雪夫距离（§0：8 向邻接） */
function chebyshev(ay: number, ax: number, by: number, bx: number): number {
  const dy = ay > by ? ay - by : by - ay;
  const dx = ax > bx ? ax - bx : bx - ax;
  return dy > dx ? dy : dx;
}

/** 格到图边的切比雪夫距离 = min(y, x, h-1-y, w-1-x) */
function borderDistance(y: number, x: number, h: number, w: number): number {
  const top = y;
  const bottom = h - 1 - y;
  const left = x;
  const right = w - 1 - x;
  let min = top < bottom ? top : bottom;
  if (left < min) min = left;
  if (right < min) min = right;
  return min;
}

/** seed 归一到 u64（§6：给定 seed 为 JSON 整数；u64 回绕用掩码） */
function normalizeSeed(seed: bigint | number): bigint {
  if (typeof seed === 'bigint') {
    if (seed < 0n || seed > U64_MASK) {
      throw new Error(`world: seed 越界 u64：${seed}`);
    }
    return seed & U64_MASK;
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > Number.MAX_SAFE_INTEGER) {
    throw new Error(`world: seed 非法：${String(seed)}`);
  }
  return BigInt(seed);
}

/**
 * 组合枚举（坑⑦）：基于行主序候选表的**索引递增字典序**（itertools.combinations 语义）——
 * 深度优先、每层候选索引严格递增，产出序 = (0,1),(0,2),…,(0,n-1),(1,2),…
 *
 * `accepts` 对前缀单调（子集必被超集蕴含的约束：两两距离、分数带宽），故可剪枝：
 * 前缀不合法 → 一切含该前缀的组合必不合法；剪枝只做过滤、不改序、不改内容。
 */
function enumerateCombos(n: number, k: number, accepts: (combo: readonly number[]) => boolean): number[][] {
  const out: number[][] = [];
  const current: number[] = [];
  const walk = (start: number): void => {
    if (current.length === k) {
      out.push(current.slice());
      return;
    }
    for (let i = start; i < n; i += 1) {
      current.push(i);
      if (accepts(current)) walk(i + 1);
      current.pop();
    }
  };
  walk(0);
  return out;
}

/** 单次尝试（消耗表 1–6 全在本函数内；失败返回 null，流随之丢弃） */
function attempt(
  rng: Splitmix64,
  h: number,
  w: number,
  params: WorldParams,
  /** terrainWeights **对象键序**（JSON.parse 插入序；禁排序，坑①） */
  weightKeys: readonly string[],
  /** 平滑平票秩：smoothPriority 序在前，未列出者按 weightKeys 序殿后（总序、确定性） */
  priorityRank: ReadonlyMap<string, number>,
): Omit<WorldGenOk, 'attempts' | 'ok'> | null {
  const cellCount = h * w;

  // ── 步骤 1：原始撒点 —— 行主序每格 1 抽，键序累计，d mod 1000 < 累计和的首个地形胜出 ──
  const grid: string[][] = [];
  for (let y = 0; y < h; y += 1) {
    const row: string[] = new Array<string>(w);
    for (let x = 0; x < w; x += 1) {
      const bucket = Number(rng.next() % 1000n);
      let cumulative = 0;
      let picked: string | null = null;
      for (const key of weightKeys) {
        cumulative += params.terrainWeights[key];
        if (bucket < cumulative) {
          picked = key;
          break;
        }
      }
      // generate() 已校验总和恰为 1000 → bucket < 1000 必命中；null 仅为类型收窄
      row[x] = picked ?? weightKeys[weightKeys.length - 1];
    }
    grid.push(row);
  }

  // ── 步骤 2：元胞平滑 ×smoothRounds —— Jacobi 同步更新（每轮只读旧快照，坑②）；零抽 ──
  let current = grid;
  for (let round = 0; round < params.smoothRounds; round += 1) {
    const next: string[][] = current.map((row) => row.slice());
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const counts = new Map<string, number>();
        for (let dy = -1; dy <= 1; dy += 1) {
          const ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            if (nx < 0 || nx >= w) continue;
            const terrain = current[ny][nx];
            counts.set(terrain, (counts.get(terrain) ?? 0) + 1);
          }
        }
        // 出现次数最多者胜；平票 → smoothPriority 靠前者胜
        let best = '';
        let bestCount = -1;
        let bestRank = Number.MAX_SAFE_INTEGER;
        for (const [terrain, count] of counts) {
          const rank = priorityRank.get(terrain) ?? Number.MAX_SAFE_INTEGER;
          if (count > bestCount || (count === bestCount && rank < bestRank)) {
            best = terrain;
            bestCount = count;
            bestRank = rank;
          }
        }
        next[y][x] = best;
      }
    }
    current = next;
  }
  const finalGrid = current;

  // ── 步骤 3：最大连通陆块 —— 非水格 8-邻、行主序扫描，size 严格 > 才替换（平票留首遇，坑③）；零抽 ──
  const WATER = 'water';
  const component = new Int32Array(cellCount).fill(-1);
  const componentSizes: number[] = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const start = y * w + x;
      if (finalGrid[y][x] === WATER || component[start] !== -1) continue;
      const id = componentSizes.length;
      const stack: number[] = [start];
      component[start] = id;
      let size = 0;
      while (stack.length > 0) {
        const cell = stack.pop() as number;
        size += 1;
        const cy = Math.floor(cell / w);
        const cx = cell - cy * w;
        for (let dy = -1; dy <= 1; dy += 1) {
          const ny = cy + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx;
            if (nx < 0 || nx >= w) continue;
            const neighbour = ny * w + nx;
            if (finalGrid[ny][nx] !== WATER && component[neighbour] === -1) {
              component[neighbour] = id;
              stack.push(neighbour);
            }
          }
        }
      }
      componentSizes.push(size);
    }
  }
  // 分量按行主序首遇编号 → 严格 > 即「平票留行主序先遇到者」
  let bestComponent = -1;
  let bestSize = 0;
  for (let id = 0; id < componentSizes.length; id += 1) {
    if (componentSizes[id] > bestSize) {
      bestSize = componentSizes[id];
      bestComponent = id;
    }
  }
  // 分量外陆格全部改水
  for (let cell = 0; cell < cellCount; cell += 1) {
    const y = Math.floor(cell / w);
    const x = cell - y * w;
    if (finalGrid[y][x] !== WATER && component[cell] !== bestComponent) {
      finalGrid[y][x] = WATER;
      component[cell] = -1;
    }
  }

  // ── 占用表（村庄/资源布置的「未占用」判据，行主序格号） ──
  const occupied = new Set<number>();

  // ── 步骤 4：村庄 —— 候选 = plain 且未占用（行主序）；splice 移除保持剩余行主序（坑④）；枯竭提前停 ──
  const villageCandidates: number[] = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (finalGrid[y][x] === 'plain') villageCandidates.push(y * w + x);
    }
  }
  const villages: number[][] = [];
  for (let placed = 0; placed < params.villageCount && villageCandidates.length > 0; placed += 1) {
    const pick = Number(rng.next() % BigInt(villageCandidates.length));
    const cell = villageCandidates[pick];
    villageCandidates.splice(pick, 1);
    occupied.add(cell);
    villages.push([Math.floor(cell / w), cell % w]);
  }

  // ── 步骤 5：资源 —— kind 按 id 升序（beast → fruit）；候选 = terrain ∈ placement[kind] 且未占用（行主序）；枯竭提前停 ──
  const resourceKinds = Object.keys(params.resourceCount).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const resources: [number, number, string][] = [];
  for (const kind of resourceKinds) {
    const allowed = new Set<string>(params.resourcePlacement[kind] ?? []);
    const candidates: number[] = [];
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const cell = y * w + x;
        if (allowed.has(finalGrid[y][x]) && !occupied.has(cell)) candidates.push(cell);
      }
    }
    const target = params.resourceCount[kind];
    for (let placed = 0; placed < target && candidates.length > 0; placed += 1) {
      const pick = Number(rng.next() % BigInt(candidates.length));
      const cell = candidates[pick];
      candidates.splice(pick, 1);
      occupied.add(cell);
      resources.push([Math.floor(cell / w), cell % w, kind]);
    }
  }

  // ── 步骤 6：出生点候选 C（行主序）：spawnTerrains + 距边 ≥ minSpawnEdge + 非村非资源 + 分量规模 ≥ minReach ──
  const spawnTerrains = new Set<string>(params.spawnTerrains);
  const spawnCandidates: number[] = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const cell = y * w + x;
      if (!spawnTerrains.has(finalGrid[y][x])) continue;
      if (borderDistance(y, x, h, w) < params.minSpawnEdge) continue;
      if (occupied.has(cell)) continue;
      if (component[cell] === -1 || componentSizes[component[cell]] < params.minReach) continue;
      spawnCandidates.push(cell);
    }
  }
  // |C| < spawnCount → 本尝试失败（步骤 8）
  if (spawnCandidates.length < params.spawnCount) return null;

  // ── 步骤 7：评分（全整数；仅 mob 比例用 §0 round_half_up，坑⑩；mob 整除向零截断） ──
  const radius = params.scoreRadius;
  const scores: number[] = [];
  for (const cell of spawnCandidates) {
    const cy = Math.floor(cell / w);
    const cx = cell - cy * w;

    // near(c) = Σ minChebyshev(c, v)（无村 → 0）
    let near = 0;
    for (const [vy, vx] of villages) near += chebyshev(cy, cx, vy, vx);

    // res(c) = Σ resourceValue[kind]（chebyshev ≤ scoreRadius 内）
    let res = 0;
    for (const [ry, rx, kind] of resources) {
      if (chebyshev(cy, cx, ry, rx) <= radius) res += params.resourceValue[kind] ?? 0;
    }

    // mob1000(c) = round_half_up(1000 × 邻域非水格数, 邻域图内格数)（邻域 = scoreRadius 切比雪夫、地图裁剪）
    let nonWater = 0;
    let neighbourhood = 0;
    const y0 = cy - radius < 0 ? 0 : cy - radius;
    const y1 = cy + radius >= h ? h - 1 : cy + radius;
    const x0 = cx - radius < 0 ? 0 : cx - radius;
    const x1 = cx + radius >= w ? w - 1 : cx + radius;
    for (let ny = y0; ny <= y1; ny += 1) {
      for (let nx = x0; nx <= x1; nx += 1) {
        neighbourhood += 1;
        if (finalGrid[ny][nx] !== WATER) nonWater += 1;
      }
    }
    const mob1000 = roundHalfUp(1000 * nonWater, neighbourhood);
    // w3·mob1000 ÷ 100：整数除法向零截断（正数 = floor）；mob1000 ∈ 0..1000 → 值域 0..10×w3
    const mobility = Math.floor((params.wMobility * mob1000) / 100);

    // edgePen(c) = max(0, scoreRadius − minChebyshevToBorder(c))
    const edgePen = radius - borderDistance(cy, cx, h, w);
    const penalty = edgePen > 0 ? edgePen : 0;

    // ruins(c) = 0（v1 无遗迹载体 T7，w5·ruins 槽位恒 0）
    const ruins = 0;

    scores.push(
      -params.wNearVillage * near +
        params.wResource * res +
        mobility +
        params.wRuin * ruins -
        params.wEdge * penalty,
    );
  }

  // ── 步骤 8：公平带 —— 索引字典序枚举组合；两两 ≥ dMin 且 max−min ≤ ε；合法非空 → 抽 1 次 ──
  const { dMin, epsilon, spawnCount } = params;
  const candidates = spawnCandidates;
  const combos = enumerateCombos(candidates.length, spawnCount, (combo) => {
    // 分数带宽（先查，便宜）—— 前缀单调：子集带宽 ≤ 超集带宽
    let min = Number.MAX_SAFE_INTEGER;
    let max = -Number.MAX_SAFE_INTEGER;
    for (const index of combo) {
      const value = scores[index];
      if (value < min) min = value;
      if (value > max) max = value;
    }
    if (max - min > epsilon) return false;
    // 两两切比雪夫 ≥ dMin —— 子集继承，单调可剪
    for (let i = 0; i < combo.length; i += 1) {
      const a = candidates[combo[i]];
      const ay = Math.floor(a / w);
      const ax = a - ay * w;
      for (let j = i + 1; j < combo.length; j += 1) {
        const b = candidates[combo[j]];
        const by = Math.floor(b / w);
        const bx = b - by * w;
        if (chebyshev(ay, ax, by, bx) < dMin) return false;
      }
    }
    return true;
  });
  if (combos.length === 0) return null;

  const picked = Number(rng.next() % BigInt(combos.length));
  const chosen = combos[picked];

  // 输出：spawns 行主序升序、startValues 与之对齐（坑⑧；组合索引本已递增，显式排序钉死红线）
  const rows = chosen.map((index) => {
    const cell = candidates[index];
    const y = Math.floor(cell / w);
    return { y, x: cell - y * w, value: scores[index] };
  });
  rows.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));
  const spawns = rows.map((row) => [row.y, row.x]);
  const startValues = rows.map((row) => row.value);

  // 村庄 / 资源输出同样行主序升序（布置序只是抽签序；resources 按 [y,x,kind] 升序）
  villages.sort((a, b) => (a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]));
  resources.sort((a, b) => (a[0] !== b[0] ? a[0] - b[0] : a[1] !== b[1] ? a[1] - b[1] : a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0));

  // rngFinal = 最后一抽（公平带 idx）之后的流状态（坑⑨）
  const rngFinal = u64Hex(rng.state);

  const terrain: string[] = [];
  for (let y = 0; y < h; y += 1) {
    let row = '';
    for (let x = 0; x < w; x += 1) row += terrainLegendFromId(finalGrid[y][x]);
    terrain.push(row);
  }

  return { terrain, villages, resources, spawns, startValues, rngFinal };
}

/**
 * 世界生成入口（§4.6 步骤 1–10）：
 * 重试 `t = 0..retryCap` 共 `retryCap + 1` 次（坑⑤），`seed_t = seed + t`（u64 回绕）；
 * 全部失败 → `{ok:false, reason 逐字, attempts: retryCap+1}`（坑⑥）；
 * 成功 → `{ok:true, attempts: t+1, …}`。纯函数：同输入必同输出。
 */
export function generate(seed: bigint | number, h: number, w: number, params: WorldParams): WorldGenResult {
  const seedU64 = normalizeSeed(seed);
  if (!Number.isInteger(h) || !Number.isInteger(w) || h < 1 || w < 1) {
    throw new Error(`world: 地图尺寸非法 ${String(h)}×${String(w)}（§4.6）`);
  }
  // §4.6 尺寸合法性（最先判定：不消耗 RNG、不进入重试；2026-10-06 补裁 P10 上报项 2）
  if (h < params.minMapSize || h > params.maxMapSize || w < params.minMapSize || w > params.maxMapSize) {
    return {
      ok: false,
      reason: `world: 尺寸超界（h=${String(h)}, w=${String(w)}；minMapSize=${String(params.minMapSize)}, maxMapSize=${String(params.maxMapSize)}）`,
      attempts: 0,
    };
  }

  // 坑①：键序 = JSON.parse 插入序（balance 文件序 water→plain→forest→swamp→mountain），禁止排序
  const weightKeys = Object.keys(params.terrainWeights);
  let totalWeight = 0;
  for (const key of weightKeys) totalWeight += params.terrainWeights[key];
  if (weightKeys.length === 0 || totalWeight !== 1000) {
    throw new Error(`world: terrainWeights ${weightKeys.length} 键、总和 ${totalWeight}（§4.6 步骤 1 要求总和 1000）`);
  }

  // 平滑平票总序：smoothPriority 在前、未列出的权重键殿后（确定性；不依赖 Map 迭代序）
  const priorityRank = new Map<string, number>();
  params.smoothPriority.forEach((terrain, index) => priorityRank.set(terrain, index));
  weightKeys.forEach((terrain, index) => {
    if (!priorityRank.has(terrain)) priorityRank.set(terrain, params.smoothPriority.length + index);
  });

  for (let t = 0; t <= params.retryCap; t += 1) {
    const rng = new Splitmix64((seedU64 + BigInt(t)) & U64_MASK);
    const done = attempt(rng, h, w, params, weightKeys, priorityRank);
    if (done !== null) {
      return { ok: true, ...done, attempts: t + 1 };
    }
  }

  // 坑⑥：失败 reason 逐字（design §2.6-5 报错而非硬塞）
  return { ok: false, reason: 'world: 公平带无解（重试超限）', attempts: params.retryCap + 1 };
}
