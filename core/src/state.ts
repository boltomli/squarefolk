/**
 * State —— core-spec §1 状态模型（冻结 v0.1，docs/core-spec.md 行 24–47）。
 *
 * 数组存储序 = 规范序（§1 行 26）：units / cities 按 id 字典序、players 按 idx、
 * tiles 行主序 (y, x)、actionLog 按 seq 升序且连续无洞。
 * checkInvariants 逐条实现 §1 不变量（行 45）并核对字段域 / 存储序（行 26、30–43）。
 *
 * 确定性：本文件只定义结构与纯检查，禁随机 / 浮点中间值 / 系统时间 / I/O（AGENTS.md 红线 1）。
 * 持久化只用字符串 id（红线 2）；u64 字段（seed / rng）用 bigint，序列化时转 16 hex（§0 行 19）。
 */
import { U64_MASK } from './constants';

export type Phase = 'prep' | 'act' | 'commit';

export interface MapDims {
  /** u16，≤ 30（§1 行 35） */
  width: number;
  /** u16，≤ 30（§1 行 35） */
  height: number;
}

export interface Tile {
  /** 地形 id（字符串 id，domain.name） */
  terrain: string;
  /** 资源 id；无 = null / 缺省（序列化时剔除，§0 行 19） */
  resource?: string | null;
  /** 该格所属城市 id；无 = null / 缺省（全局唯一，§1 行 45） */
  cityId?: string | null;
  /** 中立村庄标记（§1 行 39：移动进入 → 转 `cityId`、`village=false`） */
  village: boolean;
  /** 是否有道路 */
  road: boolean;
  /** 改良设施 id；无 = null / 缺省 */
  improved?: string | null;
}

export interface Unit {
  id: string;
  /** players[] 下标 */
  owner: number;
  /** 兵种 id（maxHp(type) 查单位类型表） */
  type: string;
  x: number;
  y: number;
  /** 0 ≤ hp ≤ maxHp(type)（§1 行 45） */
  hp: number;
  moved: boolean;
  attacked: boolean;
  /** 本回合已治疗（§2 heal 谓词） */
  healed: boolean;
  /** u16 累计击杀数 */
  kills: number;
  promoted: boolean;
  /** 母城 id；无母城 = null */
  homeCity: string | null;
}

export interface City {
  id: string;
  x: number;
  y: number;
  /** players[] 下标（中立村庄占领后才成城，design §4.2） */
  owner: number;
  /** ≥ 1（§1 行 45） */
  level: number;
  /** ≥ 0（§1 行 45） */
  population: number;
  hasWorkshop: boolean;
  /** hasWall ⇔ wallDurability ∈ 1..3（§1 行 45） */
  hasWall: boolean;
  /** 0..3（§1 行 42） */
  wallDurability: number;
  isCapital: boolean;
}

export interface Player {
  /** 稳定下标（= 数组位置，currentPlayer 即此下标） */
  idx: number;
  name: string;
  /** 阵营 id（tribes.json） */
  tribe: string;
  /** i32，≥ 0（§1 行 45） */
  stars: number;
  /** 已研究科技 id 列表 */
  techs: string[];
  /** 已遭遇玩家 idx 列表（§1 行 43） */
  met: number[];
  /** u16 连续无城回合（§1 行 43；占城瞬间清零，§4.7 T4 宽限计数） */
  noCityTurns: number;
  /** eliminated ⇒ 无城市（§1 行 45；无城 ≠ 立即淘汰 —— 宽限规则见 §4.7） */
  eliminated: boolean;
}

export interface ActionLogEntry {
  /** 升序且连续无洞（§1 行 26） */
  seq: number;
  /** 提交动作的玩家下标 */
  player: number;
  /** 动作类型 id */
  type: string;
  /** 动作载荷（§2 payload 结构随动作而定） */
  payload: unknown;
}

export interface State {
  /** u16，序列化结构版本（§1 行 30） */
  schemaVersion: number;
  /** semver，规则语义版本（§1 行 31） */
  rulesVersion: string;
  /** 内容包指纹，16 位小写 hex（§1 行 32、§0 行 19） */
  contentHash: string;
  /** u64，世界种子；不参与战斗结算（§1 行 33） */
  seed: bigint;
  /** u64，splitmix64 状态；地图生成后冻结（§1 行 34） */
  rng: bigint;
  map: MapDims;
  /** u32，从 0 起（§1 行 36） */
  turn: number;
  /** u8，players[] 下标（§1 行 37） */
  currentPlayer: number;
  phase: Phase;
  /** 行主序 tiles[y][x]（§1 行 26/39） */
  tiles: Tile[][];
  units: Unit[];
  cities: City[];
  players: Player[];
  actionLog: ActionLogEntry[];
}

