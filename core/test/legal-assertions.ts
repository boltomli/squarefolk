/**
 * legal 域边角单测（core-spec §8.1 可靠性 / 排序、§8.2 bot 分层），不依赖黄金向量；并入 npm test。
 * 覆盖向量未钉死、但规格已定案的性质：
 * ① soundness —— 既有夹具局面 legalActions 逐条 applyAction 必 rejected=false（§8.1 可靠性）
 * ② L0 同 seed 两次同动作（§8.2 确定性）
 * ③ L1 层偏好 —— attack 可用局面必落 attack 层；仅 move/endTurn 局面必选 move 而非 endTurn
 * ④ 排序自检 —— typeRank 按 §2 表序单调、同 type 载荷元组字典序单调
 * ⑤ phase≠act → 空列表；act → 至少含 endTurn（§8.1 末行）
 * 逐条 PASS/FAIL + 汇总；任一失败进程非零退出。
 */
import { applyAction, legalActions, type Action, type ActionContext } from '../src/actions';
import { botAction } from '../src/bot';
import { canonicalJson } from '../src/canonical';
import type { City, Player, State, Tile, Unit } from '../src/state';

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

const CTX: ActionContext = {
  unitTypes: {
    'unit.warrior': { cost: 5, hp: 10, atk10: 20, def10: 20, move: 2, range: 1, counter: [1, 1] },
  },
  techs: { 'tech.hunt': { tier: 1, requires: [] } },
  resources: { fruit: { effect: 'stars', amount: 2 } },
  improvementTypes: { 'improvement.road': { cost: 3, allowedOn: ['plain'] } },
};

// ── 夹具装配（与 turn-assertions 同构的最小构件） ──

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
}): City {
  return {
    id,
    x,
    y,
    owner,
    level: extra?.level ?? 1,
    population: extra?.population ?? 0,
    hasWorkshop: false,
    hasWall: false,
    wallDurability: 0,
    isCapital: extra?.isCapital ?? false,
  };
}

function unit(id: string, owner: number, x: number, y: number, extra?: { hp?: number }): Unit {
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
    homeCity: null,
  };
}

