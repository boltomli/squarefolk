/**
 * resolveCombat —— core-spec §4.1 战斗结算纯函数。
 *
 * 硬红线（AGENTS.md）：
 * - 确定性：仅整数运算（Math.floor），禁随机 / 浮点中间值 / 系统时间 / I/O；
 * - 数值不落盘于代码：公式中一切可调常数（K、12%/点、封顶 50、垂死除数 4、
 *   分母 2000、加成值…）由 data/balance.json 经 resolveJsonModule 读入。
 *
 * 公式唯一形式（§4.1-C，E 恒取输出方自己的交战前血量 —— design §3.3 E(攻)/E(守)）：
 *   damage  = round_half_up( atk10_eff(a) × K × (maxHp_a + hp_a_pre) × M(def10_eff_d)
 *                            ─────────────────────────────────────────────────────── )
 *                                         2000 × maxHp_a
 *   counter = round_half_up( atk10_eff(d) × K × (maxHp_d + hp_d_pre) × M(def10_eff_a) × p
 *                            ─────────────────────────────────────────────────────────── )
 *                                         2000 × maxHp_d × q × k
 *   round_half_up(n, d) = floor( (2n + d) / (2d) )
 */
import balance from '../../data/balance.json';

export interface UnitBase {
  /** 攻击力，×10 定点（2.0 → 20） */
  atk10: number;
  /** 基础防御力，×10 定点 */
  def10: number;
  /** 交战前血量 */
  hp: number;
  maxHp: number;
  /** 反击系数有理数 [p, q]：近战 1/1、弓手 1/2、投石 1/4、医疗 0/1 */
  counter: readonly [number, number];
}

export interface Combatant {
  base: UnitBase;
  /** §4.1-B 加成枚举列表（同一列表按表分攻/防两侧汇总；夹具与运行时同构） */
  boni: readonly string[];
}

export type CounterKind = 'full' | 'dying';

export interface CombatResult {
  damage: number;
  counterDamage: number;
  counterKind: CounterKind;
  attackerHpAfter: number;
  defenderHpAfter: number;
  defenderDied: boolean;
}

interface BonusRule {
  /** 攻侧加成 ×10；缺省 0 */
  atk10?: number;
  /** 防侧加成 ×10；缺省 0 */
  def10?: number;
  /** 该 key 防侧合计上限 ×10（support_each 专用） */
  defTotalCap?: number;
}

interface CombatBalance {
  /** 伤害公式系数 K（design §3.7 标定 = 3） */
  damageK: number;
  /** M(d) = 100 − (每点减伤百分比 × d) / def10PerPoint */
  mReductionPercentPerPoint: number;
  def10PerPoint: number;
  /** def10_eff 求和后封顶（§4.1-B：封顶在求和之后，M 下限 40%） */
  def10Cap: number;
  /** 伤害/反击公式的分母基数 2000（E 与 ×10 属性合并后的形式） */
  damageDenominator: number;
  /** 垂死反击除数 k = 4（基数 × 1/4，design §3.5-C7） */
  dyingCounterDivisor: number;
  /** 可选内容安全上限（§4.1-C，默认关）：damage ≤ ceil(maxHp × percent%) */
  contentSafetyCap: { enabled: boolean; percent: number };
  /** 加成枚举 → ×10 攻/防侧数值（§4.1-B 表） */
  boni: Record<string, BonusRule>;
}

const combat: CombatBalance = balance.combat;

function bonusRule(key: string): BonusRule {
  const rule = combat.boni[key];
  if (rule === undefined) {
    throw new Error(`resolveCombat: unknown bonus key "${key}"`);
  }
  return rule;
}

/** half-up：floor((2n + d) / (2d))，正数等价于 n/d + 0.5 取下整（§4.1-C，不调 round()） */
function roundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** M(d) = 100 − (12 × d) / 10（d 为 5 的 倍数 → 整除无余数，floor 保整数） */
function mPercent(def10: number): number {
  return 100 - Math.floor((combat.mReductionPercentPerPoint * def10) / combat.def10PerPoint);
}

