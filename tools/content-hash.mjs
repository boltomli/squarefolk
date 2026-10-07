/**
 * Squarefolk 内容指纹纯核心 —— design §6.1「contentHash 定案（v0.25）」。
 * **纯函数**：零依赖、零 I/O、零 node API —— 桌面编辑器「导出数据包」与未来 CLI 共用这一份，
 * 禁止在任何宿主里重实现（同 validate-core / dump-core 的分工原则）。
 *
 * contentHash = fnv1a64_hex(join(stableStringify(JSON.parse(text)), sep="\n") 按 CONTENT_PAIRS 显式序)
 * - stableStringify：递归按键字典序、无缩进空格；数组保序；非有限数（NaN/±Infinity）报错
 * - fnv1a64：BigInt 定点，逐字节 UTF-8，输出 16 位小写 hex（不足补前导 0）
 * - 语义保证：键序打乱 → 同一 hash；内容改动 → hash 变
 */

/**
 * 递归按键字典序的 JSON.stringify（无缩进空格；数组保序；非有限数报错）。
 * 未定义 / 函数 / symbol：对象属性按 JSON 语义省略、数组元素按 JSON 语义记 null、顶层报错。
 * @param {*} value 任意 JSON 值
 * @returns {string} 稳定串
 */
export function stableStringify(value) {
  const enc = (v) => {
    if (v === null) return 'null';
    const t = typeof v;
    if (t === 'number') {
      if (!Number.isFinite(v)) throw new RangeError(`stableStringify: 非有限数 ${String(v)}`);
      return JSON.stringify(v);
    }
    if (t === 'string' || t === 'boolean') return JSON.stringify(v);
    if (Array.isArray(v)) {
      return `[${v
        .map((x) => (x === undefined || typeof x === 'function' || typeof x === 'symbol' ? 'null' : enc(x)))
        .join(',')}]`;
    }
    if (t === 'object') {
      const parts = [];
      for (const k of Object.keys(v).sort()) {
        const val = v[k];
        if (val === undefined || typeof val === 'function' || typeof val === 'symbol') continue;
        parts.push(`${JSON.stringify(k)}:${enc(val)}`);
      }
      return `{${parts.join(',')}}`;
    }
    throw new RangeError(`stableStringify: 不是 JSON 值（${t}）`);
  };
  return enc(value);
}

const FNV_OFFSET = 0xCBF29CE484222325n;
const FNV_PRIME = 0x100000001B3n;
const MASK64 = 0xFFFFFFFFFFFFFFFFn;

/**
 * FNV-1a 64（BigInt 定点，逐字节 UTF-8）—— 常数同 core-spec §0。
 * @param {string} text 输入文本
 * @returns {string} 16 位小写 hex
 */
export function fnv1a64(text) {
  const bytes = new TextEncoder().encode(text);
  let hash = FNV_OFFSET;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= BigInt(bytes[i]);
    hash = (hash * FNV_PRIME) & MASK64;
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * 内容指纹：逐个 JSON.parse → stableStringify → 按传入数组顺序以 "\n" 拼接 → fnv1a64。
 * 解析失败原样抛出（由宿主决定措辞，本文件不吞错）。
 * @param {string[]} fileTexts 各内容文件原文（调用方按 CONTENT_PAIRS 显式序传入）
 * @returns {string} 16 位小写 hex
 */
export function contentHash(fileTexts) {
  const normalized = [];
  for (const text of fileTexts) {
    normalized.push(stableStringify(JSON.parse(text)));
  }
  return fnv1a64(normalized.join('\n'));
}
