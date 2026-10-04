/**
 * splitmix64 —— core-spec §0 行 17（定案），**仅用于世界生成**（战斗与结算零随机）。
 *
 * - 全程 u64 回绕（BigInt + U64_MASK）；`>>>` 为逻辑右移 —— 值恒非负，
 *   BigInt `>>` 在非负值上即逻辑右移，每步结果都 & U64_MASK 保持非负
 * - 状态显式传递：`splitmix64Step` 是纯步进（入旧状态、出新状态），
 *   `Splitmix64` 是带显式可读 `state` 字段的推进器（存档/回放直接取用）
 * - 禁 Math.random() / rand()（AGENTS.md 红线 1/3）
 */
import {
  SPLITMIX64_GAMMA,
  SPLITMIX64_MULT_1,
  SPLITMIX64_MULT_2,
  U64_MASK,
} from './constants';

/**
 * 单步推进（§0 行 17 逐位）：
 *   s += γ；z = s；z = (z ^ z>>>30) * M1；z = (z ^ z>>>27) * M2；return z ^ z>>>31
 * 返回新状态与输出值（均为 u64）。
 */
export function splitmix64Step(state: bigint): { state: bigint; value: bigint } {
  const s = (state + SPLITMIX64_GAMMA) & U64_MASK;
  let z = s;
  z = ((z ^ (z >> 30n)) * SPLITMIX64_MULT_1) & U64_MASK;
  z = ((z ^ (z >> 27n)) * SPLITMIX64_MULT_2) & U64_MASK;
  const value = (z ^ (z >> 31n)) & U64_MASK;
  return { state: s, value };
}

/** 显式状态的 splitmix64 流。`state` 即 §1 的 `rng` 字段（u64）。 */
export class Splitmix64 {
  /** u64 状态（种子即初始状态） */
  state: bigint;

  constructor(seed: bigint) {
    this.state = seed & U64_MASK;
  }

  /** 推进一步并返回输出值（u64，内部状态同步更新） */
  next(): bigint {
    const step = splitmix64Step(this.state);
    this.state = step.state;
    return step.value;
  }
}