/** 攻侧有效攻击 = base + ∑攻侧加成，无封顶（§4.1-B） */
function atk10Eff(unit: Combatant): number {
  let sum = unit.base.atk10;
  for (const key of unit.boni) {
    sum += bonusRule(key).atk10 ?? 0;
  }
  return sum;
}

/** 防侧有效防御 = min(base + ∑防侧加成（support_each 先按合计上限截断）, def10Cap) */
function def10Eff(unit: Combatant): number {
  const counts = new Map<string, number>();
  for (const key of unit.boni) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let sum = unit.base.def10;
  for (const key of [...counts.keys()].sort()) {
    const rule = bonusRule(key);
    let value = (rule.def10 ?? 0) * (counts.get(key) ?? 0);
    if (rule.defTotalCap !== undefined) {
      value = Math.min(value, rule.defTotalCap);
    }
    sum += value;
  }
  return Math.min(sum, combat.def10Cap);
}

/**
 * 单次交战结算（§4.1-C/D）：加成汇总 → 伤害落地 → 存活判定 → 反击（k 在最后舍入前乘入）。
 * 双方数值均取交战前静态属性；HP 下限 0（伤害可溢出）。
 * E 血量项恒取**输出方自己**的交战前血量（design §3.3：E(攻)/E(守)，P3"残血保留半战力"）。
 */
export function resolveCombat(attacker: Combatant, defender: Combatant): CombatResult {
  const [p, q] = defender.base.counter;
  if (!Number.isInteger(p) || !Number.isInteger(q) || p < 0 || q < 1) {
    throw new Error(`resolveCombat: invalid counter [${p}, ${q}]`);
  }

  const hpPreA = attacker.base.hp;
  const maxHpA = attacker.base.maxHp;
  const hpPreD = defender.base.hp;
  const maxHpD = defender.base.maxHp;
  const hpTermA = maxHpA + hpPreA; // 攻击式：攻方自己的 E 项
  const hpTermD = maxHpD + hpPreD; // 反击式：守方（反击输出方）自己的 E 项，取交战前值

  const atk10A = atk10Eff(attacker);
  const atk10D = atk10Eff(defender);
  const def10A = def10Eff(attacker);
  const def10D = def10Eff(defender);

  // 1) 伤害：单整数表达式，最后一步 half-up（E/分母均为攻方 maxHp）
  let damage = roundHalfUp(
    atk10A * combat.damageK * hpTermA * mPercent(def10D),
    combat.damageDenominator * maxHpA,
  );
  // 可选内容安全上限（§4.1-C 默认关）——针对目标 maxHp 的整数 ceil：floor((maxHp × percent + 99) / 100)
  if (combat.contentSafetyCap.enabled) {
    const cap = Math.floor((maxHpD * combat.contentSafetyCap.percent + 99) / 100);
    if (damage > cap) damage = cap;
  }

  // 2) 伤害落地 + 3) 存活判定（HP 下限 0）
  const defenderHpAfter = Math.max(0, hpPreD - damage);
  const defenderDied = defenderHpAfter === 0;

  // 4) 反击：k 在最后一次舍入之前乘入分母；p/q = 0 时分子为 0 → 天然为 0
  const k = defenderDied ? combat.dyingCounterDivisor : 1;
  const counterDamage = roundHalfUp(
    atk10D * combat.damageK * hpTermD * mPercent(def10A) * p,
    combat.damageDenominator * maxHpD * q * k,
  );
  const attackerHpAfter = Math.max(0, hpPreA - counterDamage);

  return {
    damage,
    counterDamage,
    counterKind: defenderDied ? 'dying' : 'full',
    attackerHpAfter,
    defenderHpAfter,
    defenderDied,
  };
}
