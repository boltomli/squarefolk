/**
 * 表现层（presentation）：渲染与事件接线。不含任何规则 —— 只展示 ViewModel、
 * 把点击翻译成 handler 调用（规则判定一律由 core API 执行，AGENTS.md 红线 2）。
 *
 * Phase 12：两种模式共用同一渲染管线 ——
 * - 模式选择屏（`renderStart`）：沙盒 / 对战 vs Bot 入口 + 世界种子输入
 * - 棋盘渲染（`render`）：对战模式额外画「可攻击目标」红框、Bot 回合指示、淘汰宽限提示、
 *   征服结算覆盖层；面板按钮按 §8.1 legalActions 过滤，被拒按钮上屏 core 拒绝原话（`✗ …`）
 */
import { ELIMINATION_GRACE, RESOURCE_LABELS, TECH_LABELS } from './config';

export interface CellModel {
  x: number;
  y: number;
  visibility: 'hidden' | 'explored' | 'visible';
  terrain: string | null;
  resource: string | null;
  village: boolean;
  city: 'capital' | 'city' | null;
  /** 己方城市格 → 城市配色（描边/图标底色）；非己方或 hidden → null */
  cityColor: string | null;
  /** 本回合新占领（表现层标记，结束回合清除） */
  cityNew: boolean;
  unit: {
    id: string;
    type: string;
    hp: number;
    acted: boolean;
    /** 敌方单位（仅 visible 格出现；acts 不可见 → acted 恒 false） */
    enemy: boolean;
    /** 母城徽记字母（homeCity 无 / 敌方 → null） */
    homeTag: string | null;
    /** 母城配色 */
    homeColor: string | null;
  } | null;
  inTerritory: boolean;
  /** 归属城市配色（领地半透明底色）；非己方或 hidden → null */
  territoryColor: string | null;
  reachable: boolean;
  /** 可攻击目标（敌兵 / 敌城，legalActions ∩ 视野过滤） */
  attack: boolean;
  selected: boolean;
}

export interface ViewModel {
  mode: 'sandbox' | 'vs';
  /** 对战世界种子（沙盒 = null） */
  seed: number | null;
  stars: number;
  turn: number;
  /** 对战回合归属指示（沙盒 = null） */
  phaseLabel: string | null;
  canEndTurn: boolean;
  villages: number;
  villagesTotal: number;
  exploredPercent: number;
  status: string;
  /** 淘汰/无城宽限提示（§4.7 T4；沙盒恒 null） */
  warn: string | null;
  cells: CellModel[];
  unit: {
    id: string;
    label: string;
    hp: number;
    maxHp: number;
    moved: boolean;
    attacked: boolean;
    healed: boolean;
    onResource: string | null;
    onOwnCity: boolean;
    /** 母城 id（null = 初始单位无母城） */
    homeCity: string | null;
    homeTag: string | null;
    homeColor: string | null;
    homeLabel: string | null;
    /** core 采集拒绝原因（探针结果）；null = 可采集或脚格上无资源 */
    harvestBlocked: string | null;
  } | null;
  city: {
    id: string;
    label: string;
    level: number;
    population: number;
    /** 升至 level+1 所需人口（core §4.3 提示值） */
    popNeed: number;
    stationed: number;
    tag: string;
    color: string;
    isNew: boolean;
    /** 升级三选一；blocked = null 可点 / 非 null = core 拒绝原话 */
    upgrades: { choice: string; label: string; hint: string; blocked: string | null }[];
  } | null;
  unitTypes: { id: string; label: string; cost: number; tech: string | null; blocked: string | null }[];
  techs: { id: string; label: string; done: boolean; requires: string[]; blocked: string | null }[];
  overlay: { title: string; body: string; button: string } | null;
}

export interface StartModel {
  seed: string;
  error: string | null;
}

export interface Handlers {
  onTile(x: number, y: number): void;
  onEndTurn(): void;
  onTrain(unitType: string): void;
  onUpgrade(choice: string): void;
  onResearch(techId: string): void;
  onHarvest(): void;
  onOverlayClose(): void;
  onStartVs(): void;
  onStartSandbox(): void;
  onSeedNext(): void;
  onRestart(): void;
}

const TERRAIN_STYLE: Record<string, { bg: string; mark: string; name: string }> = {
  plain: { bg: '#8db84a', mark: '', name: '平原' },
  forest: { bg: '#2f6b34', mark: '🌲', name: '森林' },
  mountain: { bg: '#93a1ad', mark: '⛰️', name: '山地' },
  swamp: { bg: '#6f5a24', mark: '≋', name: '沼泽' },
  water: { bg: '#1f7ae0', mark: '🌊', name: '水域' },
};

