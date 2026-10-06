/**
 * M2 表格化编辑 —— 纯函数（text → table / text → text），无 DOM、无 I/O。
 *
 * 四件 id 记录文件（units/techs/improvements/resources）的结构：顶层对象里一个内容块，
 * 块内「一行一条 id 记录」。表格编辑 = 解析 → 改记录 → **只重建内容块的行**（块外字节不动），
 * 保留既有行内紧凑风格：{ "cost": 5, "counter": [1, 1], "yield": { "kind": "pop" } }。
 *
 * 写回安全网：重建结果重新 JSON.parse 后与「原解析 + 本次改动」整体相等才接受，
 * 否则报错拒写（防内容块边界定位错导致截断）。规则/校验不在这里 —— 编辑后仍由 validate-core 把关。
 */
export type CellValue = string | number | boolean | null | CellValue[] | { [k: string]: CellValue };

export interface TableData {
  contentKey: string;
  /** 列序 = 各记录键序的显式并集（首见序，红线 3） */
  columns: string[];
  /** 行序 = 文件内 id 序 */
  ids: string[];
  rows: Record<string, Record<string, CellValue>>;
}

export type TableResult = { ok: true } | { ok: false; error: string };
export type TextResult = { ok: true; text: string } | { ok: false; error: string };

function isPlainObject(v: unknown): v is Record<string, CellValue> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 记录 → 行内紧凑串，与 data/ 既有格式逐字节一致（顺序 = 解析序） */
export function formatRecord(record: Record<string, CellValue>): string {
  const fmt = (v: CellValue): string => {
    if (Array.isArray(v)) return `[${v.map(fmt).join(', ')}]`;
    if (isPlainObject(v)) {
      const body = Object.entries(v)
        .map(([k, val]) => `${JSON.stringify(k)}: ${fmt(val)}`)
        .join(', ');
      return `{ ${body} }`;
    }
    return JSON.stringify(v);
  };
  const body = Object.entries(record)
    .map(([k, v]) => `${JSON.stringify(k)}: ${fmt(v)}`)
    .join(', ');
  return `{ ${body} }`;
}

function findBlock(text: string, contentKey: string): { start: number; end: number; lines: string[] } | null {
  const lines = text.split('\n');
  const open = `  ${JSON.stringify(contentKey)}: {`;
  const start = lines.indexOf(open);
  if (start < 0) return null;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}\},?$/.test(lines[i])) return { start, end: i, lines };
  }
  return null;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 重建内容块行并做防截断自检；records 必须是「原解析 + 改动」后的完整内容块对象 */
function rebuild(text: string, contentKey: string, records: Record<string, CellValue>, expected: unknown): TextResult {
  const block = findBlock(text, contentKey);
  if (!block) return { ok: false, error: `未找到内容块 "${contentKey}"（文件结构异常）` };
  const ids = Object.keys(records);
  const recordLines = ids.map((id, i) => {
    const rec = records[id];
    if (!isPlainObject(rec)) return null;
    const comma = i < ids.length - 1 ? ',' : '';
    return `    ${JSON.stringify(id)}: ${formatRecord(rec)}${comma}`;
  });
  if (recordLines.some((l) => l === null)) return { ok: false, error: '内容块含非对象记录，拒绝写回' };
  const newLines = [...block.lines.slice(0, block.start + 1), ...(recordLines as string[]), ...block.lines.slice(block.end)];
  const rebuilt = newLines.join('\n');
  let parsed: unknown;
  try {
    parsed = JSON.parse(rebuilt);
  } catch {
    return { ok: false, error: '重建结果不是合法 JSON，拒绝写回' };
  }
  if (!deepEqual(parsed, expected)) {
    return { ok: false, error: '重建自检失败（内容块边界异常），拒绝写回' };
  }
  return { ok: true, text: rebuilt };
}

