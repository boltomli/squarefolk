/**
 * 动作管线 / 回合结算边角单测（core-spec §4.7 征服、§4.1-D killSwap 受阻、§4.4 围城收入与
 * D6 耐久制攻城/占领/侵蚀、§2 heal 本土/境外、§2 research 前置），不依赖黄金向量；并入 npm test。
 * 覆盖黄金向量未钉死、但规格已定案的分支；每条附带规格引用。
 * 逐条 PASS/FAIL + 汇总；任一失败进程非零退出。
 */
import { applyAction, type ActionContext, type ApplyResult } from '../src/actions';
import { canonicalJson } from '../src/canonical';
import { checkInvariants, type City, type Player, type State, type Tile, type Unit } from '../src/state';

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

const WARRIOR = { cost: 3, hp: 10, atk10: 20, def10: 20, move: 1, range: 1, counter: [1, 1] } as const;
const CTX: ActionContext = {
  unitTypes: { 'unit.warrior': WARRIOR },
  techs: {},
  resources: {},
  // §4.3 v1 数值表（内容数据，可调值只在 content/balance —— 夹具内联与 data 同构）
  improvementTypes: {
    'improvement.farm': { cost: 5, allowedOn: ['plain', 'swamp'], tech: 'tech.orchard', yield: { kind: 'pop', perTurn: 1 } },
    'improvement.mine': { cost: 5, allowedOn: ['mountain'], tech: 'tech.mining', yield: { kind: 'stars', perTurn: 2 } },
    'improvement.road': { cost: 3, allowedOn: ['plain', 'forest', 'swamp'] },
  },
};

const maxHpOf = (type: string): number | undefined => (type === 'unit.warrior' ? 10 : undefined);

/** §4.4 D6 攻城内容变体：siegeDamage ∈ 单位内容数据（夹具内联，与 data/units.json 同构） */
const CTX_SIEGE: ActionContext = {
  ...CTX,
  unitTypes: { ...CTX.unitTypes, 'unit.warrior': { ...WARRIOR, siegeDamage: 1 } },
};

/** §4.4 攻城拒绝 case：显式 siegeDamage = 0（缺省态由 CTX（无该字段）同分支覆盖） */
const CTX_SIEGE0: ActionContext = {
  ...CTX,
  unitTypes: { ...CTX.unitTypes, 'unit.warrior': { ...WARRIOR, siegeDamage: 0 } },
};

/** move=2 兵种变体（占领门「非相邻起点」用例需可达：budget2 = 4） */
const CTX_MOVE2: ActionContext = {
  ...CTX,
  unitTypes: { ...CTX.unitTypes, 'unit.warrior': { ...WARRIOR, move: 2 } },
};

/**
 * 城市格回填 tiles.cityId（与 turn 向量装配同构）：城格 cost 1（§4.2）与
 * §4.1-B 城/墙加成都读 tile.cityId —— 新增用例统一过此函数。
 */
function stampCityTiles(state: State): State {
  for (const city of state.cities) {
    state.tiles[city.y][city.x].cityId = city.id;
  }
  return state;
}

function tile(terrain = 'plain', extra?: Partial<Tile>): Tile {
  return { terrain, road: false, village: false, ...extra };
}

function grid(w: number, h: number, at?: (x: number, y: number) => Tile): Tile[][] {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y += 1) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x += 1) row.push(at?.(x, y) ?? tile());
    tiles.push(row);
  }
  return tiles;
}

function city(id: string, x: number, y: number, owner: number, extra?: {
  level?: number;
  isCapital?: boolean;
  population?: number;
  hasWorkshop?: boolean;
  hasWall?: boolean;
  wallDurability?: number;
}): City {
  return {
    id,
    x,
    y,
    owner,
    level: extra?.level ?? 1,
    population: extra?.population ?? 0,
    hasWorkshop: extra?.hasWorkshop ?? false,
    hasWall: extra?.hasWall ?? false,
    wallDurability: extra?.wallDurability ?? 0,
    isCapital: extra?.isCapital ?? false,
  };
}

function unit(id: string, owner: number, x: number, y: number, extra?: { hp?: number; homeCity?: string | null }): Unit {
  return {
    id,
    owner,
    type: 'unit.warrior',
    x,
    y,
    hp: extra?.hp ?? 10,
    moved: false,
    attacked: false,
    healed: false,
    kills: 0,
    promoted: false,
    homeCity: extra?.homeCity ?? null,
  };
}

function player(idx: number, extra?: { stars?: number; noCityTurns?: number; eliminated?: boolean }): Player {
  return {
    idx,
    name: idx === 0 ? 'A' : 'B',
    tribe: 'tribe.test',
    stars: extra?.stars ?? 0,
    techs: [],
    met: [],
    noCityTurns: extra?.noCityTurns ?? 0,
    eliminated: extra?.eliminated ?? false,
  };
}

function baseState(spec: {
  w: number;
  h: number;
  tiles?: Tile[][];
  units?: Unit[];
  cities?: City[];
  players?: Player[];
  currentPlayer?: number;
}): State {
  return {
    schemaVersion: 1,
    rulesVersion: '0.1.0',
    contentHash: '0000000000000000',
    seed: 0n,
    rng: 0n,
    map: { width: spec.w, height: spec.h },
    turn: 0,
    currentPlayer: spec.currentPlayer ?? 0,
    phase: 'act',
    tiles: spec.tiles ?? grid(spec.w, spec.h),
    units: spec.units ?? [],
    cities: spec.cities ?? [],
    players: spec.players ?? [player(0)],
    actionLog: [],
  };
}

/** 接受结果：拒绝 = 意外失败；另跑 §1 不变量（maxHp 注入）。返回后继状态供字段断言。 */
function unwrap(result: ApplyResult, mismatches: string[]): State | null {
  if (result.rejected) {
    mismatches.push(`意外拒绝: ${result.reason}`);
    return null;
  }
  const errors = checkInvariants(result.state, maxHpOf);
  if (errors.length > 0) mismatches.push(`不变量违规: ${errors.join('; ')}`);
  return result.state;
}

