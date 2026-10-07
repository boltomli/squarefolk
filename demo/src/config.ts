/**
 * demo 装配层（design §6 数据五层的 content 层）：唯一事实源 = data/*.json，
 * 本文件只做装配与表现层文案（esbuild 把 JSON 一并内联 → 单文件零外链不变）。
 * 三件套边界：本文件只提供 applyAction 的 ActionContext 与表现层文案；
 * 规则判定一律由 core 执行（AGENTS.md 红线 2、任务约束「UI 不实现任何规则」）。
 * 数据正确性由 `npm run validate` / `tools/validate.mjs` 把关（schema + 交叉引用）。
 */
import type { ActionContext } from '../../core/src/actions';
import balanceData from '../../data/balance.json';
import improvementsData from '../../data/improvements.json';
import resourcesData from '../../data/resources.json';
import techsData from '../../data/techs.json';
import unitsData from '../../data/units.json';

/** 沙盒初始 ⭐（玩家单人一方） */
export const START_STARS = 10;

/**
 * 沙盒初始科技（引导修缮）：果园 → 采果加人口路径首回合可见（否则果园成本 5⭐ = 全部开局星星，人口死锁）；
 * 狩猎 → 🐗 采集（+2⭐）路径首回合可见，避免"野猪没反应"的误解。
 */
export const START_TECHS: readonly string[] = ['tech.orchard', 'tech.hunt'];

/**
 * T4 淘汰宽限回合数（data/balance.json elimination 段唯一事实源）。
 * 壳层只用它拼提示文案（「无城 N/5 回合」）；判定在 core §4.7 / §3.1 commit-2。
 */
export const ELIMINATION_GRACE = balanceData.elimination.eliminationGraceTurns;

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

/**
 * 兵种 / 科技 / 资源 / 改善：ids 与持久化约定一致（字符串 id，禁枚举整数）。
 * JSON 推断的宽化类型（counter 元组、effect/yield.kind 枚举字面量）由 data/schemas +
 * tools/validate.mjs 在数据侧把关；遍历序 = JSON 文件显式序（红线 3）。
 */
const unitTypes: ActionContext['unitTypes'] = {};
for (const [id, raw] of Object.entries(unitsData.units)) {
  const u = raw as {
    cost: number;
    hp: number;
    atk10: number;
    def10: number;
    move: number;
    range: number;
    counter: number[];
    canAttackAfterMove?: boolean;
    killSwap?: boolean;
    tech?: string;
  };
  unitTypes[id] = {
    cost: u.cost,
    hp: u.hp,
    atk10: u.atk10,
    def10: u.def10,
    move: u.move,
    range: u.range,
    counter: [u.counter[0], u.counter[1]],
    ...(u.canAttackAfterMove !== undefined ? { canAttackAfterMove: u.canAttackAfterMove } : {}),
    ...(u.killSwap !== undefined ? { killSwap: u.killSwap } : {}),
    ...(u.tech !== undefined ? { tech: u.tech } : {}),
  };
}

export const CONTENT: ActionContext = {
  unitTypes,
  techs: techsData.techs as ActionContext['techs'],
  resources: resourcesData.resources as ActionContext['resources'],
  improvementTypes: improvementsData.improvements as ActionContext['improvementTypes'],
};

/** 展示序（红线 3：显式排序，不依赖对象/哈希迭代序） */
export const UNIT_TYPE_ORDER: readonly string[] = ['unit.builder', 'unit.scout', 'unit.warrior', 'unit.knight'];
export const TECH_ORDER: readonly string[] = ['tech.orchard', 'tech.hunt', 'tech.steel'];

/** 表现层文案（i18n 属 presentation 层，core 不读） */
export const UNIT_LABELS: Record<string, string> = {
  'unit.builder': '工兵',
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
