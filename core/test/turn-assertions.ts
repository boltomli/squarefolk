/**
 * 动作管线 / 回合结算边角单测（core-spec §4.7 征服、§4.1-D killSwap 受阻、§4.4 围城收入、
 * §2 heal 本土/境外、§2 research 前置），不依赖黄金向量；并入 npm test。
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
const CTX: ActionContext = { unitTypes: { 'unit.warrior': WARRIOR }, techs: {}, resources: {} };

const maxHpOf = (type: string): number | undefined => (type === 'unit.warrior' ? 10 : undefined);

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

function city(id: string, x: number, y: number, owner: number, extra?: { level?: number; isCapital?: boolean }): City {
  return {
    id,
    x,
    y,
    owner,
    level: extra?.level ?? 1,
    population: 0,
    hasWorkshop: false,
    hasWall: false,
    wallDurability: 0,
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

function player(idx: number, extra?: { stars?: number; eliminated?: boolean }): Player {
  return {
    idx,
    name: idx === 0 ? 'A' : 'B',
    tribe: 'tribe.test',
    stars: extra?.stars ?? 0,
    techs: [],
    met: [],
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
  };
  const before = canonicalJson(state);
  const result = applyAction(state, { type: 'research', techId: 'tech.t2' }, ctx);
  const mismatches: string[] = [];
  if (result.rejected === false) mismatches.push('期望拒绝（前置 tech.t1 未研究；stars 10 ≥ cost 6）');
  if (canonicalJson(state) !== before) mismatches.push('拒绝路径状态必须零变化（§2）');
  record('research: 前置未满足 → rejected，状态零变化（§2/§4.3）', mismatches);
}

console.log(`${pass}/${pass + fail} PASS`);
if (fail > 0) {
  process.exitCode = 1;
}