// ── §4.7 征服：拥有全场全部首都 → 立即胜利（§3.2 检查点在每个动作后执行） ──
{
  const state = baseState({
    w: 2,
    h: 2,
    cities: [city('city.000001', 0, 0, 0, { isCapital: true }), city('city.000002', 1, 1, 0, { isCapital: true })],
    players: [player(0), player(1, { eliminated: true })],
  });
  const result = applyAction(state, { type: 'endTurn' }, CTX);
  const mismatches: string[] = [];
  if (result.rejected) {
    mismatches.push(`意外拒绝: ${result.reason}`);
  } else if (result.winner !== 0) {
    mismatches.push(`winner: expected 0（A 占全部首都）, got ${String(result.winner)}`);
  }
  record('victory: 占全场全部首都 → winner = 该玩家（§4.7）', mismatches);
}

// ── §4.1-D killSwap 受阻：目标格不可通行（水域）→ 攻方留原地（§5「近战补位受阻」） ──
{
  const state = baseState({
    w: 3,
    h: 3,
    tiles: grid(3, 3, (x, y) => (x === 1 && y === 0 ? tile('water') : tile())),
    units: [unit('unit.000001', 0, 0, 0), unit('unit.000002', 1, 1, 0, { hp: 1 })],
    cities: [
      city('city.000001', 2, 2, 0, { isCapital: true }),
      city('city.000002', 0, 2, 1, { isCapital: true }),
    ],
    players: [player(0), player(1)],
  });
  const result = applyAction(
    state,
    { type: 'attack', unitId: 'unit.000001', targetId: 'unit.000002' },
    CTX,
  );
  const mismatches: string[] = [];
  const next = unwrap(result, mismatches);
  if (next !== null) {
    if (next.units.length !== 1) mismatches.push(`units: expected 1, got ${next.units.length}`);
    const attacker = next.units[0];
    if (attacker.x !== 0 || attacker.y !== 0) {
      mismatches.push(`killSwap 受阻应留原地 (0,0), got (${attacker.x},${attacker.y})`);
    }
    if (attacker.kills !== 1) mismatches.push(`kills: expected 1, got ${attacker.kills}`);
    if (!attacker.attacked) mismatches.push('attacked: expected true');
    if (attacker.promoted) mismatches.push('promoted: expected false（kills 1 < promotion.kills 3）');
  }
  record('attack: killSwap 目标格为水域 → 攻方留原地、击杀计数照常（§4.1-D/§5）', mismatches);
}

// ── §4.4 besieged（敌方单位与城市格 8 向相邻）→ 该城收入 0（§3.1 prep / §4.3） ──
{
  const state = baseState({
    w: 3,
    h: 3,
    units: [unit('unit.000001', 1, 1, 0, { homeCity: 'city.000003' })],
    cities: [
      city('city.000001', 0, 0, 0, { level: 2, isCapital: true }), // 被 B 单位 (1,0) 相邻 → 收入 0（否则 2+1 首都 = 3）
      city('city.000002', 2, 2, 0), // 未被围 → +1
      city('city.000003', 0, 2, 1),
    ],
    players: [player(0), player(1)],
    currentPlayer: 1, // B 提交回合 → 回绕 → A 的 prep 收入
  });
  const result = applyAction(state, { type: 'endTurn' }, CTX);
  const mismatches: string[] = [];
  const next = unwrap(result, mismatches);
  if (next !== null) {
    if (next.players[0].stars !== 1) {
      mismatches.push(`A stars: expected 1（仅 c2 入账；c1 被围归零）, got ${next.players[0].stars}`);
    }
    if (next.currentPlayer !== 0) mismatches.push(`currentPlayer: expected 0, got ${next.currentPlayer}`);
    if (next.turn !== 1) mismatches.push(`turn: expected 1（越过末位回绕）, got ${next.turn}`);
    if (next.phase !== 'act') mismatches.push(`phase: expected act, got ${next.phase}`);
  }
  record('prep: 被围城收入 0、未被围照常入账、回绕推进（§4.4/§3.1）', mismatches);
}

// ── §2 heal：本土（territory 归属城内）+ economy.healHome → 上限截断前的 +4，healed=true ──
{
  const state = baseState({
    w: 3,
    h: 3,
    units: [unit('unit.000001', 0, 1, 2, { hp: 5, homeCity: 'city.000001' })],
    cities: [city('city.000001', 1, 1, 0)],
  });
  const result = applyAction(state, { type: 'heal', unitId: 'unit.000001' }, CTX);
  const mismatches: string[] = [];
  const next = unwrap(result, mismatches);
  if (next !== null) {
    const healed = next.units[0];
    if (healed.hp !== 9) mismatches.push(`hp: expected 9（5+4 本土）, got ${healed.hp}`);
    if (!healed.healed) mismatches.push('healed: expected true');
    if (healed.moved || healed.attacked) mismatches.push('heal 不得置 moved/attacked（§2 不破坏防御姿态）');
  }
  record('heal: 本土 +4（balance economy.healHome）→ hp 9、healed=true（§2/§4.3）', mismatches);
}

// ── §2 heal：境外 + economy.healAway（格无归属城） ──
{
  const state = baseState({
    w: 5,
    h: 5,
    units: [unit('unit.000001', 0, 4, 4, { hp: 5 })],
    cities: [city('city.000001', 0, 0, 0)],
  });
  const result = applyAction(state, { type: 'heal', unitId: 'unit.000001' }, CTX);
  const mismatches: string[] = [];
  const next = unwrap(result, mismatches);
  if (next !== null) {
    const healed = next.units[0];
    if (healed.hp !== 7) mismatches.push(`hp: expected 7（5+2 境外）, got ${healed.hp}`);
    if (!healed.healed) mismatches.push('healed: expected true');
  }
  record('heal: 境外 +2（balance economy.healAway）→ hp 7、healed=true（§2）', mismatches);
}

// ── §2 research：前置未满足 → 拒绝且状态零变化（stars 足够 → 拒绝只能来自前置） ──
{
  const state = baseState({
    w: 2,
    h: 2,
    cities: [city('city.000001', 0, 0, 0)],
    players: [player(0, { stars: 10 })],
  });
  const ctx: ActionContext = {
    unitTypes: {},
    techs: { 'tech.t1': { tier: 1, requires: [] }, 'tech.t2': { tier: 2, requires: ['tech.t1'] } },
    resources: {},
    improvementTypes: {},
  };
  const before = canonicalJson(state);
  const result = applyAction(state, { type: 'research', techId: 'tech.t2' }, ctx);
  const mismatches: string[] = [];
  if (result.rejected === false) mismatches.push('期望拒绝（前置 tech.t1 未研究；stars 10 ≥ cost 6）');
  if (canonicalJson(state) !== before) mismatches.push('拒绝路径状态必须零变化（§2）');
  record('research: 前置未满足 → rejected，状态零变化（§2/§4.3）', mismatches);
}

