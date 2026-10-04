/**
 * 序列化 / 哈希 / 状态不变量单元断言（core-spec §0 行 17–19、§1 行 45），并入 npm test。
 * 逐条 PASS/FAIL + 汇总；任一失败进程非零退出。
 */
import { canonicalJson, u64Hex } from '../src/canonical';
import { fnv1a64, stateHash } from '../src/hash';
import { checkInvariants, type State, type Tile } from '../src/state';

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

/** 断言 canonicalJson 输出逐字节等于期望（键序、空白、hex 均为 §0 行 19 的规格面）。 */
function expectJson(label: string, value: unknown, expected: string): void {
  let actual: string | undefined;
  try {
    actual = canonicalJson(value);
  } catch (error) {
    record(label, [`threw ${error instanceof Error ? error.message : String(error)}`]);
    return;
  }
  record(label, actual === expected ? [] : [`expected ${expected}, got ${actual}`]);
}

/** 断言调用抛错（浮点、越界 u64 等规格禁止项）。 */
function expectThrow(label: string, run: () => unknown): void {
  try {
    run();
    record(label, ['expected throw, but returned normally']);
  } catch {
    record(label, []);
  }
}

// ── 规范化序列化（§0 行 19） ──
expectJson('canonical: 键按字节序升序（输入键序反转）', { b: 1, a: 2 }, '{"a":2,"b":1}');
expectJson(
  'canonical: 嵌套对象同样排序、数组保序、无空白',
  { z: { y: 1, x: [3, 2, 1] }, a: true },
  '{"a":true,"z":{"x":[3,2,1],"y":1}}',
);
expectJson('canonical: u64 大数 → 16 位小写 hex 字符串', 18446744073709551615n, '"ffffffffffffffff"');
expectJson('canonical: u64 小数 → 左补零 16 位', { seed: 0n }, '{"seed":"0000000000000000"}');
expectJson('canonical: null 与缺省字段剔除', { a: 1, b: null, c: undefined }, '{"a":1}');
expectJson('canonical: 负整数与 0', { stars: -3, turn: 0 }, '{"stars":-3,"turn":0}');
expectThrow('canonical: 浮点被拒绝（无浮点）', () => canonicalJson({ hp: 1.5 }));
expectThrow('canonical: 超 2^53 的 Number 被拒绝（丢精度 → 走 u64 hex）', () => canonicalJson({ v: 2 ** 53 }));
expectThrow('canonical: u64 越界 bigint 被拒绝', () => u64Hex(18446744073709551616n));

// ── FNV-1a 64（§0 行 18） ──
record(
  'fnv1a64: 空串 = offset basis 自检位',
  fnv1a64('') === 0xcbf29ce484222325n ? [] : [`got 0x${fnv1a64('').toString(16)}`],
);

// ── stateHash（§0 行 18/19）：输出格式与确定性 ──
function makeState(): State {
  const plain: Tile = { terrain: 'plain', road: false };
  return {
    schemaVersion: 1,
    rulesVersion: '0.1.0',
    contentHash: '0123456789abcdef',
    seed: 0n,
    rng: 0x1234n,
    map: { width: 2, height: 2 },
    turn: 0,
    currentPlayer: 0,
    phase: 'prep',
    tiles: [[{ ...plain, cityId: 'city.alpha' }, plain], [plain, plain]],
    units: [
      {
        id: 'unit.warrior', owner: 0, type: 'warrior', x: 1, y: 1, hp: 10,
        moved: false, attacked: false, healed: false, kills: 0, promoted: false, homeCity: 'city.alpha',
      },
    ],
    cities: [
      {
        id: 'city.alpha', x: 0, y: 0, owner: 0, level: 1, population: 0,
        hasWorkshop: false, hasWall: false, wallDurability: 0, isCapital: true,
      },
    ],
    players: [
      { idx: 0, name: 'A', tribe: 'tribe.ember', stars: 5, techs: [], met: [], eliminated: false },
      { idx: 1, name: 'B', tribe: 'tribe.tide', stars: 0, techs: [], met: [], eliminated: true },
    ],
    actionLog: [],
  };
}

/** 断言不变量违规：状态经 mutate 后必须命中含 needle 的违规描述。 */
function expectViolation(label: string, mutate: (state: State) => void, needle: string): void {
  const state = makeState();
  mutate(state);
  const errors = checkInvariants(state, (type) => (type === 'warrior' ? 10 : undefined));
  record(label, errors.some((error) => error.includes(needle)) ? [] : [`no violation containing ${JSON.stringify(needle)}, got ${JSON.stringify(errors)}`]);
}

const hash = stateHash(makeState());
record(
  'stateHash: 16 位小写 hex 输出 + 重复计算确定',
  /^[0-9a-f]{16}$/.test(hash) && stateHash(makeState()) === hash
    ? []
    : [`got ${hash}, again ${stateHash(makeState())}`],
);

// ── checkInvariants（§1 行 45 八条不变量 + 行 26 存储序） ──
record(
  'invariants: 合法状态 → 无违规',
  checkInvariants(makeState(), (type) => (type === 'warrior' ? 10 : undefined)),
);
expectViolation('invariants: stars ≥ 0（负数被抓住）', (state) => { state.players[0].stars = -1; }, 'stars');
expectViolation('invariants: hp ≥ 0（负血被抓住）', (state) => { state.units[0].hp = -1; }, 'hp');
expectViolation('invariants: hp ≤ maxHp(type)（超上限被抓住）', (state) => { state.units[0].hp = 11; }, 'maxHp');
expectViolation(
  'invariants: 每格 ≤ 1 单位',
  (state) => {
    state.units.push({
      id: 'unit.worker', owner: 0, type: 'warrior', x: 1, y: 1, hp: 5,
      moved: false, attacked: false, healed: false, kills: 0, promoted: false, homeCity: 'city.alpha',
    });
  },
  '每格 ≤ 1 单位',
);
expectViolation('invariants: level ≥ 1', (state) => { state.cities[0].level = 0; }, 'level');
expectViolation('invariants: population ≥ 0', (state) => { state.cities[0].population = -1; }, 'population');
expectViolation(
  'invariants: hasWall ⇔ wallDurability ∈ 1..3',
  (state) => { state.cities[0].hasWall = true; },
  'hasWall',
);
expectViolation(
  'invariants: eliminated ⇔ 无城市',
  (state) => { state.players[1].eliminated = false; },
  'eliminated',
);
expectViolation('invariants: cityId 全局唯一', (state) => { state.tiles[1][1].cityId = 'city.alpha'; }, '全局唯一');
expectViolation(
  'invariants: actionLog seq 连续无洞',
  (state) => {
    state.actionLog.push({ seq: 0, player: 0, type: 'endTurn', payload: null });
    state.actionLog.push({ seq: 2, player: 1, type: 'endTurn', payload: null });
  },
  '连续无洞',
);
expectViolation(
  'invariants: units 存储序按 id 字典序',
  (state) => {
    state.units.push({
      id: 'unit.archer', owner: 0, type: 'warrior', x: 0, y: 1, hp: 5,
      moved: false, attacked: false, healed: false, kills: 0, promoted: false, homeCity: 'city.alpha',
    });
  },
  '字典序',
);

console.log(`${pass}/${pass + fail} PASS`);
if (fail > 0) {
  process.exitCode = 1;
}