const UNIT_ICON: Record<string, string> = {
  'unit.warrior': '⚔️',
  'unit.scout': '🏹',
  'unit.knight': '🐎',
};

const RESOURCE_ICON: Record<string, string> = { fruit: '🍎', beast: '🐗' };

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 被拒按钮的拒绝原话（core §2 谓词输出，逐字上屏） */
function denyHtml(blocked: string | null): string {
  return blocked === null ? '' : `<small class="deny">✗ ${esc(blocked)}</small>`;
}

/** 事件委托挂在常驻 root 上（render 只换 innerHTML，监听器不丢） */
export function mount(root: HTMLElement, handlers: Handlers): void {
  root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-act]') : null;
    if (target === null || !root.contains(target)) return;
    const act = target.dataset.act;
    const arg = target.dataset.arg ?? '';
    switch (act) {
      case 'tile':
        handlers.onTile(Number(target.dataset.x), Number(target.dataset.y));
        break;
      case 'endTurn':
        handlers.onEndTurn();
        break;
      case 'train':
        handlers.onTrain(arg);
        break;
      case 'upgrade':
        handlers.onUpgrade(arg);
        break;
      case 'research':
        handlers.onResearch(arg);
        break;
      case 'harvest':
        handlers.onHarvest();
        break;
      case 'closeOverlay':
        handlers.onOverlayClose();
        break;
      case 'startVs':
        handlers.onStartVs();
        break;
      case 'startSandbox':
        handlers.onStartSandbox();
        break;
      case 'seedNext':
        handlers.onSeedNext();
        break;
      case 'restart':
        handlers.onRestart();
        break;
      default:
        break;
    }
  });
}

/** 模式选择屏（Phase 12 入口）：沙盒 / 对战 vs Bot + 世界种子输入 */
export function renderStart(root: HTMLElement, model: StartModel): void {
  const error = model.error === null ? '' : `<p class="why">✗ ${esc(model.error)}</p>`;
  root.innerHTML = `<div id="start">
    <section class="card startcard">
      <h1>⬛ Squarefolk</h1>
      <p class="hint">选择模式（Phase 12 · 单人 vs Bot，不热座）</p>
      <div class="grid">
        <button class="act primary" data-act="startVs">⚔ 对战 Bot<small>worldgen 10×10 · 你先手、Bot 后手</small></button>
        <button class="act" data-act="startSandbox">🏖 沙盒<small>单人自由 · 探索 100% + 占村</small></button>
      </div>
      <h3>世界种子（对战）</h3>
      <div class="seedrow">
        <input id="seedInput" inputmode="numeric" value="${esc(model.seed)}">
        <button class="act" data-act="seedNext">🎲 换一个种子<small>当前值 +1（同种子必同图）</small></button>
      </div>
      ${error}
      <p class="hint">Bot 每步种子 = 世界种子 ⊕ 回合号（§8.2 确定性）；Bot 行动 150ms/步、500 步上限强制收束。</p>
    </section>
  </div>`;
}

function cellHtml(cell: CellModel): string {
  const classes = ['cell', cell.visibility];
  if (cell.inTerritory) classes.push('mine');
  if (cell.reachable) classes.push('reach');
  if (cell.attack) classes.push('attack');
  if (cell.selected) classes.push('sel');
  if (cell.cityColor !== null) classes.push('cityown');
  if (cell.cityNew) classes.push('citynew');

  const terrain =
    cell.visibility === 'hidden' ? null : TERRAIN_STYLE[cell.terrain ?? 'plain'] ?? TERRAIN_STYLE.plain;
  const styles: string[] = [];
  if (terrain !== null) styles.push(`background:${terrain.bg}`);
  if (cell.territoryColor !== null) styles.push(`--fill:${cell.territoryColor}`);
  if (cell.cityColor !== null) styles.push(`--cityc:${cell.cityColor}`);
  const background = styles.length === 0 ? '' : ` style="${styles.join(';')}"`;

  let inner = '<span class="fog">?</span>';
  let title = terrain === null ? '未探索' : `${terrain.name} (${cell.x},${cell.y})`;
  if (terrain !== null) {
    inner = '';
    if (terrain.mark !== '') inner += `<span class="tmark">${terrain.mark}</span>`;
    if (cell.resource !== null) {
      inner += `<span class="feat">${RESOURCE_ICON[cell.resource] ?? '✦'}</span>`;
      title += ` · ${RESOURCE_LABELS[cell.resource] ?? cell.resource}`;
    }
    if (cell.city === 'capital' || cell.city === 'city') {
      const icon = cell.city === 'capital' ? '🏰' : '🏠';
      inner += `<span class="feat citychip">${icon}</span>`;
      if (cell.cityNew) inner += '<b class="newmark">新</b>';
      title += ` · 城市${cell.cityNew ? '（本回合新占领）' : ''}`;
    } else if (cell.village) {
      inner += '<span class="feat">🏘️</span>';
    }
    if (cell.unit !== null) {
      const icon = UNIT_ICON[cell.unit.type] ?? '兵';
      const home =
        cell.unit.homeTag === null
          ? '<b class="home none">–</b>'
          : `<b class="home" style="background:${cell.unit.homeColor ?? '#9aa2bd'}">${cell.unit.homeTag}</b>`;
      const enemy = cell.unit.enemy ? ' enemy' : '';
      const acted = cell.unit.acted && !cell.unit.enemy ? ' acted' : '';
      inner += `<span class="unit${acted}${enemy}">${home}${icon}<i>${cell.unit.hp}</i></span>`;
      if (cell.unit.enemy) title += ' · 敌军（点击红框目标可攻击）';
    }
  }
  return `<div class="${classes.join(' ')}" data-act="tile" data-x="${cell.x}" data-y="${cell.y}"${background} title="${esc(title)}">${inner}</div>`;
}