// ── §3.1 commit-2 无城宽限计数（T4，§4.7）：无城提交 +1、未达阈值残兵保留 ──
{
  const state = baseState({
    w: 2,
    h: 2,
    units: [unit('unit.000001', 1, 1, 1)], // B 残兵（无城仍可活动，§4.7 宽限期）
    cities: [city('city.000001', 0, 0, 0, { isCapital: true })],
    players: [player(0, { noCityTurns: 4 }), player(1, { noCityTurns: 2 })],
    currentPlayer: 1, // B 无城提交
  });
  const result = applyAction(state, { type: 'endTurn' }, CTX);
  const mismatches: string[] = [];
  const next = unwrap(result, mismatches);
  if (next !== null) {
    const b = next.players[1];
    if (b.noCityTurns !== 3) mismatches.push(`B noCityTurns: expected 3（2+1）, got ${b.noCityTurns}`);
    if (b.eliminated) mismatches.push('B 不应淘汰（3 < eliminationGraceTurns 5）');
    if (next.units.length !== 1 || next.units[0].owner !== 1) {
      mismatches.push(`残兵应保留: expected [B 的 unit.000001], got ${JSON.stringify(next.units.map((u) => u.id))}`);
    }
  }
  record('commit: 无城提交 noCityTurns 2→3、未达阈值不淘汰、残兵保留（§3.1 commit-2 / §4.7）', mismatches);
}

// ── §3.1 commit-2：有城提交 → noCityTurns 归零 ──
{
  const state = baseState({
    w: 2,
    h: 2,
    cities: [city('city.000001', 0, 0, 0, { isCapital: true })],
    players: [player(0, { noCityTurns: 4 }), player(1)], // A 有城但计数残留 4
  });
  const result = applyAction(state, { type: 'endTurn' }, CTX);
  const mismatches: string[] = [];
  const next = unwrap(result, mismatches);
  if (next !== null) {
    if (next.players[0].noCityTurns !== 0) {
      mismatches.push(`A noCityTurns: expected 0（有城归零）, got ${next.players[0].noCityTurns}`);
    }
    if (next.players[0].eliminated) mismatches.push('A 不应淘汰（持有城市）');
  }
  record('commit: 有城提交 noCityTurns 归零（§3.1 commit-2）', mismatches);
}

// ── §4.7：宽限期内占下任何城 → 计数即时清零（move-capture 瞬间） ──
{
  const state = baseState({
    w: 3,
    h: 3,
    tiles: grid(3, 3, (x, y) => (x === 1 && y === 0 ? tile('plain', { village: true }) : tile())),
    units: [unit('unit.000001', 1, 0, 0)],
    players: [player(0), player(1, { noCityTurns: 3 })],
    currentPlayer: 1, // B 无城、残兵占村
  });
  const result = applyAction(state, { type: 'move', unitId: 'unit.000001', x: 1, y: 0 }, CTX);
  const mismatches: string[] = [];
  const next = unwrap(result, mismatches);
  if (next !== null) {
    if (next.players[1].noCityTurns !== 0) {
      mismatches.push(`B noCityTurns: expected 0（占城清零）, got ${next.players[1].noCityTurns}`);
    }
    if (next.cities.length !== 1 || next.cities[0].owner !== 1) {
      mismatches.push(`应新建 B 的城市: got ${JSON.stringify(next.cities.map((c) => `${c.id}@${c.owner}`))}`);
    }
  }
  record('move: 占村建城瞬间 noCityTurns 清零（§4.7）', mismatches);
}

// ── §3.1 commit-3：currentPlayer 下移并跳过已淘汰玩家（不回绕 → turn 不动） ──
{
  const state = baseState({
    w: 3,
    h: 3,
    cities: [
      city('city.000001', 0, 0, 0, { isCapital: true }),
      city('city.000002', 2, 2, 2, { isCapital: true }), // C（idx2）持城
    ],
    players: [player(0), player(1, { eliminated: true }), player(2)], // B 已淘汰
    currentPlayer: 0, // A 提交 → 应跳过 B 落到 C
  });
  const result = applyAction(state, { type: 'endTurn' }, CTX);
  const mismatches: string[] = [];
  const next = unwrap(result, mismatches);
  if (next !== null) {
    if (next.currentPlayer !== 2) mismatches.push(`currentPlayer: expected 2（跳过已淘汰 B）, got ${next.currentPlayer}`);
    if (next.turn !== 0) mismatches.push(`turn: expected 0（未回绕不加）, got ${next.turn}`);
    if (next.players[2].stars !== 2) {
      mismatches.push(`C stars: expected 2（prep 收入落给 C: level1 + 首都1）, got ${next.players[2].stars}`);
    }
  }
  record('endTurn: 轮转跳过已淘汰玩家（§3.1 commit-3）', mismatches);
}

// ── §4.7 T4 达阈值：eliminated=true 且移除其全部残余单位（提交者被淘汰 → 继续下移） ──
{
  const state = baseState({
    w: 3,
    h: 3,
    units: [
      unit('unit.000001', 1, 2, 1),
      unit('unit.000002', 1, 2, 2),
      unit('unit.000003', 0, 0, 1), // A 残兵应保留
    ],
    cities: [city('city.000001', 0, 0, 0, { isCapital: true })],
    players: [player(0), player(1, { noCityTurns: 4 })],
    currentPlayer: 1, // B 无城提交 → 4+1 = 5 ≥ eliminationGraceTurns
  });
  const result = applyAction(state, { type: 'endTurn' }, CTX);
  const mismatches: string[] = [];
  const next = unwrap(result, mismatches);
  if (next !== null) {
    const b = next.players[1];
    if (b.noCityTurns !== 5) mismatches.push(`B noCityTurns: expected 5, got ${b.noCityTurns}`);
    if (!b.eliminated) mismatches.push('B 应淘汰（5 ≥ eliminationGraceTurns 5）');
    if (next.units.length !== 1 || next.units[0].id !== 'unit.000003') {
      mismatches.push(`B 的残兵应全部移除: got ${JSON.stringify(next.units.map((u) => u.id))}`);
    }
    if (next.currentPlayer !== 0) mismatches.push(`currentPlayer: expected 0（跳过被淘汰的 B + 回绕）, got ${next.currentPlayer}`);
    if (next.turn !== 1) mismatches.push(`turn: expected 1（回绕）, got ${next.turn}`);
  }
  record('commit: 达阈值 → eliminated + 移除全部残余单位（§4.7 T4 / §3.1 commit-3）', mismatches);
}

