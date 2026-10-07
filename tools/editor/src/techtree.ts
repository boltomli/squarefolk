/**
 * 科技树图形化（M4）—— 零依赖 SVG 分层布局，纯渲染，不实现规则。
 *
 * 数据 = 调用方传入的 techs.json 当前缓冲文本（JSON.parse，不另读盘）；
 * 结构合法性（无环、tier、requires 悬空）由 validate-core 把关 —— 本文件只画，不判定。
 * 成本不入 techs.json（design §4.3 / core-spec §4.3：cost = tier × 城市数 + 4），
 * 故节点/列头按该公式直译展示，不发明静态造价。
 *
 * 布局：按 tier 分列（列头 = Tier N + 该层合计成本），层内按 tech id 字典序自上而下；
 * requires 边画箭头（源卡右缘 → 目标卡左缘，同层则自上而下）；节点点击回调由宿主接底部面板。
 */

import type { CellValue } from './table';

export interface TechTreeRecord {
  tier: number;
  requires: string[];
  [k: string]: CellValue;
}

export type TechTreeResult =
  | { ok: true; techs: Map<string, TechTreeRecord>; tiers: number[]; byTier: Map<number, string[]>; orphans: string[] }
  | { ok: false; error: string };

const CARD_W = 220;
const CARD_H = 74;
const COL_GAP = 90;
const ROW_GAP = 26;
const PAD = 16;
const HEADER_H = 54;

/** 解析 techs.json 缓冲 → 分层模型（层内与层序均显式排序，红线 3） */
export function modelTechTree(text: string): TechTreeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `techs.json 解析失败 — ${(e as Error).message}` };
  }
  if (parsed === null || typeof parsed !== 'object' || !('techs' in parsed)) {
    return { ok: false, error: 'techs.json 缺少 techs 内容块' };
  }
  const block = parsed.techs;
  if (block === null || typeof block !== 'object' || Array.isArray(block)) {
    return { ok: false, error: 'techs.json 缺少 techs 内容块' };
  }
  const techs = new Map<string, TechTreeRecord>();
  for (const [id, rec] of Object.entries(block)) {
    if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) {
      return { ok: false, error: `techs.json: ${id} 不是对象` };
    }
    // 结构合法性归 validate-core（禁重实现规则）；此处仅按既定形状直读入模型
    const record: TechTreeRecord = rec as TechTreeRecord;
    techs.set(id, record);
  }
  const byTier = new Map<number, string[]>();
  const orphans: string[] = [];
  for (const id of [...techs.keys()].sort()) {
    const tier = techs.get(id)?.tier;
    if (tier !== undefined && Number.isInteger(tier) && tier >= 1) {
      const list = byTier.get(tier) ?? [];
      list.push(id);
      byTier.set(tier, list);
    } else {
      orphans.push(id);
    }
  }
  const tiers = [...byTier.keys()].sort((a, b) => a - b);
  if (orphans.length > 0) tiers.push(Number.NaN); // 尾列：tier 非法的记录（validate 会报错，树仍可见）
  return { ok: true, techs, tiers, byTier, orphans };
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/**
 * 渲染科技树 SVG 到 container。
 * @param container 目标容器（内容会被清空重画）
 * @param text techs.json 当前缓冲
 * @param onSelect 节点点击回调（宿主负责底部面板展示完整记录）
 */
