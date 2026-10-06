/**
 * 结构化 diff（纯函数，自写 —— design §6.1「数值 diff」的 M1 形态）。
 * 双侧是合法 JSON → 按 JSON 路径逐条列出增/删/改（键序显式排序，红线 3）；
 * 任一侧解析失败 → 退化为逐行 diff（公共前后缀裁剪）。
 *
 * 不实现任何规则/数值推导，只做「两个值哪里不一样」的结构比较。
 */
export type DiffKind = 'add' | 'del' | 'mod';

export interface DiffEntry {
  path: string;
  kind: DiffKind;
  before?: unknown;
  after?: unknown;
}

export interface DiffResult {
  mode: 'json' | 'line';
  entries: DiffEntry[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function diffValues(a: unknown, b: unknown, path: string, out: DiffEntry[]): void {
  if (Object.is(a, b)) return;
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const k of keys) {
      const p = `${path}[${JSON.stringify(k)}]`;
      if (!Object.prototype.hasOwnProperty.call(a, k)) out.push({ path: p, kind: 'add', after: b[k] });
      else if (!Object.prototype.hasOwnProperty.call(b, k)) out.push({ path: p, kind: 'del', before: a[k] });
      else diffValues(a[k], b[k], p, out);
    }
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const p = `${path}[${i}]`;
      if (i >= a.length) out.push({ path: p, kind: 'add', after: b[i] });
      else if (i >= b.length) out.push({ path: p, kind: 'del', before: a[i] });
      else diffValues(a[i], b[i], p, out);
    }
    return;
  }
  out.push({ path, kind: 'mod', before: a, after: b });
}

/** 逐行 diff：裁掉公共首尾，中段整体列为先删后增 */
function lineDiff(beforeText: string, afterText: string): DiffEntry[] {
  const a = beforeText.split('\n');
  const b = afterText.split('\n');
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length;
  let eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) {
    ea--;
    eb--;
  }
  const out: DiffEntry[] = [];
  for (let i = s; i < ea; i++) out.push({ path: `L${i + 1}`, kind: 'del', before: a[i] });
  for (let i = s; i < eb; i++) out.push({ path: `L${i + 1}`, kind: 'add', after: b[i] });
  return out;
}

/**
 * @param fileName  路径前缀（如 units.json），使条目与 validate 错误串同风格
 * @param beforeText  HEAD 版本文本（git_show_head 输出）
 * @param afterText   当前编辑器内容
 */
export function structuredDiff(fileName: string, beforeText: string, afterText: string): DiffResult {
  if (beforeText === afterText) return { mode: 'json', entries: [] };
  try {
    const a: unknown = JSON.parse(beforeText);
    const b: unknown = JSON.parse(afterText);
    const entries: DiffEntry[] = [];
    diffValues(a, b, '', entries);
    return { mode: 'json', entries: entries.map((e) => ({ ...e, path: fileName + e.path })) };
  } catch {
    return { mode: 'line', entries: lineDiff(beforeText, afterText) };
  }
}