// ── §4.3 拒绝理由措辞（vector 钉死，实现照抄）：六条清单 + !attacked 各一；拒绝 → 输入零变化 ──
{
  type BuildCase = { label: string; kind: string; reason: string; mutate: (state: State) => void };
  const cases: BuildCase[] = [
    {
      label: '地形不符 allowedOn',
      kind: 'improvement.mine',
      reason: 'build: 地形 plain 不符合 improvement.mine.allowedOn（§2）',
      mutate: () => {
        /* unit 站 plain，mine 只可建于 mountain（其余全绿） */
      },
    },
    {
      label: '无主地不可修（非 road）',
      kind: 'improvement.farm',
      reason: 'build: 目标格不在己方领土（§2 / §4.3）',
      mutate: (state) => {
        state.cities = [];
      },
    },
    {
      label: '道路例外：敌方领土不可修',
      kind: 'improvement.road',
      reason: 'build: 目标格不在己方领土（§2 / §4.3）',
      mutate: (state) => {
        state.cities[0].owner = 1;
        state.players.push(player(1));
      },
    },
    {
      label: '本格已有改善',
      kind: 'improvement.farm',
      reason: 'build: 本格已有改善（§2）',
      mutate: (state) => {
        state.tiles[1][1].improved = 'improvement.farm';
      },
    },
    {
      label: '已有道路（重复修）',
      kind: 'improvement.road',
      reason: 'build: 已有道路（§2）',
      mutate: (state) => {
        state.tiles[1][1].road = true;
      },
    },
    {
      label: '星星不足',
      kind: 'improvement.farm',
      reason: 'build: 星星不足（2 < 5）（§2）',
      mutate: (state) => {
        state.players[0].stars = 2;
      },
    },
    {
      label: '科技未解锁',
      kind: 'improvement.farm',
      reason: 'build: 科技 tech.orchard 未解锁（§2）',
      mutate: (state) => {
        state.players[0].techs = [];
      },
    },
    {
      label: '!attacked（攻击过不可建）',
      kind: 'improvement.farm',
      reason: 'build: !attacked 不满足（§4.3）',
      mutate: (state) => {
        state.units[0].attacked = true;
      },
    },
  ];
  for (const testCase of cases) {
    const state = baseState({
      w: 3,
      h: 3,
      units: [unit('unit.000001', 0, 1, 1)],
      cities: [city('city.000001', 0, 0, 0)],
      players: [player(0, { stars: 5 })],
    });
    state.players[0].techs.push('tech.orchard', 'tech.mining'); // 默认全绿 → 只留被测变量
    testCase.mutate(state);
    const before = canonicalJson(state);
    const result = applyAction(state, { type: 'build', unitId: 'unit.000001', kind: testCase.kind }, CTX);
    const mismatches: string[] = [];
    if (!result.rejected) {
      mismatches.push('期望拒绝');
    } else if (result.reason !== testCase.reason) {
      mismatches.push(`reason: expected ${JSON.stringify(testCase.reason)}, got ${JSON.stringify(result.reason)}`);
    }
    if (canonicalJson(state) !== before) mismatches.push('拒绝路径状态必须零变化（§2）');
    record(`build 拒绝 ${testCase.label}`, mismatches);
  }
}

// ── §4.3 build 成功（road）：中立地豁免 territory → 写 tiles.road 不写 improved、扣 3★、旗标不动 ──
{
  const state = baseState({
    w: 3,
    h: 3,
    units: [unit('unit.000001', 0, 1, 1)],
    cities: [], // 中立地（无城 → 领地豁免；T4 新不变量下合法）
    players: [player(0, { stars: 3 })],
  });
  state.units[0].moved = true; // 无 !moved 限制（走到格上当回合可建）
  const result = applyAction(state, { type: 'build', unitId: 'unit.000001', kind: 'improvement.road' }, CTX);
  const mismatches: string[] = [];
  const next = unwrap(result, mismatches);
  if (next !== null) {
    const target = next.tiles[1][1];
    if (target.road !== true) mismatches.push('tiles.road: expected true');
    if (target.improved !== null && target.improved !== undefined) {
      mismatches.push(`road 不得写 improved, got ${String(target.improved)}`);
    }
    if (next.players[0].stars !== 0) mismatches.push(`stars: expected 0（3 - 3）, got ${next.players[0].stars}`);
    const builder = next.units[0];
    if (!builder.moved) mismatches.push('旗标不因 build 改变（moved 保持 true）');
    if (builder.attacked) mismatches.push('旗标不因 build 改变（attacked 保持 false）');
  }
  record('build road: 中立地可修 → 只写 tiles.road、3★→0、旗标不动（§4.3）', mismatches);
}

// ── §3.1 prep 第 2 步（§4.3 产出结算）：城收入 → 农场人口 → 矿星星；无主格产出无人受益 ──
{
  const state = baseState({
    w: 3,
    h: 3,
    tiles: grid(3, 3, (x, y) => {
      if (x === 0 && y === 1) return tile('plain', { improved: 'improvement.farm' }); // 首都半径 1 内 → 人口
      if (x === 1 && y === 1) return tile('mountain', { improved: 'improvement.mine' }); // 半径内 → 星星
      if (x === 2 && y === 2) return tile('plain', { improved: 'improvement.farm' }); // 半径外无主 → 无人受益
      if (x === 2 && y === 0) return tile('mountain', { improved: 'improvement.mine' }); // 半径外无主 → 无人受益
      return tile();
    }),
    cities: [city('city.000001', 0, 0, 0, { isCapital: true })],
    players: [player(0)],
    currentPlayer: 0,
  });
  const result = applyAction(state, { type: 'endTurn' }, CTX);
  const mismatches: string[] = [];
  const next = unwrap(result, mismatches);
  if (next !== null) {
    // 收入 2（level1 + 首都1）→ 农场人口 +1 → 矿 +2：stars = 0+2+2 = 4；无主农场/矿各排除
    if (next.players[0].stars !== 4) {
      mismatches.push(`A stars: expected 4（城收入2 + 领地矿2，无主矿排除）, got ${next.players[0].stars}`);
    }
    if (next.cities[0].population !== 1) {
      mismatches.push(`population: expected 1（领地内农场 +1，无主农场排除）, got ${next.cities[0].population}`);
    }
    if (next.turn !== 1) mismatches.push(`turn: expected 1（单人回绕）, got ${next.turn}`);
    if (next.currentPlayer !== 0) mismatches.push(`currentPlayer: expected 0, got ${next.currentPlayer}`);
    if (next.phase !== 'act') mismatches.push(`phase: expected act, got ${next.phase}`);
  }
  record('prep: 改善产出结算（城收入→农场人口→矿星星）+ 无主格排除（§3.1/§4.3）', mismatches);
}

