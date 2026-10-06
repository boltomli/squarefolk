/**
 * botAction —— core-spec §8.2 分层 bot（**策略层，非规则**：分层优先级不是 balance 值、不入 data）。
 *
 * 确定性红线（AGENTS 1 / §8）：同 (state, ctx, options, seed, level) → 同动作；
 * 无时间 / 无真随机 / 无 I/O。随机性仅来自 `seed` 经 splitmix64（§0 定案、§4.6 同一实现）
 * 取**一步 value** 的取模选择。
 *
 * - L0：`index = Number(value mod |actions|)` 全列表取模。
 * - L1（v1 demo 默认，`level` 缺省 1）：十层优先级，层非空 → 层内回落 L0 的 seed 选择，
 *   空层跳过（策略约定，注释即文档，不进 data）：
 *   1. 占领型 move（目标格 `cityId` → 非己方城，或中立村庄非空）
 *   2. attack（含 `targetId = cityId` 攻城）3. harvest 4. train 5. build
 *   6. upgradeCity 7. research 8. heal 9. 其余 move 10. endTurn
 * - bot 不做前瞻、不读 `state` 与 `ctx` 之外的数据；legalActions 为空（非 act）→ null。
 *
 * `seed` 必须是 0..2^53−1 的整数、`level ∈ {0, 1}`，否则抛错（规格只定义 L0/L1，不猜测语义）。
 *
 * TS 签名备注（不改 docs / testdata，随交付报告）：§8.2 记法 `options?` 后跟必填 `seed, level`
 * 在 TS 中不可表达（可选参数不能前置必填参数）→ `options` 以 `ApplyOptions | undefined`
 * 必填位表达「可省」，调用方省略时传 `undefined`；`level = 1` 承接「L1（v1 demo 默认）」。
 */
import { legalActions, type Action, type ActionContext, type ApplyOptions } from './actions';
import { splitmix64Step } from './prng';
import type { State } from './state';

/** L1 第 2–8 层的动作类型序（§8.2 十层里的类型层，层内回落 L0） */
const L1_TYPE_LAYERS: readonly string[] = [
  'attack',
  'harvest',
  'train',
  'build',
  'upgradeCity',
  'research',
  'heal',
];

/**
 * §8.2 botAction —— `ctx` / `options` 透传给 `legalActions`（同 §8.1），后在其输出上分层挑选。
 * 返回被选中的动作；legalActions 为空（如非 act 阶段）返回 null。
 */
export function botAction(
  state: State,
  ctx: ActionContext,
  options: ApplyOptions | undefined,
  seed: number,
  level = 1,
): Action | null {
  if (!Number.isInteger(seed) || seed < 0 || seed > Number.MAX_SAFE_INTEGER) {
    throw new Error(`botAction: seed 须为 0..2^53−1 的整数，得到 ${String(seed)}`);
  }
  if (level !== 0 && level !== 1) {
    throw new Error(`botAction: level 须为 0（L0）或 1（L1），得到 ${String(level)}`);
  }

  const actions = legalActions(state, ctx, options);
  if (actions.length === 0) return null;

  // §8.2：seed → splitmix64 取一步 value；选择只由 (value, 池长) 决定 → 同输入同输出
  const { value } = splitmix64Step(BigInt(seed));
  const pick = (pool: Action[]): Action => pool[Number(value % BigInt(pool.length))];

  if (level === 0) return pick(actions);

  const actor = state.currentPlayer;
  // 第 1 层：占领型 move —— 目标格 cityId → 非己方城，或中立村庄非空（§8.2 记法 villageId
  // 非空；State tiles 的村庄标记为 `village: bool`，§1 行 39）
  const captureMoves = actions.filter((action) => {
    if (action.type !== 'move' || action.x === undefined || action.y === undefined) return false;
    if (action.y < 0 || action.y >= state.map.height || action.x < 0 || action.x >= state.map.width) return false;
    const tile = state.tiles[action.y][action.x];
    if (tile.village) return true;
    if (tile.cityId === null || tile.cityId === undefined) return false;
    const city = state.cities.find((entry) => entry.id === tile.cityId);
    return city !== undefined && city.owner !== actor;
  });
  if (captureMoves.length > 0) return pick(captureMoves);

  // 第 2–8 层：按类型过滤，首个非空层内 L0
  for (const type of L1_TYPE_LAYERS) {
    const pool = actions.filter((action) => action.type === type);
    if (pool.length > 0) return pick(pool);
  }

  // 第 9 层：其余 move（第 1 层筛剩的 move）
  const otherMoves = actions.filter((action) => action.type === 'move');
  if (otherMoves.length > 0) return pick(otherMoves);

  // 第 10 层：endTurn（act 阶段 legalActions 恒含 → 走到这里必命中）
  return pick(actions.filter((action) => action.type === 'endTurn'));
}
