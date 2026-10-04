/**
 * core-spec §0 定案的算法常数（docs/core-spec.md §0：行 17 PRNG、行 18 stateHash）。
 *
 * 这些是 splitmix64 / FNV-1a 64 算法定义的一部分，逐位来自规格，**不是可调数值** ——
 * 按 AGENTS.md 红线 2，一切可调常数只能来自 data/balance.json；本文件禁止加入任何调参。
 */

/** u64 回绕掩码 0xFFFF…F（§0 行 17/18：全程 u64 回绕） */
export const U64_MASK = 0xFFFFFFFFFFFFFFFFn;

/** splitmix64 状态增量 γ（§0 行 17：s += 0x9E3779B97F4A7C15） */
export const SPLITMIX64_GAMMA = 0x9E3779B97F4A7C15n;
/** splitmix64 第一次混淆乘数（§0 行 17：(z ^ z>>>30) * 0xBF58476D1CE4E5B9） */
export const SPLITMIX64_MULT_1 = 0xBF58476D1CE4E5B9n;
/** splitmix64 第二次混淆乘数（§0 行 17：(z ^ z>>>27) * 0x94D049BB133111EB） */
export const SPLITMIX64_MULT_2 = 0x94D049BB133111EBn;

/** FNV-1a 64 offset basis（§0 行 18：h 初值 0xcbf29ce484222325） */
export const FNV1A64_OFFSET_BASIS = 0xCBF29CE484222325n;
/** FNV-1a 64 prime（§0 行 18：h = (h ^ b) * 0x100000001b3） */
export const FNV1A64_PRIME = 0x100000001B3n;