// ── §4.3 产出随领地易主：改善随地走 —— 归属城改属 B → 产出落 B，A 无城不受益 ──
{
  const state = baseState({
    w: 3,
    h: 3,
    tiles: grid(3, 3, (x, y) => {
      if (x === 0 && y === 1) return tile('plain', { improved: 'improvement.farm' });
      if (x === 1 && y === 1) return tile('mountain', { improved: 'improvement.mine' });
      return tile();
    }),
    cities: [city('city.000001', 0, 0, 1)], // 非首都（无首都 → 不触发 §4.7 征服）；城已易主给 B
    players: [player(0), player(1)],
    currentPlayer: 0, // A 提交 endTurn → 轮转到 B 的 prep 结算
  });
  const result = applyAction(state, { type: 'endTurn' }, CTX);
  const mismatches: string[] = [];
  const next = unwrap(result, mismatches);
  if (next !== null) {
    if (next.players[1].stars !== 3) {
      mismatches.push(`B stars: expected 3（城收入1 + 领地矿2）, got ${next.players[1].stars}`);
    }
    if (next.players[0].stars !== 0) {
      mismatches.push(`A stars: expected 0（领地已易主 → 产出不归 A）, got ${next.players[0].stars}`);
    }
    if (next.cities[0].population !== 1) {
      mismatches.push(`population: expected 1（农场产出随领地落 B 的城）, got ${next.cities[0].population}`);
    }
    if (next.currentPlayer !== 1) mismatches.push(`currentPlayer: expected 1, got ${next.currentPlayer}`);
  }
  record('prep: 领地易主 → 农场/矿产出随之转移（改善随地走，§4.3）', mismatches);
}

// ══ §4.4 D6 耐久制（Phase 11-D）：攻城两路拒绝逐字 / 墙破翻转 / 占领门与落地 / 被动侵蚀 / killSwap 撞门 ══

/** 拒绝用例通用断言（多用例锁步）：拒绝成立 + reason 逐字 + 输入零变化（§2 / §6 行 483） */
function assertReject(result: ApplyResult, state: State, before: string, reason: string, mismatches: string[]): void {
  if (!result.rejected) {
    mismatches.push(`期望拒绝（${reason}）`);
    return;
  }
  if (result.reason !== reason) {
    mismatches.push(`reason: expected ${JSON.stringify(reason)}, got ${JSON.stringify(result.reason)}`);
  }
  if (canonicalJson(state) !== before) mismatches.push('拒绝路径状态必须零变化（§2）');
}

// ── §4.4 主动攻城拒绝①：敌城无墙 → 「无墙可攻」逐字 + 零变化（隔离变量 = 仅墙） ──
{
  const state = stampCityTiles(baseState({
    w: 3,
    h: 3,
    units: [unit('unit.000001', 0, 0, 1)],
    cities: [
      city('city.000001', 0, 0, 0, { isCapital: true }),
      city('city.000002', 1, 1, 1, { isCapital: true }), // 敌城空、相邻、可见、城主敌对 —— 但无墙
    ],
    players: [player(0), player(1)],
  }));
  const before = canonicalJson(state);
  const result = applyAction(state, { type: 'attack', unitId: 'unit.000001', targetId: 'city.000002' }, CTX_SIEGE);
  const mismatches: string[] = [];
  assertReject(result, state, before, 'attack: 无墙可攻（wallDurability=0）（§4.4）', mismatches);
  record('attack 攻城: 无墙敌城 → 「无墙可攻」逐字拒绝 + 零变化（§4.4）', mismatches);
}

// ── §4.4 主动攻城拒绝②：siegeDamage 显式 0 与字段缺省 → 「无攻城能力」逐字 + 零变化 ──
for (const [label, ctx] of [
  ['显式 siegeDamage=0', CTX_SIEGE0],
  ['字段缺省（?? 0 同分支）', CTX],
] as const) {
  const state = stampCityTiles(baseState({
    w: 3,
    h: 3,
    units: [unit('unit.000001', 0, 0, 1)],
    cities: [
      city('city.000001', 0, 0, 0, { isCapital: true }),
      city('city.000002', 1, 1, 1, { isCapital: true, hasWall: true, wallDurability: 3 }), // 唯一变量 = 攻城能力
    ],
    players: [player(0), player(1)],
  }));
  const before = canonicalJson(state);
  const result = applyAction(state, { type: 'attack', unitId: 'unit.000001', targetId: 'city.000002' }, ctx);
  const mismatches: string[] = [];
  assertReject(result, state, before, 'attack: unit.warrior 无攻城能力（siegeDamage=0）（§4.4）', mismatches);
  record(`attack 攻城: ${label} → 「无攻城能力」逐字拒绝 + 零变化（§4.4）`, mismatches);
}

// ── §4.4 削耐久触 0 → 墙破翻转（hasWall ⇔ dur ∈ 1..3 不变量）+ 非战斗结算 ──
{
  const state = stampCityTiles(baseState({
    w: 3,
    h: 3,
    units: [unit('unit.000001', 0, 0, 1)],
    cities: [
      city('city.000001', 0, 0, 0, { isCapital: true }),
      city('city.000002', 1, 1, 1, { isCapital: true, hasWall: true, wallDurability: 1 }),
    ],
    players: [player(0), player(1)],
  }));
  const result = applyAction(state, { type: 'attack', unitId: 'unit.000001', targetId: 'city.000002' }, CTX_SIEGE);
  const mismatches: string[] = [];
  const next = unwrap(result, mismatches);
  if (next !== null) {
    const wall = next.cities.find((entry) => entry.id === 'city.000002');
    if (wall === undefined) {
      mismatches.push('city.000002 缺失');
    } else if (wall.hasWall !== false || wall.wallDurability !== 0) {
      mismatches.push(`墙破翻转: expected hasWall=false/dur=0, got hasWall=${wall.hasWall}/dur=${wall.wallDurability}（§1 不变量）`);
    }
    const attacker = next.units[0];
    if (!attacker.attacked) mismatches.push('attacked: expected true（§2 后效）');
    if (attacker.moved) mismatches.push('moved: expected false（攻城不移动）');
    if (attacker.x !== 0 || attacker.y !== 1) mismatches.push(`非战斗结算应留原地 (0,1), got (${attacker.x},${attacker.y})`);
    if (attacker.hp !== 10) mismatches.push(`非战斗结算 hp 不动: expected 10, got ${attacker.hp}`);
    if (!result.rejected && result.winner !== null) mismatches.push(`winner: expected null（A/B 各持首都）, got ${String(result.winner)}`);
  }
  record('attack 攻城: dur1 − siege1 触 0 → 墙破翻转、attacked=true、非战斗结算（§4.4/§1）', mismatches);
}