/**
 * maxHp(type) 解析器 —— §1 行 45 的 `0 ≤ hp ≤ maxHp(type)` 需要单位类型表。
 * 类型表属 content 层 units.json（design §6 数据五层），仓库尚未入库，故以注入方式提供；
 * 返回 undefined 视为「类型无法校验」并记为违规（不静默跳过）。
 */
export type MaxHpLookup = (type: string) => number | undefined;

/** 静态枚举查表（§1 行 38：phase ∈ prep/act/commit） */
const PHASE_VALID: Record<string, true> = { prep: true, act: true, commit: true };
const U64_MAX = U64_MASK;
const I16_MAX = 0xFFFF;
const U32_MAX = 0xFFFFFFFF;
const I32_MAX = 0x7FFFFFFF;
const U16_MAX = 0xFFFF;
const MAP_MAX = 30; // §1 行 35：≤ 30×30
const CONTENT_HASH_PATTERN = /^[0-9a-f]{16}$/;

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/**
 * §1 不变量检查（行 45，每动作后必须成立，测试断言用）+ 字段域与存储序核对（行 26、30–43）。
 * 不修改 state；返回违规描述列表，空数组 = 全部成立。
 * hp 上限通过可选 maxHpOf 注入（单位类型表尚未入库，见 MaxHpLookup 注释）。
 */
