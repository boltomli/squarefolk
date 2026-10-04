/**
 * canonicalJson —— core-spec §0 规范化序列化（docs/core-spec.md 行 19，定案）：
 * - UTF-8；对象键按**键名 UTF-8 字节序**升序（不是 UTF-16 码元序）
 * - 无空白；整数无前导零、无 '+'；**无浮点**（非整数 / 非安全整数 Number 一律拒绝）
 * - null 与缺省（undefined）字段不输出；数组保持调用方给定的规范序（§1 行 26）
 * - u64（seed / rng / stateHash / contentHash 等，TS 侧 bigint）一律输出
 *   **16 位小写 hex 字符串**（JSON 数字 > 2^53 在 JS 侧丢精度，§0 行 19）
 *
 * 纯函数：禁随机 / 系统时间 / I/O（AGENTS.md 红线 1）。
 */
import { U64_MASK } from './constants';

const UTF8_ENCODER = new TextEncoder();

/** u64（bigint）→ 16 位小写 hex 字符串（§0 行 19）；超出 u64 范围抛错。 */
export function u64Hex(value: bigint): string {
  if (value < 0n || value > U64_MASK) {
    throw new Error(`u64Hex: value out of u64 range: ${value}`);
  }
  return value.toString(16).padStart(16, '0');
}

/** UTF-8 字节序比较（§0 行 19：键按键名 UTF-8 字节序升序；前缀相同则短者在前）。 */
function compareUtf8(a: Uint8Array, b: Uint8Array): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

function encode(value: unknown): string {
  if (value === null) {
    // 对象字段的 null 在对象分支已剔除；仅数组元素会落到这里（数组不可删元素，保序）
    return 'null';
  }
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isSafeInteger(value)) {
        throw new Error(`canonicalJson: 非安全整数（无浮点；> 2^53 须走 u64 hex）: ${value}`);
      }
      return String(value); // 整数无前导零、无 '+'（toString 即满足）
    case 'bigint':
      return `"${u64Hex(value)}"`;
    case 'object': {
      if (Array.isArray(value)) {
        const items = value.map((item, index) => {
          if (item === undefined) {
            throw new Error(`canonicalJson: 数组元素 ${index} 为 undefined（不可输出）`);
          }
          return encode(item);
        });
        return `[${items.join(',')}]`;
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).filter(
        (key) => record[key] !== null && record[key] !== undefined,
      );
      keys.sort((x, y) => compareUtf8(UTF8_ENCODER.encode(x), UTF8_ENCODER.encode(y)));
      return `{${keys.map((key) => `${JSON.stringify(key)}:${encode(record[key])}`).join(',')}}`;
    }
    default:
      throw new Error(`canonicalJson: 不支持的类型 ${typeof value}`);
  }
}

/** 规范化序列化（§0 行 19）。顶层 null/undefined 不可输出（null 与缺省字段不输出）。 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) {
    throw new Error('canonicalJson: 顶层 null/undefined 不可输出（§0 行 19）');
  }
  return encode(value);
}