// ── §4.4 削后 dur > 0 → 不翻墙（hasWall 保持 true，§1 不变量方向反证） ──
{
  const state = stampCityTiles(baseState({
    w: 3,
    h: 3,
    units: [unit('unit.000001', 0, 0, 1)],
    cities: [
      city('city.000001', 0, 0, 0, { isCapital: true }),
      city('city.000002', 1, 1, 1, { isCapital: true, hasWall: true, wallDurability: 3 }),
    ],
    players: [player(0), player(1)],
  }));
  const result = applyAction(state, { type: 'attack', unitId: 'unit.000001', targetId: 'city.000002' }, CTX_SIEGE);
  const mismatches: string[] = [];
  const next = unwrap(result, mismatches);
  if (next !== null) {
    const wall = next.cities.find((entry) => entry.id === 'city.000002');
    if (wall === undefined) {
      mismatches.push('city.000002 缺失');
    } else if (!wall.hasWall || wall.wallDurability !== 2) {
      mismatches.push(`削后未触 0: expected hasWall=true/dur=2, got hasWall=${wall.hasWall}/dur=${wall.wallDurability}`);
    }
    if (!result.rejected && result.winner !== null) mismatches.push(`winner: expected null, got ${String(result.winner)}`);
  }
  record('attack 攻城: dur3 − siege1 = 2 > 0 → 保持 hasWall=true（§1 不变量）', mismatches);
}

// ── §4.4 占领门条件 1：墙未破（相邻/城空/可达全绿）→ 逐字拒绝 + 零变化 ──
{
  const state = stampCityTiles(baseState({
    w: 3,
    h: 3,
    units: [unit('unit.000001', 0, 0, 1)],
    cities: [
      city('city.000001', 0, 0, 0, { isCapital: true }),
      city('city.000002', 1, 1, 1, { isCapital: true, hasWall: true, wallDurability: 3 }),
    ],
    players: [player(0), player(1)],
  }));
  const before = canonicalJson(state);
  const result = applyAction(state, { type: 'move', unitId: 'unit.000001', x: 1, y: 1 }, CTX);
  const mismatches: string[] = [];
  assertReject(result, state, before, 'move: 敌城未破或需从相邻格进入（§4.4）', mismatches);
  record('move 占领门条件1: 墙未破（相邻+城空+可达全绿）→ 逐字拒绝 + 零变化（§4.4）', mismatches);
}

// ── §4.4 占领门条件 2：无墙但起点非相邻（可达全绿）→ 同一逐字理由 + 零变化 ──
{
  const state = stampCityTiles(baseState({
    w: 3,
    h: 3,
    units: [unit('unit.000001', 0, 0, 0)],
    cities: [
      city('city.000001', 0, 0, 0, { isCapital: true }),
      city('city.000002', 0, 2, 1, { isCapital: true }), // 无墙、城空、move2 可达 —— 但切比雪夫 2
    ],
    players: [player(0), player(1)],
  }));
  const before = canonicalJson(state);
  const result = applyAction(state, { type: 'move', unitId: 'unit.000001', x: 0, y: 2 }, CTX_MOVE2);
  const mismatches: string[] = [];
  assertReject(result, state, before, 'move: 敌城未破或需从相邻格进入（§4.4）', mismatches);
  record('move 占领门条件2: 无墙但起点非相邻（切比雪夫 2，可达全绿）→ 同一逐字拒绝 + 零变化（§4.4）', mismatches);
}