function unitHtml(model: ViewModel): string {
  const unit = model.unit;
  if (unit === null) return '';
  const flags = [
    unit.moved ? '已移动' : '',
    unit.attacked ? '已攻击' : '',
    unit.healed ? '已治疗' : '',
  ].filter((flag) => flag !== '').join(' · ');
  const home =
    unit.homeCity === null
      ? '<p class="hint">母城：无（初始单位，不占城容量）</p>'
      : `<p class="hint">母城：<b class="chip"${unit.homeColor === null ? '' : ` style="background:${unit.homeColor}"`}>${unit.homeTag ?? '?'}</b> ${esc(unit.homeLabel ?? unit.homeCity)} <small>${unit.homeCity}</small></p>`;
  let harvest = '';
  if (unit.onResource !== null) {
    const label = RESOURCE_LABELS[unit.onResource] ?? unit.onResource;
    if (unit.harvestBlocked !== null) {
      // core 的拒绝原话上屏（§2 谓词判定在 core，UI 只转述）
      harvest = `<button class="act primary" disabled>采集 ${esc(label)}${denyHtml(unit.harvestBlocked)}</button>`;
    } else {
      harvest = `<button class="act primary" data-act="harvest">采集 ${esc(label)}</button>`;
    }
  }
  return `<section class="card">
    <h2>${esc(unit.label)} <small>${unit.id}</small></h2>
    <p>HP ${unit.hp}/${unit.maxHp}${flags === '' ? '' : ` · ${flags}`}</p>
    ${home}
    <p class="hint">点击高亮格移动（绿框）· 点击红框目标攻击${unit.onOwnCity ? '；本格是你的城市，下方可操作' : ''}</p>
    ${harvest}
  </section>`;
}

function cityHtml(model: ViewModel): string {
  const city = model.city;
  if (city === null) return '';
  const trains = model.unitTypes
    .map((type) => {
      const need = type.tech === null ? '' : ` · 需 ${TECH_LABELS[type.tech] ?? type.tech}`;
      const blocked = type.blocked === null ? '' : denyHtml(type.blocked);
      const disabled = type.blocked === null ? '' : ' disabled';
      return `<button class="act" data-act="train" data-arg="${type.id}"${disabled}>${esc(type.label)} ⭐${type.cost}${need}${blocked}</button>`;
    })
    .join('');
  const upgrades = city.upgrades
    .map(
      (upgrade) =>
        `<button class="act" data-act="upgrade" data-arg="${upgrade.choice}"${
          upgrade.blocked === null ? '' : ' disabled'
        }>${upgrade.label}<small>${upgrade.hint}</small>${denyHtml(upgrade.blocked)}</button>`,
    )
    .join('');
  const techs = model.techs
    .map((tech) => {
      if (tech.done) return `<li class="done">✅ ${esc(tech.label)}</li>`;
      const need = tech.requires.length === 0 ? '' : `<small>前置：${tech.requires.map((id) => TECH_LABELS[id] ?? id).join('、')}</small>`;
      const blocked = tech.blocked === null ? '' : denyHtml(tech.blocked);
      const disabled = tech.blocked === null ? '' : ' disabled';
      return `<li><button class="act" data-act="research" data-arg="${tech.id}"${disabled}>研究 ${esc(tech.label)}${need}${blocked}</button></li>`;
    })
    .join('');
  const short = city.population < city.popNeed;
  const popHint = short
    ? `<p class="hint">人口来源：派单位踩领地内 🍎 并采集（+1）—— 还差 ${city.popNeed - city.population} 人口；🐗 采到的是 +2⭐，不加人口</p>`
    : '<p class="hint">人口来源：派单位踩领地内 🍎 并采集（+1）；🐗 采到的是 +2⭐，不加人口</p>';
  return `<section class="card">
    <h2>${city.label.startsWith('首都') ? '🏰' : '🏠'} ${esc(city.label)} <b class="chip" style="background:${city.color}">${city.tag}</b>${
      city.isNew ? ' <b class="chip warn">本回合新占领</b>' : ''
    } <small>${city.id}</small></h2>
    <p>城级 L${city.level} · 人口 ${city.population}/${city.popNeed} · 驻留 ${city.stationed}</p>
    <p class="hint">升级至 L${city.level + 1} 需 ${city.popNeed} 人口（消耗等额人口）</p>
    ${popHint}
    <h3>训练</h3><div class="grid">${trains}</div>
    <h3>升级（三选一）</h3><div class="grid">${upgrades}</div>
    <h3>研究</h3><ul class="techs">${techs}</ul>
  </section>`;
}