export function renderTechTree(container: HTMLElement, text: string, onSelect: (id: string) => void): void {
  container.textContent = '';
  const model = modelTechTree(text);
  if (!model.ok) {
    const err = document.createElement('p');
    err.className = 'error';
    err.textContent = `科技树不可用：${model.error}（可回源码视图修正）`;
    container.appendChild(err);
    return;
  }
  const { techs, tiers, byTier, orphans } = model;
  const cols = tiers.length;
  const rowsPerCol = tiers.map((t) => (Number.isNaN(t) ? orphans.length : (byTier.get(t)?.length ?? 0)));
  const maxRows = Math.max(1, ...rowsPerCol);
  const width = PAD * 2 + cols * CARD_W + Math.max(0, cols - 1) * COL_GAP;
  const height = PAD * 2 + HEADER_H + maxRows * CARD_H + Math.max(0, maxRows - 1) * ROW_GAP;

  const svg = el('svg', {
    width: String(width),
    height: String(height),
    viewBox: `0 0 ${width} ${height}`,
    role: 'group',
    'aria-label': '科技树（按 Tier 分层）',
  });
  const defs = el('defs', {});
  const marker = el('marker', {
    id: 'tt-arrow',
    markerWidth: '8',
    markerHeight: '8',
    refX: '7',
    refY: '4',
    orient: 'auto',
    markerUnits: 'strokeWidth',
  });
  marker.appendChild(el('path', { d: 'M0,0 L8,4 L0,8 z', fill: '#576074' }));
  defs.appendChild(marker);
  svg.appendChild(defs);

  // 边组先挂上 svg，后续节点卡 append 在其后 —— 箭头天然垫在卡片之下，无需回插
  const edges = el('g', { class: 'tt-edges' });
  svg.appendChild(edges);

  const colX = (i: number): number => PAD + i * (CARD_W + COL_GAP);
  const rowY = (r: number): number => PAD + HEADER_H + r * (CARD_H + ROW_GAP);
  const positions = new Map<string, { x: number; y: number; col: number; row: number }>();

  // ── 列头 + 节点卡 ──
  tiers.forEach((tier, i) => {
    const ids = Number.isNaN(tier) ? orphans : (byTier.get(tier) ?? []);
    const header = el('g', {});
    const t1 = el('text', { x: String(colX(i)), y: String(PAD + 16), class: 'tt-col-title' });
    t1.textContent = Number.isNaN(tier) ? 'Tier ?' : `Tier ${tier}`;
    header.appendChild(t1);
    // 该层合计成本 = Σ(tier × 城市数 + 4) = 项数 × (tier × 城市数 + 4)（core-spec §4.3 公式直译）
    const t2 = el('text', { x: String(colX(i)), y: String(PAD + 34), class: 'tt-col-sub' });
    t2.textContent = Number.isNaN(tier)
      ? `${ids.length} 项（tier 非法）`
      : `${ids.length} 项 · 合计 ${ids.length}×(${tier}×城市数+4)`;
    header.appendChild(t2);
    svg.appendChild(header);

    ids.forEach((id, r) => {
      const x = colX(i);
      const y = rowY(r);
      positions.set(id, { x, y, col: i, row: r });
      const g = el('g', { class: 'tt-node', tabindex: '0', role: 'button', 'aria-label': id });
      g.appendChild(
        el('rect', { x: String(x), y: String(y), width: String(CARD_W), height: String(CARD_H), rx: '8', class: 'tt-card' }),
      );
      const line1 = el('text', { x: String(x + 12), y: String(y + 22), class: 'tt-id' });
      line1.textContent = id;
      g.appendChild(line1);
      const rec = techs.get(id);
      const line2 = el('text', { x: String(x + 12), y: String(y + 42), class: 'tt-cost' });
      line2.textContent = rec === undefined || Number.isNaN(tier)
        ? `tier ${String(rec?.tier)}（非法）`
        : `cost = ${tier} × 城市数 + 4`;
      g.appendChild(line2);
      const req = rec !== undefined && Array.isArray(rec.requires) ? rec.requires : [];
      const line3 = el('text', { x: String(x + 12), y: String(y + 60), class: 'tt-req' });
      line3.textContent = req.length === 0 ? 'requires: —' : `requires: ${req.join('、')}`;
      g.appendChild(line3);
      const click = (): void => onSelect(id);
      g.addEventListener('click', click);
      g.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
          e.preventDefault();
          click();
        }
      });
      svg.appendChild(g);
    });
  });

  // ── requires 边（写入先挂载的 edges 组，垫在节点卡之下）──
  for (const id of [...techs.keys()].sort()) {
    const to = positions.get(id);
    if (!to) continue;
    const rec = techs.get(id);
    const req = rec !== undefined && Array.isArray(rec.requires) ? rec.requires : [];
    for (const srcId of req) {
      const from = positions.get(srcId);
      if (!from) continue; // 悬空 requires —— validate 报错，树上不画
      let x1: number, y1: number, x2: number, y2: number;
      if (from.col < to.col) {
        x1 = from.x + CARD_W;
        y1 = from.y + CARD_H / 2;
        x2 = to.x - 4;
        y2 = to.y + CARD_H / 2;
      } else if (from.col > to.col) {
        x1 = from.x;
        y1 = from.y + CARD_H / 2;
        x2 = to.x + CARD_W + 4;
        y2 = to.y + CARD_H / 2;
      } else {
        x1 = from.x + CARD_W / 2;
        y1 = from.y + CARD_H;
        x2 = to.x + CARD_W / 2;
        y2 = to.y - 4;
      }
      edges.appendChild(el('line', { x1: String(x1), y1: String(y1), x2: String(x2), y2: String(y2), class: 'tt-edge' }));
    }
  }
  container.appendChild(svg);
}