// ── §4.4 占领落地逐字段：owner 易主 / level 保留 / pop−1 与下限 0 / isCapital·workshop 保留 /
//    墙清除 / §4.7 noCityTurns 清零 / 胜利检查（B 仍持首都 → null） ──
{
  const state = stampCityTiles(baseState({
    w: 3,
    h: 3,
    units: [
      unit('unit.000001', 0, 0, 1, { homeCity: null }),
      unit('unit.000002', 0, 0, 2, { homeCity: null }),
    ],
    cities: [
      city('city.000001', 1, 1, 1, { level: 2, population: 3, hasWorkshop: true, isCapital: true }),
      city('city.000002', 1, 2, 1, { population: 0 }), // pop 下限用例
      city('city.000003', 2, 0, 1, { isCapital: true }), // B 保留的首都 → 无征服
    ],
    players: [player(0, { noCityTurns: 5, stars: 5 }), player(1, { stars: 5 })],
    currentPlayer: 0,
  }));
  const mismatches: string[] = [];
  const first = applyAction(state, { type: 'move', unitId: 'unit.000001', x: 1, y: 1 }, CTX);
  const afterFirst = unwrap(first, mismatches);
  if (afterFirst !== null) {
    const captured = afterFirst.cities[0]; // cities 按 id 存储序 → city.000001
    if (captured.owner !== 0) mismatches.push(`owner: expected 0（A）, got ${captured.owner}`);
    if (captured.level !== 2) mismatches.push(`level 保留: expected 2, got ${captured.level}`);
    if (captured.population !== 2) mismatches.push(`population: expected 2（3 − 1）, got ${captured.population}`);
    if (!captured.hasWorkshop) mismatches.push('hasWorkshop 保留: expected true');
    if (!captured.isCapital) mismatches.push('isCapital 保留: expected true');
    if (captured.hasWall || captured.wallDurability !== 0) {
      mismatches.push(`墙清除: expected hasWall=false/dur=0, got ${captured.hasWall}/${captured.wallDurability}`);
    }
    if (afterFirst.players[0].noCityTurns !== 0) {
      mismatches.push(`A noCityTurns: expected 0（占城瞬间清零，§4.7）, got ${afterFirst.players[0].noCityTurns}`);
    }
    const mover = afterFirst.units[0];
    if (mover.x !== 1 || mover.y !== 1 || !mover.moved) {
      mismatches.push(`mover: expected (1,1)/moved=true, got (${mover.x},${mover.y})/moved=${mover.moved}`);
    }
    if (!first.rejected && first.winner !== null) mismatches.push(`winner: expected null（B 仍持首都 c3）, got ${String(first.winner)}`);

    const second = applyAction(afterFirst, { type: 'move', unitId: 'unit.000002', x: 1, y: 2 }, CTX);
    const afterSecond = unwrap(second, mismatches);
    if (afterSecond !== null) {
      const floorCity = afterSecond.cities[1]; // city.000002：pop 0 → max(0, −1) = 0
      if (floorCity.owner !== 0) mismatches.push(`c2 owner: expected 0, got ${floorCity.owner}`);
      if (floorCity.population !== 0) mismatches.push(`population 下限: expected 0, got ${floorCity.population}`);
      if (floorCity.level !== 1 || floorCity.isCapital) {
        mismatches.push(`c2 level/isCapital 保留: expected level=1/isCapital=false, got level=${floorCity.level}/isCapital=${floorCity.isCapital}`);
      }
      const keeper = afterSecond.cities[2]; // city.000003：B 首都未动
      if (keeper.owner !== 1 || !keeper.isCapital) mismatches.push('city.000003 应仍属 B 且 isCapital（未被动）');
      if (afterSecond.players[0].noCityTurns !== 0) mismatches.push('A noCityTurns 保持 0');
      const secondMover = afterSecond.units[1];
      if (secondMover.x !== 1 || secondMover.y !== 2 || !secondMover.moved) {
        mismatches.push(`secondMover: expected (1,2)/moved=true, got (${secondMover.x},${secondMover.y})/moved=${secondMover.moved}`);
      }
      if (!second.rejected && second.winner !== null) mismatches.push(`winner: expected null, got ${String(second.winner)}`);
    }
  }
  record('move 占领落地: owner/level/pop−1 与下限0/isCapital·workshop 保留/墙清除/noCityTurns 清零（§4.4/§4.7）', mismatches);
}

// ── §3.1 commit-1 被动侵蚀：相邻敌 ≥2 触 0 → 墙破；仅 1 敌不减；无墙跳过（被围方 B 提交时结算） ──
{
  const state = stampCityTiles(baseState({
    w: 3,
    h: 3,
    units: [
      unit('unit.000001', 0, 0, 1),
      unit('unit.000002', 0, 2, 2),
      unit('unit.000003', 0, 1, 0),
    ],
    cities: [
      city('city.000001', 0, 0, 0, { isCapital: true }), // 无墙 → 跳过
      city('city.000002', 1, 1, 1, { isCapital: true, hasWall: true, wallDurability: 1 }), // 3 敌 → 触 0 墙破
      city('city.000003', 2, 0, 1, { hasWall: true, wallDurability: 3 }), // 仅 u3 相邻 = 1 敌 → 不减
    ],
    players: [player(0), player(1)],
    currentPlayer: 1, // B 提交 → commit-1 对其被围城结算
  }));
  const result = applyAction(state, { type: 'endTurn' }, CTX);
  const mismatches: string[] = [];
  const next = unwrap(result, mismatches);
  if (next !== null) {
    const broken = next.cities[1];
    if (broken.hasWall !== false || broken.wallDurability !== 0) {
      mismatches.push(`c2 触 0 墙破: expected hasWall=false/dur=0, got ${broken.hasWall}/${broken.wallDurability}`);
    }
    const held = next.cities[2];
    if (!held.hasWall || held.wallDurability !== 3) {
      mismatches.push(`c3 仅 1 相邻敌不侵蚀: expected hasWall=true/dur=3, got ${held.hasWall}/${held.wallDurability}`);
    }
    if (next.currentPlayer !== 0) mismatches.push(`currentPlayer: expected 0, got ${next.currentPlayer}`);
    if (next.turn !== 1) mismatches.push(`turn: expected 1（回绕）, got ${next.turn}`);
  }
  record('commit-1 被动侵蚀: 相邻敌 ≥2 触 0 → 墙破；仅 1 敌不减、无墙跳过（§3.1/§4.4）', mismatches);
}

// ── §4.1-5 killSwap 敌城语义：城上守军被杀但墙未破 → 补位受阻留原地、城与墙不动 ──
{
  const state = stampCityTiles(baseState({
    w: 3,
    h: 3,
    units: [
      unit('unit.000001', 0, 0, 1),
      unit('unit.000002', 1, 1, 1, { hp: 1 }), // 守军站在未破墙的城上
    ],
    cities: [
      city('city.000001', 0, 0, 0, { isCapital: true }),
      city('city.000002', 1, 1, 1, { isCapital: true, hasWall: true, wallDurability: 3 }),
    ],
    players: [player(0), player(1)],
  }));
  const result = applyAction(state, { type: 'attack', unitId: 'unit.000001', targetId: 'unit.000002' }, CTX);
  const mismatches: string[] = [];
  const next = unwrap(result, mismatches);
  if (next !== null) {
    if (next.units.length !== 1) mismatches.push(`units: expected 1（守军阵亡）, got ${next.units.length}`);
    const attacker = next.units[0];
    if (attacker.x !== 0 || attacker.y !== 1) {
      mismatches.push(`补位受阻应留原地 (0,1), got (${attacker.x},${attacker.y})`);
    }
    if (attacker.kills !== 1) mismatches.push(`kills: expected 1, got ${attacker.kills}`);
    if (!attacker.attacked) mismatches.push('attacked: expected true');
    if (attacker.promoted) mismatches.push('promoted: expected false（kills 1 < promotion.kills 3）');
    const targetCity = next.cities[1];
    if (targetCity.owner !== 1 || !targetCity.hasWall || targetCity.wallDurability !== 3) {
      mismatches.push(`城与墙应不动: expected owner=1/hasWall=true/dur=3, got owner=${targetCity.owner}/${targetCity.hasWall}/${targetCity.wallDurability}`);
    }
    if (!result.rejected && result.winner !== null) mismatches.push(`winner: expected null, got ${String(result.winner)}`);
  }
  record('killSwap 撞墙门: 城上守军被杀但墙未破 → 补位受阻留原地（§4.1-5/§4.4）', mismatches);
}