function helpHtml(model: ViewModel): string {
  if (model.mode === 'vs') {
    return `<section class="card">
      <h2>对战目标</h2>
      <p>1. 你先手（玩家 0）：点己方单位 → <b>绿框</b> = 可移动、<b>红框</b> = 可攻击（含敌城攻城），目标集来自 §8.1 legalActions。</p>
      <p>2. 点己方城 🏰 → 训练 / 升级 / 修墙 / 研究；可选项按 legalActions 过滤，<code>✗</code> 为 core 拒绝原话。</p>
      <p>3. 结束回合 → Bot 按 §8.2 L1 逐步行动（150ms/步），直到它结束回合回到你。</p>
      <p>4. 攻占<b>全部首都</b> → 征服胜利；连续 ${ELIMINATION_GRACE} 回合无城 → 淘汰（上屏提示）。</p>
    </section>`;
  }
  return `<section class="card">
    <h2>沙盒目标</h2>
    <p>1. 点击己方单位 → 高亮格可移动；单位角标字母 = 母城归属，踩上 🏘️ 中立村即占领。</p>
    <p>2. 领地半透明底色 = 归属城市；点城市 🏰 / 🏠 → 训练 / 升级 / 研究。</p>
    <p>3. 升级需人口：派单位踩领地内 🍎 点击采集 +1（果园已自带）；🐗 采集得 +2⭐（狩猎已自带，不加人口）。</p>
    <p>4. 探索 100% 且占领全部村庄 → 🎉。</p>
  </section>`;
}

export function render(root: HTMLElement, model: ViewModel): void {
  const board = `<div id="board">${model.cells.map(cellHtml).join('')}</div>`;
  const warn = model.warn === null ? '' : `<div id="warn">${esc(model.warn)}</div>`;
  const panel = `<aside id="panel">
    ${warn}
    ${unitHtml(model)}
    ${cityHtml(model)}
    ${model.unit === null && model.city === null ? helpHtml(model) : ''}
    <div id="status" class="${model.status.startsWith('✗') ? 'bad' : 'good'}">${esc(model.status)}</div>
  </aside>`;
  const phase =
    model.phaseLabel === null ? '' : `<span class="stat phase${model.phaseLabel.startsWith('🤖') ? ' bot' : ''}">${esc(model.phaseLabel)}</span>`;
  const seedStat = model.seed === null ? '' : `<span class="stat">种子 ${model.seed}</span>`;
  const restart = model.mode === 'vs' ? `<button class="ghost" data-act="restart">新局</button>` : '';
  const topbar = `<header id="topbar">
    <span class="brand">⬛ Squarefolk <em>${model.mode === 'vs' ? '对战' : '沙盒'}</em></span>
    <span class="stat">⭐ ${model.stars}</span>
    <span class="stat">回合 ${model.turn}</span>
    ${phase}
    <span class="stat">🏘 ${model.villages}/${model.villagesTotal}</span>
    <span class="stat">探索 ${model.exploredPercent}%
      <span class="bar"><i style="width:${model.exploredPercent}%"></i></span>
    </span>
    ${seedStat}
    ${restart}
    <button id="endTurn" data-act="endTurn"${model.canEndTurn ? '' : ' disabled'}>结束回合 ⏭</button>
  </header>`;
  const overlay =
    model.overlay === null
      ? ''
      : `<div id="overlay"><div class="card">
        <h1>${esc(model.overlay.title)}</h1>
        <p>${esc(model.overlay.body)}</p>
        <button class="act primary" data-act="closeOverlay">${esc(model.overlay.button)}</button>
      </div></div>`;
  root.innerHTML = `${topbar}<div id="layout">${board}${panel}</div>${overlay}`;
}
