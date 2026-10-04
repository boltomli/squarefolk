/**
 * fnv1a64 / stateHash —— core-spec §0 行 18（定案）：
 *   h = 0xcbf29ce484222325；逐字节 h = (h ^ b) * 0x100000001b3（u64 回绕）；
 *   输入 = 规范化序列化字节（§0 行 19）。string 输入按 UTF-8 编码。
 *
 * 纯函数：禁随机 / 系统时间 / I/O（AGENTS.md 红线 1）。
 */
import { FNV1A64_OFFSET_BASIS, FNV1A64_PRIME, U64_MASK } from './constants';
import { canonicalJson, u64Hex } from './canonical';
import type { State } from './state';

const UTF8_ENCODER = new TextEncoder();

/** FNV-1a 64：逐字节 (h ^ b) * prime，全程 u64 回绕；输出 u64。 */
export function fnv1a64(input: Uint8Array | string): bigint {
  const bytes = typeof input === 'string' ? UTF8_ENCODER.encode(input) : input;
  let h = FNV1A64_OFFSET_BASIS;
  for (let i = 0; i < bytes.length; i++) {
    h = ((h ^ BigInt(bytes[i])) * FNV1A64_PRIME) & U64_MASK;
  }
  return h;
}

/** stateHash = FNV-1a 64(canonicalJson(state))，输出 16 位小写 hex（§0 行 18/19，§3.3 对账判据）。 */
export function stateHash(state: State): string {
  return u64Hex(fnv1a64(canonicalJson(state)));
}