function parseBundle(text: string, contentKey: string):
  | { ok: true; parsed: Record<string, CellValue>; records: Record<string, CellValue> }
  | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `解析失败 — ${(e as Error).message}` };
  }
  if (!isPlainObject(parsed)) return { ok: false, error: '顶层不是对象' };
  const records = parsed[contentKey];
  if (!isPlainObject(records)) return { ok: false, error: `缺少内容块 "${contentKey}"` };
  return { ok: true, parsed, records };
}

/** 文本 → 表格模型；列 = 键序显式并集，行 = 文件 id 序 */
export function parseTable(text: string, contentKey: string): { ok: true; data: TableData } | { ok: false; error: string } {
  const bundle = parseBundle(text, contentKey);
  if (!bundle.ok) return bundle;
  const columns: string[] = [];
  const seen = new Set<string>();
  const ids: string[] = [];
  const rows: Record<string, Record<string, CellValue>> = {};
  for (const [id, rec] of Object.entries(bundle.records)) {
    if (!isPlainObject(rec)) return { ok: false, error: `记录 ${id} 不是对象` };
    ids.push(id);
    rows[id] = rec;
    for (const k of Object.keys(rec)) {
      if (!seen.has(k)) {
        seen.add(k);
        columns.push(k);
      }
    }
  }
  return { ok: true, data: { contentKey, columns, ids, rows } };
}

/** 单元格提交：raw 依原值类型收编；空串 = 删除该字段；无原值则尝试 JSON 解析、失败按字符串 */
export function setCellValue(text: string, contentKey: string, id: string, column: string, raw: string): TextResult {
  const bundle = parseBundle(text, contentKey);
  if (!bundle.ok) return bundle;
  const record = bundle.records[id];
  if (!isPlainObject(record)) return { ok: false, error: `记录 ${id} 不存在` };

  const next: Record<string, CellValue> = { ...record };
  if (raw === '') {
    delete next[column];
  } else {
    const original = record[column];
    let value: CellValue;
    if (typeof original === 'string') {
      value = raw;
    } else if (typeof original === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) return { ok: false, error: `${column} 应为数字，收到 ${JSON.stringify(raw)}` };
      value = n;
    } else if (typeof original === 'boolean') {
      if (raw !== 'true' && raw !== 'false') return { ok: false, error: `${column} 应为 true/false` };
      value = raw === 'true';
    } else if (original !== undefined) {
      // 数组 / 对象 / null：按 JSON 编辑
      try {
        value = JSON.parse(raw) as CellValue;
      } catch {
        return { ok: false, error: `${column} 应为 JSON（数组/对象），收到 ${JSON.stringify(raw)}` };
      }
    } else {
      try {
        value = JSON.parse(raw) as CellValue;
      } catch {
        value = raw;
      }
    }
    next[column] = value;
  }

  const records = { ...bundle.records, [id]: next };
  const expected = { ...bundle.parsed, [contentKey]: records };
  return rebuild(text, contentKey, records, expected);
}

/** 追加行：id 冲突拒写；新记录先空（必填字段缺失由 validate-core 实时报错把关） */
export function addRecord(text: string, contentKey: string, id: string): TextResult {
  const bundle = parseBundle(text, contentKey);
  if (!bundle.ok) return bundle;
  const trimmed = id.trim();
  if (trimmed === '') return { ok: false, error: 'id 不能为空' };
  if (Object.prototype.hasOwnProperty.call(bundle.records, trimmed)) {
    return { ok: false, error: `id 已存在：${trimmed}` };
  }
  const records = { ...bundle.records, [trimmed]: {} };
  const expected = { ...bundle.parsed, [contentKey]: records };
  return rebuild(text, contentKey, records, expected);
}

/** 删行 */
export function removeRecord(text: string, contentKey: string, id: string): TextResult {
  const bundle = parseBundle(text, contentKey);
  if (!bundle.ok) return bundle;
  if (!Object.prototype.hasOwnProperty.call(bundle.records, id)) {
    return { ok: false, error: `记录不存在：${id}` };
  }
  const records = { ...bundle.records };
  delete records[id];
  const expected = { ...bundle.parsed, [contentKey]: records };
  return rebuild(text, contentKey, records, expected);
}