// ── killSwap 补位过门进墙已破敌城 = 即占领（§4.4 裁决 2026-10-06：进入即占领，与 move 同一落地）──
{
  const state = stampCityTiles(baseState({
    w: 3,
    h: 3,
    units: [
      unit('unit.000001', 0, 0, 1), // A 攻方（owner0, x0, y1），与城 (1,1) 相邻
      { ...unit('unit.000002', 1, 1, 1), hp: 1 }, // B 守军（owner1, x1, y1）hp1 站无墙城 → 被杀即补位
    ],
    cities: [
      city('city.000001', 0, 0, 0, { isCapital: true }),
      city('city.000002', 1, 1, 1, { isCapital: false, level: 2, population: 3, hasWorkshop: true }),
      city('city.000003', 2, 2, 1, { isCapital: true }), // B 首都留守 → 无征服
    ],
    players: [player(0), player(1)],
    currentPlayer: 0,
  }));
  const mismatches: string[] = [];
  // 伤害手推：def10 = 20 + 姿态10（城被围失效、无墙）= 30 → M=64；E=10+1=11 →
  // 20×3×11×64/20000 = 4.34 → rhu 4 ≥ hp1 → 守军死（若数值漂移致不死，下面两处断言会红）
  const combat = applyAction(state, { type: 'attack', unitId: 'unit.000001', targetId: 'unit.000002' }, CTX);
  const winner = combat.rejected ? undefined : combat.winner;
  const next = unwrap(combat, mismatches);
  if (next !== null) {
    const attacker = next.units.find((entry) => entry.id === 'unit.000001');
    if (attacker === undefined) {
      mismatches.push('攻方应在场');
    } else {
      if (attacker.x !== 1 || attacker.y !== 1) {
        mismatches.push(`补位: expected (1,1), got (${attacker.x},${attacker.y}) —— 门通过应补位`);
      }
      if (attacker.kills !== 1) mismatches.push(`kills: expected 1, got ${attacker.kills}`);
    }
    const captured = next.cities.find((entry) => entry.id === 'city.000002');
    if (captured === undefined) {
      mismatches.push('城 city.000002 应在场');
    } else {
      if (captured.owner !== 0) mismatches.push(`占领 owner: expected 0（补位进入即占领）, got ${captured.owner}`);
      if (captured.level !== 2) mismatches.push(`level 保留: expected 2, got ${captured.level}`);
      if (captured.population !== 2) mismatches.push(`pop−1: expected 2（3−1）, got ${captured.population}`);
      if (!captured.hasWorkshop) mismatches.push('workshop 应保留');
      if (captured.isCapital) mismatches.push('isCapital 不变（应保持 false）');
    }
    if (attacker !== undefined && attacker.homeCity !== 'city.000002') {
      mismatches.push(`攻占入籍: expected homeCity=city.000002（城籍=出生城+攻占事件）, got ${String(attacker.homeCity)}`);
    }
    if (winner !== null && winner !== undefined) {
      mismatches.push(`winner: expected null（B 仍持首都 c3）, got ${winner} —— 占领非首都城不应触发征服`);
    }
  }
  record('killSwap 补位占领: 过门进墙已破敌城 → 补位 + 即占领 owner/level/pop/workshop（§4.4 裁决）', mismatches);
}

// ── 城防回归（V9/V10 配对语义，经 D6 侵蚀破墙路径）：被围 → 城 +10 失效；墙 +20 仅当 hasWall ──
// 伤害手推（§4.1 公式）：def10 = 20 本体 + 姿态 10 = 30（城被围失效、墙已破失效）→ M(30) = 64；
// 20×3×20×64/20000 = 4.34 → rhu 4 → 守军 10 → 6；若城或墙加成误留 → def 40/50 → hp 7/8 可判别。
{
  const state = stampCityTiles(baseState({
    w: 3,
    h: 3,
    units: [
      unit('unit.000001', 0, 0, 1),
      unit('unit.000002', 0, 2, 2),
      unit('unit.000003', 1, 1, 1), // B 守军站在 dur1 城上
    ],
    cities: [
      city('city.000001', 0, 0, 0, { isCapital: true }),
      city('city.000002', 1, 1, 1, { isCapital: true, hasWall: true, wallDurability: 1 }),
    ],
    players: [player(0), player(1)],
    currentPlayer: 1,
  }));
  const mismatches: string[] = [];
  // 步骤 1：B 提交 → commit-1 两敌相邻 → dur1 触 0 → 墙破（守军仍在）
  const eroded = applyAction(state, { type: 'endTurn' }, CTX);
  const afterErosion = unwrap(eroded, mismatches);
  if (afterErosion !== null) {
    const walled = afterErosion.cities[1];
    if (walled.hasWall !== false || walled.wallDurability !== 0) {
      mismatches.push(`步骤1 墙破: expected false/0, got ${walled.hasWall}/${walled.wallDurability}`);
    }
    // 步骤 2：A 的 u2 攻击城上守军 → 城防加成（被围）与墙防加成（hasWall=false）均失效
    const combat = applyAction(afterErosion, { type: 'attack', unitId: 'unit.000002', targetId: 'unit.000003' }, CTX);
    const next = unwrap(combat, mismatches);
    if (next !== null) {
      const defender = next.units.find((entry) => entry.id === 'unit.000003');
      if (defender === undefined) {
        mismatches.push('守军应存活（伤害 4 < hp 10）');
      } else if (defender.hp !== 6) {
        mismatches.push(`守军 hp: expected 6（10 − 4；城/墙加成均失效）, got ${defender.hp}`);
      }
      const attacker = next.units.find((entry) => entry.id === 'unit.000002');
      if (attacker === undefined) {
        mismatches.push('攻方 unit.000002 缺失');
      } else {
        if (!attacker.attacked) mismatches.push('攻方 attacked: expected true');
        if (attacker.hp !== 5) mismatches.push(`攻方 hp: expected 5（10 − 反击 5），got ${attacker.hp}`);
      }
      if (!combat.rejected && combat.winner !== null) mismatches.push(`winner: expected null, got ${String(combat.winner)}`);
    }
  }
  record('城防回归: 侵蚀墙破后攻城上守军 → 被围城防失效 + 墙防仅当 hasWall（V9/V10 配对）', mismatches);
}

console.log(`${pass}/${pass + fail} PASS`);
if (fail > 0) {
  process.exitCode = 1;
}
