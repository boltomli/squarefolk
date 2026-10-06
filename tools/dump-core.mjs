/**
 * Squarefolk `dump` 核心 —— design §6.1：把五件数据渲染成玩家可读 Markdown 总表。
 * **纯函数**：入参 = 五个已解析数据对象（含 schemaVersion/rulesVersion 头），出参 = Markdown 字符串。
 * 零 node API、零 I/O、零规则重实现 —— CLI 壳（tools/dump.mjs）与桌面编辑器「导出」按钮共用。
 *
 * 只做「数据 → 表格」的直译，不推导任何规则结论（红线 2：规则在 core、数值在 data）。
 * 唯一的派生列是改善的 stars 回本回合数（cost ÷ perTurn，整数 ceil，纯算术）；
 * pop 产出的回本依赖城市结算规则，标「—」不臆算。
 */

function esc(v) {
  const s = Array.isArray(v)
    ? (v.length ? v.join('、') : '—')
    : v === undefined || v === null ? '—' : String(v);
  // Markdown 表格单元格转义：竖线与换行会破坏表格结构
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** 表格渲染：headers + rows（均为字符串数组）→ Markdown 表格（含尾部空行） */
function table(headers, rows) {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.map(esc).join(' | ')} |`);
  return [head, sep, ...body].join('\n');
}

/** 改善产出列：kind+perTurn 直译；stars 附回本回合数（cost ÷ perTurn 向上取整，整数运算） */
function yieldCell(cost, yieldSpec) {
  if (!yieldSpec) return '—';
  const base = `${yieldSpec.kind} +${yieldSpec.perTurn}/回合`;
  if (yieldSpec.kind !== 'stars' || !Number.isInteger(cost) || yieldSpec.perTurn <= 0) return base;
  const turns = Math.ceil(cost / yieldSpec.perTurn);
  return `${base}（${turns} 回合回本）`;
}

/** balance 递归摊平成 `路径 = 值` 行（显式键序 = 文件内序，红线 3） */
function flattenBalance(prefix, value, out) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) {
      flattenBalance(prefix ? `${prefix}.${k}` : k, v, out);
    }
    return;
  }
  out.push([prefix, Array.isArray(value) ? `[${value.join(', ')}]` : String(value)]);
}

/**
 * 五件数据 → 玩家可读 Markdown 总表。
 * @param files { units, techs, improvements, resources, balance } 已解析对象（含文件头）
 * @returns {string} Markdown 文档（LF 结尾）
 */
export function dumpMarkdown({ units, techs, improvements, resources, balance }) {
  const out = [];
  out.push('# Squarefolk 数据总表');
  out.push('');
  out.push(`数据版本：schemaVersion ${units.schemaVersion} · rulesVersion ${units.rulesVersion}`);
  out.push('');

  // ── 兵种 ──
  out.push('## 兵种（units.json）');
  out.push('');
  out.push(table(
    ['id', '造价★', 'HP', '攻击(×10)', '防御(×10)', '移动', '射程', '反击系数', '科技'],
    Object.entries(units.units).map(([id, u]) => [
      id, u.cost, u.hp, u.atk10, u.def10, u.move, u.range,
      Array.isArray(u.counter) ? `[${u.counter.join(', ')}]` : '—',
      u.tech ?? '—',
    ]),
  ));
  out.push('');

  // ── 科技 ──
  out.push('## 科技（techs.json）');
  out.push('');
  out.push(table(
    ['id', '层级', '前置'],
    Object.entries(techs.techs).map(([id, t]) => [id, t.tier, t.requires ?? []]),
  ));
  out.push('');

  // ── 改善 ──
  out.push('## 改善（improvements.json）');
  out.push('');
  out.push(table(
    ['id', '造价★', '可建地形', '科技', '产出'],
    Object.entries(improvements.improvements).map(([id, m]) => [
      id, m.cost, m.allowedOn, m.tech ?? '—', yieldCell(m.cost, m.yield),
    ]),
  ));
  out.push('');

  // ── 资源 ──
  out.push('## 资源（resources.json）');
  out.push('');
  out.push(table(
    ['id', '效果', '数量', '科技'],
    Object.entries(resources.resources).map(([id, r]) => [id, r.effect, r.amount, r.tech ?? '—']),
  ));
  out.push('');

  // ── 数值（balance） ──
  out.push('## 数值（balance.json）');
  out.push('');
  const rows = [];
  flattenBalance('', balance, rows);
  // 跳过文件头（schemaVersion/rulesVersion 已在文档头部给出）
  out.push(table(
    ['路径', '值'],
    rows.filter(([p]) => p !== 'schemaVersion' && p !== 'rulesVersion'),
  ));
  out.push('');

  return `${out.join('\n')}\n`;
}