function player(idx: number, extra?: { stars?: number; techs?: string[] }): Player {
  return {
    idx,
    name: idx === 0 ? 'A' : 'B',
    tribe: 'tribe.test',
    stars: extra?.stars ?? 0,
    techs: extra?.techs ? [...extra.techs] : [],
    met: [],
    noCityTurns: 0,
    eliminated: false,
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

/** 城市格回填 tiles.cityId（move 占领门 / bot 占领层读 tile.cityId） */
function stampCityTiles(state: State): State {
  for (const city of state.cities) state.tiles[city.y][city.x].cityId = city.id;
  return state;
}

/** 夹具 A：可攻击局面（u1 相邻 u2；攻城 move 被 §4.4 门拒 → 不入列表） */
function fixtureAttack(): State {
  return stampCityTiles(baseState({
    w: 3,
    h: 3,
    units: [unit('unit.000001', 0, 0, 1), unit('unit.000002', 1, 1, 2)],
    cities: [city('city.000001', 0, 0, 0, { isCapital: true }), city('city.000002', 2, 2, 1, { isCapital: true })],
    players: [player(0, { stars: 5 }), player(1, { stars: 5 })],
  }));
}

/** 夹具 B：仅 move/endTurn —— 无本方城、stars 0、满血、无资源（§8.2 第 9/10 层场景） */
function fixtureMoveOnly(): State {
  return baseState({
    w: 3,
    h: 3,
    units: [unit('unit.000001', 0, 1, 1)],
    players: [player(0)],
  });
}

/** 夹具 C：经济全谱 —— harvest / build / train / research / upgradeCity / heal 均可执行 */
function fixtureEconomy(): State {
  const state = stampCityTiles(baseState({
    w: 3,
    h: 3,
    tiles: grid(3, 3, (x, y) => (x === 0 && y === 1 ? tile('plain', { resource: 'fruit' }) : tile())),
    units: [unit('unit.000001', 0, 0, 1, { hp: 5 }), unit('unit.000002', 1, 2, 1)],
    cities: [city('city.000001', 0, 0, 0, { isCapital: true, population: 2 }), city('city.000002', 2, 2, 1, { isCapital: true })],
    players: [player(0, { stars: 10 }), player(1, { stars: 5 })],
  }));
  return state;
}

// ── ① soundness：既有夹具局面 legalActions 逐条 applyAction 必 rejected=false（§8.1 可靠性） ──
{
  const mismatches: string[] = [];
  let checked = 0;
  for (const [name, fixture] of [
    ['attack', fixtureAttack()],
    ['moveOnly', fixtureMoveOnly()],
    ['economy', fixtureEconomy()],
  ] as const) {
    const actions = legalActions(fixture, CTX);
    if (actions.length === 0) mismatches.push(`${name}: act 阶段列表为空（§8.1 至少含 endTurn）`);
    for (const action of actions) {
      checked += 1;
      const result = applyAction(fixture, action, CTX);
      if (result.rejected) mismatches.push(`${name}: ${canonicalJson(action)} → ${result.reason}`);
    }
  }
  if (checked === 0) mismatches.push('未产出任何候选动作');
  record(`soundness: 三夹具 legalActions 共 ${checked} 条动作逐条 apply 必 rejected=false（§8.1）`, mismatches);
}

// ── ② L0：同 (state, seed) 两次调用同动作，且输出必属 legalActions 列表（§8.2 确定性） ──
{
  const mismatches: string[] = [];
  for (const seed of [0, 1, 42, Number.MAX_SAFE_INTEGER]) {
    const state = fixtureEconomy();
    const first = botAction(state, CTX, undefined, seed, 0);
    const second = botAction(state, CTX, undefined, seed, 0);
    if (first === null) {
      mismatches.push(`seed=${seed}: 返回 null（act 阶段应有动作）`);
      continue;
    }
    if (canonicalJson(first) !== canonicalJson(second)) {
      mismatches.push(`seed=${seed}: 两次调用不同 — ${canonicalJson(first)} vs ${canonicalJson(second)}`);
    }
    const legal = legalActions(state, CTX);
    if (!legal.some((action) => canonicalJson(action) === canonicalJson(first))) {
      mismatches.push(`seed=${seed}: 输出 ${canonicalJson(first)} 不在 legalActions 中`);
    }
  }
  record('L0: 同 seed 两次调用同动作、输出 ∈ legalActions（4 个 seed）', mismatches);
}

// ── ③a L1：attack 可用局面（占领层空）→ 返回必属 attack 层 ──
{
  const mismatches: string[] = [];
  for (const seed of [0, 1, 42]) {
    const state = fixtureAttack();
    const action = botAction(state, CTX, undefined, seed, 1);
    if (action === null) mismatches.push(`seed=${seed}: 返回 null`);
    else if (action.type !== 'attack') mismatches.push(`seed=${seed}: expected attack 层, got ${canonicalJson(action)}`);
  }
  record('L1: attack 可用（占领型 move 层空）→ 必选 attack 层（§8.2 第 2 层）', mismatches);
}

// ── ③b L1：仅 move/endTurn 局面 → 返回 move（层 9 先于层 10 endTurn） ──
{
  const mismatches: string[] = [];
  const state = fixtureMoveOnly();
  const legal = legalActions(state, CTX);
  const types = new Set(legal.map((action) => action.type));
  if (!types.has('move') || !types.has('endTurn')) {
    mismatches.push(`夹具退化: 列表类型集 ${JSON.stringify([...types])} 应含 move 与 endTurn`);
  }
  for (const seed of [0, 1, 42]) {
    const action = botAction(state, CTX, undefined, seed, 1);
    if (action === null) mismatches.push(`seed=${seed}: 返回 null`);
    else if (action.type !== 'move') mismatches.push(`seed=${seed}: expected move 层, got ${canonicalJson(action)}`);
  }
  record('L1: 仅 move/endTurn → 必选 move（层 9 优先于 endTurn 层 10）', mismatches);
}

// ── ④ 排序自检：typeRank 按 §2 表序单调 + 同 type 载荷元组字典序单调 ──
{
  const mismatches: string[] = [];
  const typeOrder: Record<string, number> = {
    move: 0,
    attack: 1,
    train: 2,
    harvest: 3,
    build: 4,
    research: 5,
    upgradeCity: 6,
    heal: 7,
    endTurn: 8,
  };
  const tuple = (action: Action): (string | number)[] => [
    action.unitId ?? action.cityId ?? action.techId ?? '',
    action.x ?? -1,
    action.y ?? -1,
    action.targetId ?? '',
    action.unitType ?? '',
    action.kind ?? '',
    action.choice ?? '',
  ];
  const lessOrEqual = (a: (string | number)[], b: (string | number)[]): boolean => {
    for (let i = 0; i < a.length; i += 1) {
      const [va, vb] = [a[i], b[i]];
      if (va === vb) continue;
      if (typeof va === 'number' && typeof vb === 'number') return va <= vb;
      return String(va) < String(vb);
    }
    return true;
  };
  for (const [name, fixture] of [
    ['attack', fixtureAttack()],
    ['moveOnly', fixtureMoveOnly()],
    ['economy', fixtureEconomy()],
  ] as const) {
    const actions = legalActions(fixture, CTX);
    for (let i = 1; i < actions.length; i += 1) {
      const prev = actions[i - 1];
      const cur = actions[i];
      const prevRank: number | undefined = typeOrder[prev.type];
      const curRank: number | undefined = typeOrder[cur.type];
      if (prevRank === undefined || curRank === undefined) {
        mismatches.push(`${name}: 未知 type "${prev.type}"/"${cur.type}"`);
        break;
      }
      if (prevRank > curRank) {
        mismatches.push(`${name}: typeRank 逆序 ${prev.type}(${prevRank}) → ${cur.type}(${curRank})`);
      } else if (prevRank === curRank && !lessOrEqual(tuple(prev), tuple(cur))) {
        mismatches.push(`${name}: ${prev.type} 内元组逆序 ${canonicalJson(prev)} → ${canonicalJson(cur)}`);
      }
    }
  }
  record('排序: typeRank 按 §2 表序单调、同 type 载荷元组字典序单调（三夹具）', mismatches);
}

// ── ⑤ phase≠act → 空列表；act → 至少含 endTurn（§8.1 末行） ──
{
  const mismatches: string[] = [];
  for (const phase of ['prep', 'commit'] as const) {
    const state = fixtureAttack();
    state.phase = phase;
    const actions = legalActions(state, CTX);
    if (actions.length !== 0) {
      mismatches.push(`phase=${phase}: expected 空列表, got ${actions.length} 条 ${JSON.stringify(actions)}`);
    }
  }
  const act = legalActions(fixtureAttack(), CTX);
  if (!act.some((action) => action.type === 'endTurn')) {
    mismatches.push(`phase=act: 列表缺 endTurn（§8.1 恒非空）`);
  }
  record('phase: 非 act（prep/commit）→ 空列表；act → 至少含 endTurn', mismatches);
}

console.log(`${pass}/${pass + fail} PASS`);
if (fail > 0) {
  process.exitCode = 1;
}