export function checkInvariants(state: State, maxHpOf?: MaxHpLookup): string[] {
  const errors: string[] = [];

  // ── §1 字段域（行 30–38） ──
  if (!isInt(state.schemaVersion) || state.schemaVersion < 0 || state.schemaVersion > I16_MAX) {
    errors.push(`schemaVersion: 期望 u16 整数，得到 ${String(state.schemaVersion)}`);
  }
  if (typeof state.rulesVersion !== 'string' || state.rulesVersion.length === 0) {
    errors.push(`rulesVersion: 期望非空 semver 字符串，得到 ${String(state.rulesVersion)}`);
  }
  if (typeof state.contentHash !== 'string' || !CONTENT_HASH_PATTERN.test(state.contentHash)) {
    errors.push(`contentHash: 期望 16 位小写 hex 字符串，得到 ${String(state.contentHash)}`);
  }
  if (typeof state.seed !== 'bigint' || state.seed < 0n || state.seed > U64_MAX) {
    errors.push(`seed: 期望 u64 bigint，得到 ${String(state.seed)}`);
  }
  if (typeof state.rng !== 'bigint' || state.rng < 0n || state.rng > U64_MAX) {
    errors.push(`rng: 期望 u64 bigint，得到 ${String(state.rng)}`);
  }
  if (
    !isInt(state.map?.width) || state.map.width < 1 || state.map.width > MAP_MAX ||
    !isInt(state.map?.height) || state.map.height < 1 || state.map.height > MAP_MAX
  ) {
    errors.push(`map: 期望 1..${MAP_MAX} 的整数宽高，得到 ${String(state.map?.width)}×${String(state.map?.height)}`);
  }
  if (!isInt(state.turn) || state.turn < 0 || state.turn > U32_MAX) {
    errors.push(`turn: 期望 u32 整数，得到 ${String(state.turn)}`);
  }
  if (!isInt(state.currentPlayer) || state.currentPlayer < 0 || state.currentPlayer >= state.players.length) {
    errors.push(`currentPlayer: 期望 players[] 下标，得到 ${String(state.currentPlayer)}（共 ${state.players.length} 玩家）`);
  }
  if (PHASE_VALID[state.phase] !== true) {
    errors.push(`phase: 期望 prep|act|commit，得到 ${String(state.phase)}`);
  }

  // ── §1 行 26/39：tiles 行主序 (y, x)，尺寸 = height × width ──
  const width = isInt(state.map?.width) ? state.map.width : -1;
  const height = isInt(state.map?.height) ? state.map.height : -1;
  const gridOk = height >= 1 && width >= 1 && Array.isArray(state.tiles) &&
    state.tiles.length === height && state.tiles.every((row) => Array.isArray(row) && row.length === width);
  if (!gridOk) {
    errors.push(
      `tiles: 期望 ${height}×${width} 行主序网格，得到 ${
        Array.isArray(state.tiles) ? `${state.tiles.length}×${state.tiles.map((row) => row?.length).join('/')}` : String(state.tiles)
      }`,
    );
  }

  // ── 玩家（§1 行 43）：idx = 数组位置 ──
  state.players.forEach((player, index) => {
    if (!isInt(player.idx) || player.idx !== index) {
      errors.push(`players[${index}].idx: 期望 ${index}，得到 ${String(player.idx)}`);
    }
  });

  // ── §1 不变量（行 45）：cityId 全局唯一（cities[].id 唯一 + tiles 引用唯一且不悬空） ──
  const cityIds = new Set<string>();
  state.cities.forEach((city, index) => {
    if (cityIds.has(city.id)) {
      errors.push(`cities[${index}].id: cityId 全局唯一被破坏，重复 "${city.id}"（§1 行 45）`);
    }
    cityIds.add(city.id);
  });
  const tileCityOwners = new Map<string, string>();
  if (gridOk) {
    state.tiles.forEach((row, y) => {
      row.forEach((tile, x) => {
        // §1 行 39：village 为 bool 字段（领地是衍生量，~~owner~~ 已删）
        if (typeof tile.village !== 'boolean') {
          errors.push(`tiles[${y}][${x}].village: 期望 bool，得到 ${String(tile.village)}（§1 行 39）`);
        }
        const cityId = tile.cityId;
        if (cityId === null || cityId === undefined) return;
        if (tileCityOwners.has(cityId)) {
          const first = tileCityOwners.get(cityId) as string;
          errors.push(`tiles[${y}][${x}].cityId: 全局唯一被破坏，"${cityId}" 已出现于 ${first}（§1 行 45）`);
        } else {
          tileCityOwners.set(cityId, `tiles[${y}][${x}]`);
        }
        if (!cityIds.has(cityId)) {
          errors.push(`tiles[${y}][${x}].cityId: 悬空引用 "${cityId}"（cities[] 中不存在）`);
        }
      });
    });
  }

  // ── 单位（§1 行 26 存储序 + 行 40 + 行 45 不变量） ──
  const occupied = new Map<number, string>(); // 行主序格号 → 占位单位 id
  state.units.forEach((unit, index) => {
    if (index > 0 && !(state.units[index - 1].id < unit.id)) {
      errors.push(`units: 存储序须按 id 字典序升序（§1 行 26），"${state.units[index - 1].id}" 后接 "${unit.id}"`);
    }
    if (typeof unit.id !== 'string' || unit.id.length === 0) {
      errors.push(`units[${index}].id: 期望非空字符串 id`);
    }
    if (!isInt(unit.owner) || unit.owner < 0 || unit.owner >= state.players.length) {
      errors.push(`units[${index}].owner: 期望玩家下标，得到 ${String(unit.owner)}`);
    }
    if (typeof unit.type !== 'string' || unit.type.length === 0) {
      errors.push(`units[${index}].type: 期望非空兵种 id`);
    }
    const inGrid = gridOk &&
      isInt(unit.x) && isInt(unit.y) && unit.x >= 0 && unit.x < width && unit.y >= 0 && unit.y < height;
    if (!inGrid) {
      errors.push(`units[${index}].x/y: (${String(unit.x)},${String(unit.y)}) 越出 ${width}×${height} 地图`);
    }
    // §1 行 45：每格 ≤ 1 单位
    if (inGrid) {
      const cell = unit.y * width + unit.x;
      const holder = occupied.get(cell);
      if (holder !== undefined) {
        errors.push(`units[${index}]: (${unit.x},${unit.y}) 已有单位 "${holder}"，每格 ≤ 1 单位（§1 行 45）`);
      } else {
        occupied.set(cell, unit.id);
      }
    }
    // §1 行 45：0 ≤ hp ≤ maxHp(type)
    if (!isInt(unit.hp) || unit.hp < 0) {
      errors.push(`units[${index}].hp: 期望 ≥ 0 整数，得到 ${String(unit.hp)}（§1 行 45）`);
    } else if (maxHpOf !== undefined) {
      const maxHp = maxHpOf(unit.type);
      if (maxHp === undefined) {
        errors.push(`units[${index}].type: maxHp("${unit.type}") 无法解析，hp 上限不可校验（§1 行 45）`);
      } else if (unit.hp > maxHp) {
        errors.push(`units[${index}].hp: ${unit.hp} > maxHp(${unit.type})=${maxHp}（§1 行 45）`);
      }
    }
    if (!isInt(unit.kills) || unit.kills < 0 || unit.kills > U16_MAX) {
      errors.push(`units[${index}].kills: 期望 u16 整数，得到 ${String(unit.kills)}（§1 行 40）`);
    }
  });

  // ── 城市（§1 行 26 存储序 + 行 41 + 行 45 不变量） ──
  state.cities.forEach((city, index) => {
    if (index > 0 && !(state.cities[index - 1].id < city.id)) {
      errors.push(`cities: 存储序须按 id 字典序升序（§1 行 26），"${state.cities[index - 1].id}" 后接 "${city.id}"`);
    }
    if (gridOk &&
      !(isInt(city.x) && isInt(city.y) && city.x >= 0 && city.x < width && city.y >= 0 && city.y < height)) {
      errors.push(`cities[${index}].x/y: (${String(city.x)},${String(city.y)}) 越出 ${width}×${height} 地图`);
    }
    if (!isInt(city.owner) || city.owner < 0 || city.owner >= state.players.length) {
      errors.push(`cities[${index}].owner: 期望玩家下标，得到 ${String(city.owner)}`);
    }
    // §1 行 45：level ≥ 1
    if (!isInt(city.level) || city.level < 1) {
      errors.push(`cities[${index}].level: 期望 ≥ 1 整数，得到 ${String(city.level)}（§1 行 45）`);
    }
    // §1 行 45：population ≥ 0
    if (!isInt(city.population) || city.population < 0) {
      errors.push(`cities[${index}].population: 期望 ≥ 0 整数，得到 ${String(city.population)}（§1 行 45）`);
    }
    // §1 行 42：wallDurability 0..3；行 45：hasWall ⇔ wallDurability ∈ 1..3
    if (!isInt(city.wallDurability) || city.wallDurability < 0 || city.wallDurability > 3) {
      errors.push(`cities[${index}].wallDurability: 期望 0..3，得到 ${String(city.wallDurability)}（§1 行 42）`);
    } else if (city.hasWall !== (city.wallDurability >= 1)) {
      errors.push(
        `cities[${index}]: hasWall=${String(city.hasWall)} 与 wallDurability=${city.wallDurability} 不等价（§1 行 45：hasWall ⇔ wallDurability ∈ 1..3）`,
      );
    }
  });

  // ── 玩家（§1 行 43 + 行 45 不变量） ──
  state.players.forEach((player, index) => {
    if (!isInt(player.stars) || player.stars < 0 || player.stars > I32_MAX) {
      errors.push(`players[${index}].stars: 期望 i32 且 ≥ 0，得到 ${String(player.stars)}（§1 行 43/45）`);
    }
    // §1 行 45：eliminated ⇒ 无城市（反向不成立 —— 无城处于 §4.7 宽限期，不算违规）
    const hasCity = state.cities.some((city) => city.owner === player.idx);
    if (player.eliminated && hasCity) {
      errors.push(
        `players[${index}]: eliminated=true 但持有 ${state.cities.filter((city) => city.owner === player.idx).length} 城市（§1 行 45：eliminated ⇒ 无城市）`,
      );
    }
  });

  // ── 动作日志（§1 行 26：seq 升序且连续无洞；行 43 字段域） ──
  state.actionLog.forEach((entry, index) => {
    if (!isInt(entry.seq) || entry.seq < 0) {
      errors.push(`actionLog[${index}].seq: 期望非负整数，得到 ${String(entry.seq)}（§1 行 26）`);
    } else if (index > 0 && entry.seq !== state.actionLog[index - 1].seq + 1) {
      errors.push(
        `actionLog[${index}].seq: 期望 ${String(state.actionLog[index - 1].seq) + 1}（连续无洞），得到 ${entry.seq}（§1 行 26）`,
      );
    }
    if (!isInt(entry.player) || entry.player < 0 || entry.player >= state.players.length) {
      errors.push(`actionLog[${index}].player: 期望玩家下标，得到 ${String(entry.player)}`);
    }
    if (typeof entry.type !== 'string' || entry.type.length === 0) {
      errors.push(`actionLog[${index}].type: 期望非空动作类型 id`);
    }
  });

  return errors;
}
