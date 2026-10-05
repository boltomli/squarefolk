/**
 * demo 内容数据（design §6 数据五层的 content 层，随 demo 内联；不入库 balance.json）。
 * 三件套边界：本文件只提供 applyAction 的 ActionContext 与表现层文案；
 * 规则判定一律由 core 执行（AGENTS.md 红线 2、任务约束「UI 不实现任何规则」）。
 */
import type { ActionContext } from '../../core/src/actions';

/** 沙盒初始 ⭐（玩家单人一方） */
export const START_STARS = 5;

/**
 * 沙盒初始科技（引导修缮）：果园 → 采果加人口路径首回合可见（否则果园成本 5⭐ = 全部开局星星，人口死锁）；
 * 狩猎 → 🐗 采集（+2⭐）路径首回合可见，避免"野猪没反应"的误解。
 */
export const START_TECHS: readonly string[] = ['tech.orchard', 'tech.hunt'];

/**
 * 表现层城市配色 + 徽记字母（仅 presentation；不参与任何规则判定）。
 * 按「首次出现在玩家视野中的城市」顺序取槽位，故同一局内稳定：单位徽记 ↔ 城市描边一一对应。
 */
export const CITY_PALETTE: readonly { color: string; tag: string }[] = [
  { color: '#ffd54f', tag: 'A' },
  { color: '#5bc0ff', tag: 'B' },
  { color: '#ff8bd0', tag: 'C' },
  { color: '#c69cff', tag: 'D' },
  { color: '#4be0d0', tag: 'E' },
  { color: '#ff9b4a', tag: 'F' },
  { color: '#7cf29b', tag: 'G' },
  { color: '#ff6b6b', tag: 'H' },
];

/** 兵种 / 科技 / 资源：ids 与持久化约定一致（字符串 id，禁枚举整数） */
export const CONTENT: ActionContext = {
  unitTypes: {
    'unit.warrior': { cost: 5, hp: 10, atk10: 20, def10: 20, move: 2, range: 1, counter: [1, 1] },
    'unit.scout': { cost: 3, hp: 10, atk10: 15, def10: 10, move: 3, range: 1, counter: [1, 1] },
    'unit.knight': { cost: 6, hp: 10, atk10: 30, def10: 20, move: 2, range: 1, counter: [1, 1], tech: 'tech.steel' },
  },
  techs: {
    'tech.orchard': { tier: 1, requires: [] },
    'tech.hunt': { tier: 1, requires: [] },
    'tech.steel': { tier: 2, requires: ['tech.hunt'] },
  },
  resources: {
    fruit: { effect: 'pop', amount: 1, tech: 'tech.orchard' },
    beast: { effect: 'stars', amount: 2, tech: 'tech.hunt' },
  },
  // demo 无建设 UI → 无改善类型（core 谓词对未知 kind 拒绝，不发数）
  improvementTypes: {},
};

/** 展示序（红线 3：显式排序，不依赖对象/哈希迭代序） */
export const UNIT_TYPE_ORDER: readonly string[] = ['unit.warrior', 'unit.scout', 'unit.knight'];
export const TECH_ORDER: readonly string[] = ['tech.orchard', 'tech.hunt', 'tech.steel'];

/** 表现层文案（i18n 属 presentation 层，core 不读） */
export const UNIT_LABELS: Record<string, string> = {
  'unit.warrior': '步兵',
  'unit.scout': '斥候',
  'unit.knight': '骑士',
};

export const TECH_LABELS: Record<string, string> = {
  'tech.orchard': '果园 · 解锁 🍎 采集',
  'tech.hunt': '狩猎 · 解锁 🐗 采集',
  'tech.steel': '冶铁 · 解锁骑士',
};

export const RESOURCE_LABELS: Record<string, string> = {
  fruit: '🍎 果实（+1 人口）',
  beast: '🐗 兽群（+2 ⭐）',
};

/** upgradeCity 三选一（choice 值 = core §4.3 枚举） */
export const UPGRADES: readonly { choice: string; label: string; hint: string }[] = [
  { choice: 'workshop', label: '工坊', hint: '城收入 +1 ⭐' },
  { choice: 'stars5', label: '金库', hint: '立即 +5 ⭐' },
  { choice: 'wall', label: '城墙', hint: '城防耐久 3' },
];
