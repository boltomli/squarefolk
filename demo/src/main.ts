/**
 * demo 壳层：会话状态 + 事件 → core API 调用 + ViewModel 组装。
 *
 * 分工（core-spec §1 行 47 / 任务约束）：
 * - 规则判定只走 core：applyAction（§2 谓词 + §3.2 结算、§4.7 胜负）、legalActions（§8.1 唯一
 *   合法动作集 —— 面板过滤 / 可达与可攻击高亮 / 点击判定共用同一来源）、botAction（§8.2 分层 bot）、
 *   viewFor / visibleCellsFor（§4.5 三态）、territoryGrid / resolveBorderRadius（§4.3）
 * - 壳层职责：初始 State 构造（map.ts 沙盒 / vsmap.ts 对战）、explored 迷雾历史累积（不入 State）、
 *   视图裁剪与渲染、bot 回合调度（150ms/步 + 步数上限防御）
 *
 * Phase 12 两种模式（入口 = 模式选择屏 renderStart）：
 * - 沙盒（单人自由）：手工 10×10，探索 100% + 占领全部村庄 → 完成覆盖层（既有行为）
 * - 对战 vs Bot（单人、不热座）：worldgen 按种子生成 10×10 → 玩家 0（人类）先手、玩家 1（bot）后手；
 *   人类 endTurn → bot 依 botAction(L1) 逐步执行到自己的 endTurn → 回到人类；
 *   applyAction 返回 winner !== null → 征服覆盖层 + 棋盘冻结；无城宽限 / 淘汰上屏提示
 *
 * 迷雾公平（§4.5）：人类与 bot 各自维护 explored 历史，applyAction / legalActions 的
 * options.explored 按行动方传入（move 的非 hidden 过滤、视图裁剪都只吃本方迷雾）。
 */
import { applyAction, legalActions, type Action, type ApplyResult } from '../../core/src/actions';
import { botAction } from '../../core/src/bot';
import type { Coord } from '../../core/src/movement';
import { resolveBorderRadius, owningCity, territoryGrid, type TerritoryCity } from '../../core/src/territory';
import { viewFor, visibleCellsFor, type ViewTile } from '../../core/src/vision';
import type { State } from '../../core/src/state';
import {
  CITY_PALETTE,
  CONTENT,
  ELIMINATION_GRACE,
  RESOURCE_LABELS,
  TECH_LABELS,
  TECH_ORDER,
  UNIT_LABELS,
  UNIT_TYPE_ORDER,
  UPGRADES,
} from './config';
import { MAP_H, MAP_W, PLAYER_IDX, VILLAGE_TOTAL, createInitialState } from './map';
import { mount, render, renderStart, type CellModel, type Handlers, type StartModel, type ViewModel } from './ui';
import { BOT_IDX, DEFAULT_SEED, SEED_MAX, createVsInitialState } from './vsmap';

/** content 层山地地形 id（viewFor 注入参数，同 core 惯例） */
const MOUNTAIN_TERRAIN_ID = 'mountain';
const TOTAL_CELLS = MAP_W * MAP_H;

/** bot 每步间隔（表现层节奏；不影响确定性 —— 步间状态只由 (state, seed) 决定） */
const BOT_STEP_MS = 150;
/** bot 单回合步数上限：防御死锁（达到即强制 endTurn + 上屏告警） */
const BOT_STEP_CAP = 500;

type Mode = 'sandbox' | 'vs';

interface Session {
  /** null = 模式选择屏（Phase 12 入口） */
  mode: Mode | null;
  state: State;
  /** 起始屏种子输入原文（解析域 0..SEED_MAX） */
  seedInput: string;
  /** 对战世界种子（同种子 → 同地图） */
  seed: number;
  startError: string | null;
  /** 中立村总数（沙盒 = 手工图常量；对战 = worldgen 结果） */
  villageTotal: number;
  /** 己方（玩家 0）已探索历史位图（key = y × MAP_W + x；壳侧累积，不入 State） */
  explored: Set<number>;
  /** bot（玩家 1）已探索历史 —— §4.5 按行动方算，bot 只吃自己的迷雾（公平） */
  botExplored: Set<number>;
  view: ViewTile[];
  /** 本渲染周期的 §8.1 合法集（单次枚举；面板过滤 / 高亮 / 点击判定共用） */
  legal: Action[];
  selectedUnitId: string | null;
  selectedCityId: string | null;
  reachableCells: Coord[];
  /** 可攻击目标：格 key → targetId（敌兵或敌城；已按视野过滤，不泄漏雾下信息） */
  attackTargets: Map<number, string>;
  status: string;
  celebrated: boolean;
  /** 覆盖层已关闭（胜局/完成各只弹一次） */
  overlayClosed: boolean;
  /** 征服胜者 players 下标（null = 未分胜负） */
  winner: number | null;
  botBusy: boolean;
  botSteps: number;
  /** 己方城市配色/徽记（表现层，按首次出现顺序取 CITY_PALETTE 槽位，不入 State） */
  cityStyle: Map<string, { color: string; tag: string }>;
  /** 已配过色的城市 id（首见即占槽，后续不移位） */
  seenCities: Set<string>;
  /** 本回合新占领的城市（结束回合清空 → 表现层「新」标记） */
  newCities: Set<string>;
}

const session: Session = {
  mode: null,
  state: createInitialState(),
  seedInput: String(DEFAULT_SEED),
  seed: DEFAULT_SEED,
  startError: null,
  villageTotal: VILLAGE_TOTAL,
  explored: new Set<number>(),
  botExplored: new Set<number>(),
  view: [],
  legal: [],
  selectedUnitId: null,
  selectedCityId: null,
  reachableCells: [],
  attackTargets: new Map<number, string>(),
  status: '点击己方单位或首都开始',
  celebrated: false,
  overlayClosed: false,
  winner: null,
  botBusy: false,
  botSteps: 0,
  cityStyle: new Map<string, { color: string; tag: string }>(),
  seenCities: new Set<string>(),
  newCities: new Set<string>(),
};

/**
 * 己方城市配色同步（表现层状态）：新城市首见取下一槽位；`markNew=true` 时标记「本回合新占领」。
 * boot 时用 false → 首都不算新占。
 */
function syncCityStyles(markNew: boolean): void {
  const owned = session.state.cities
    .filter((city) => city.owner === PLAYER_IDX)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const city of owned) {
    if (!session.cityStyle.has(city.id)) {
      session.cityStyle.set(city.id, CITY_PALETTE[session.cityStyle.size % CITY_PALETTE.length]);
    }
    if (session.seenCities.has(city.id)) continue;
    session.seenCities.add(city.id);
    if (markNew) session.newCities.add(city.id);
  }
}

function cityStyle(cityId: string): { color: string; tag: string } {
  return session.cityStyle.get(cityId) ?? { color: '#9aa2bd', tag: '?' };
}

/**
 * explored 位图 → §4.5 的 `[y, x]` 升序对（viewFor / applyAction / legalActions 同一入参形状）。
 * 人类与 bot 各传各的位图：迷雾按行动方算（core-spec §4.5），一处实现两处复用。
 */
function exploredPairs(bitmap: Set<number>): number[][] {
  const sorted = [...bitmap].sort((a, b) => a - b);
  return sorted.map((key) => [Math.floor(key / MAP_W), key % MAP_W]);
}

/** §4.5：visible 并入 explored 历史（一旦成立不回退）；按观察方各记各的 */
function accumulateVisibleFor(viewer: number): void {
  const target = viewer === PLAYER_IDX ? session.explored : session.botExplored;
  for (const cell of visibleCellsFor(viewer, session.state, MOUNTAIN_TERRAIN_ID)) {
    target.add(cell.y * MAP_W + cell.x);
  }
}

function refreshView(): void {
  accumulateVisibleFor(PLAYER_IDX);
  session.view = viewFor(PLAYER_IDX, session.state, {
    explored: exploredPairs(session.explored),
    mountainTerrainId: MOUNTAIN_TERRAIN_ID,
  });
}

/**
 * core 抛错兜底（壳层健壮性；不改规则、不吞报告）。
 * core 对**规格空白**是故意抛错的（实测：`territory.borderRadiusByLevel` 只定义 1–6，
 * 城升到 L7 时 `resolveBorderRadius` 抛「缺少 level=7 的条目」—— 该表属 data/balance.json，
 * 工作面禁改 → 只能报告）。壳层把报告原样送进状态栏（与其他拒绝同一 `✗` 通道），
 * 并返回 fallback 让棋盘继续渲染，而不是让事件处理器带异常死掉。
 */
function coreGuard<T>(run: () => T, fallback: T): T {
  try {
    return run();
  } catch (error) {
    session.status = `✗ ${error instanceof Error ? error.message : String(error)}`;
    return fallback;
  }
}

function territoryCities(state: State): TerritoryCity[] {
  return state.cities.map((city) => ({
    id: city.id,
    x: city.x,
    y: city.y,
    owner: String(city.owner),
    radius: resolveBorderRadius(city.level),
  }));
}

/** 己方领土格 → 归属城市配色（core territoryGrid 定归属、owningCity 定到城；仅 presentation） */
function territoryColors(state: State): Map<number, string> {
  return coreGuard(() => {
    const cities = territoryCities(state);
    const ownedCells = territoryGrid(MAP_H, MAP_W, cities)[String(PLAYER_IDX)] ?? [];
    const colors = new Map<number, string>();
    for (const [y, x] of ownedCells) {
      const owning = owningCity(cities, x, y);
      if (owning === null) continue;
      colors.set(y * MAP_W + x, cityStyle(owning.id).color);
    }
    return colors;
  }, new Map<number, string>()); // 抛错（如表外城级）→ 无领地染色，原因已上屏
}

function unitById(id: string | null): State['units'][number] | undefined {
  if (id === null) return undefined;
  return session.state.units.find((unit) => unit.id === id);
}

function ownCityAt(x: number, y: number): State['cities'][number] | undefined {
  const tile = session.state.tiles[y][x];
  if (tile.cityId === null || tile.cityId === undefined) return undefined;
  return session.state.cities.find((city) => city.id === tile.cityId && city.owner === PLAYER_IDX);
}

function activeCity(): State['cities'][number] | undefined {
  if (session.selectedCityId !== null) {
    return session.state.cities.find((city) => city.id === session.selectedCityId);
  }
  const unit = unitById(session.selectedUnitId);
  return unit === undefined ? undefined : ownCityAt(unit.x, unit.y);
}

function clearSelection(): void {
  session.selectedUnitId = null;
  session.selectedCityId = null;
  session.reachableCells = [];
  session.attackTargets = new Map<number, string>();
}

/**
 * §8.1 合法集（唯一事实来源）：只在「人类回合 + 未冻结」时枚举 ——
 * bot 回合返回空集（面板按钮全灭、人类点击无效由 humanActive 把关）。
 */
function computeLegal(): Action[] {
  if (session.mode === null || session.botBusy || session.state.currentPlayer !== PLAYER_IDX) return [];
  return coreGuard(
    () => legalActions(session.state, CONTENT, { explored: exploredPairs(session.explored) }),
    [], // 抛错（如表外城级）→ 空合法集 = 无可执行动作，原因已上屏
  );
}

/** §8.1 动作相等（面板过滤用）：判别键 + 全部载荷字段 */
function actionKey(action: Action): string {
  return JSON.stringify([
    action.type,
    action.unitId ?? '',
    action.x ?? -1,
    action.y ?? -1,
    action.targetId ?? '',
    action.cityId ?? '',
    action.unitType ?? '',
    action.techId ?? '',
    action.choice ?? '',
    action.kind ?? '',
  ]);
}

/** targetId → 目标格坐标（敌兵取单位坐标、敌城取城坐标） */
function targetCell(targetId: string): { x: number; y: number } | null {
  const unit = session.state.units.find((entry) => entry.id === targetId);
  if (unit !== undefined) return { x: unit.x, y: unit.y };
  const city = session.state.cities.find((entry) => entry.id === targetId);
  return city === undefined ? null : { x: city.x, y: city.y };
}

/**
 * §4.2 可达高亮 + 可攻击目标高亮 —— 两者都取 legalActions 输出（含 core 谓词与迷雾过滤），
 * 壳层只做「动作 → 格坐标」的展示映射：
 * - move → 绿框（本回合已行动的单位自然没有 move 候选 = §2 谓词的可视化）
 * - attack → 红框；敌兵仅 `visible` 格（explored 无单位信息，§4.5）、敌城 `explored` 轮廓即可
 */
function recomputeHighlights(): void {
  session.reachableCells = [];
  session.attackTargets = new Map<number, string>();
  const unit = unitById(session.selectedUnitId);
  if (unit === undefined || unit.owner !== PLAYER_IDX) return;
  for (const action of session.legal) {
    if (action.unitId !== unit.id) continue;
    if (action.type === 'move') {
      if (action.x !== undefined && action.y !== undefined) session.reachableCells.push({ y: action.y, x: action.x });
      continue;
    }
    if (action.type !== 'attack' || action.targetId === undefined) continue;
    const target = targetCell(action.targetId);
    if (target === null) continue;
    const key = target.y * MAP_W + target.x;
    const viewCell = session.view[key];
    if (viewCell === undefined || viewCell.visibility === 'hidden') continue;
    const isUnit = session.state.units.some((entry) => entry.id === action.targetId);
    if (isUnit && viewCell.visibility !== 'visible') continue;
    session.attackTargets.set(key, action.targetId);
  }
}

/**
 * 单动作管线入口：拒绝 → 状态零变化 + 原因上屏；成功 → 新态 + 迷雾累积 + 胜负检查。
 * explored 按行动方传入（人类走本函数、bot 走 submitAs(BOT_IDX)）。
 */
function submitAs(actor: number, action: Action): State | null {
  const explored = exploredPairs(actor === PLAYER_IDX ? session.explored : session.botExplored);
  const result = coreGuard<ApplyResult | null>(
    () => applyAction(session.state, action, CONTENT, { explored }),
    null,
  );
  if (result === null) return null; // core 抛错 → 状态零变化，报告已在状态栏
  if (result.rejected) {
    session.status = `✗ ${result.reason}`;
    return null;
  }
  session.state = result.state;
  if (result.winner !== null && session.winner === null) {
    session.winner = result.winner;
    session.status =
      result.winner === PLAYER_IDX ? '🏆 征服胜利：你已占领全部首都' : '💀 被征服：Bot 占领了你的全部首都';
  }
  refreshView();
  syncCityStyles(true);
  if (session.mode === 'sandbox') checkCompletion();
  return result.state;
}

function submit(action: Action): State | null {
  return submitAs(PLAYER_IDX, action);
}

/**
 * 成功文案：已分胜负时保留征服文案（不被后置的「已移动」之类覆盖）。
 */
function note(text: string): void {
  if (session.winner === null) session.status = text;
}

/**
 * 只读探针：applyAction 内部先 structuredClone 再写（actions.ts §2 管线），故探测不改 session.state；
 * 探测通过 → 后继态丢弃（面板只用拒绝原因，动作仍由用户点击触发）。
 */
function probeRejected(action: Action): string | null {
  const result = coreGuard<ApplyResult | null>(
    () => applyAction(session.state, action, CONTENT, { explored: exploredPairs(session.explored) }),
    null,
  );
  if (result === null) return 'core 抛错（原因见下方状态栏）';
  return result.rejected ? result.reason : null;
}

/** 沙盒完成条件（对战不走这里 —— 对战以 winner 结束） */
function checkCompletion(): void {
  const villages = session.state.cities.filter((city) => city.owner === PLAYER_IDX && !city.isCapital).length;
  const done = villages >= session.villageTotal && session.explored.size >= TOTAL_CELLS;
  if (done && !session.celebrated) session.celebrated = true;
}

function stars(): number {
  return session.state.players[PLAYER_IDX].stars;
}

/** 人类可操作（对战 = 我的回合且非 bot 行动中且未分胜负；沙盒恒 true） */
function humanActive(): boolean {
  if (session.mode === null) return false;
  return session.winner === null && !session.botBusy && session.state.currentPlayer === PLAYER_IDX;
}

/** 冻结原因（面板按钮 / 采集按钮的统一拒绝话术；null = 未冻结） */
function freezeReason(): string | null {
  if (session.winner !== null) return '对局已结束（征服）';
  if (session.botBusy) return 'Bot 行动中，请等待';
  if (session.state.currentPlayer !== PLAYER_IDX) return '当前不是你的回合';
  return null;
}

/** T4 淘汰/无城宽限提示（判定在 core §4.7 / §3.1 commit-2，壳层只转述计数） */
function eliminationWarn(): string | null {
  if (session.mode !== 'vs') return null;
  const notes: string[] = [];
  for (const player of session.state.players) {
    const who = player.idx === PLAYER_IDX ? '你' : 'Bot';
    if (player.eliminated) {
      notes.push(`${who}已被淘汰（连续无城 ${ELIMINATION_GRACE} 回合）`);
      continue;
    }
    if (player.noCityTurns > 0) notes.push(`${who}无城 ${player.noCityTurns}/${ELIMINATION_GRACE} 回合（宽限）`);
  }
  return notes.length === 0 ? null : `⚠ ${notes.join('；')}`;
}

function onTile(x: number, y: number): void {
  if (!humanActive()) return;
  const index = y * MAP_W + x;
  const viewCell = session.view[index];
  const tile = session.state.tiles[y][x];

  // 1) 已选单位 + 可达格 → move（目标集 = legalActions 的 move，含 core 迷雾/占位过滤）
  if (session.selectedUnitId !== null && session.reachableCells.some((cell) => cell.x === x && cell.y === y)) {
    const unitId = session.selectedUnitId;
    if (submit({ type: 'move', unitId, x, y }) !== null) {
      // 手感修订（2026-10-07）：移动后**保持选中**并重算高亮 —— 走打一体（§4.1-G 默认 true）
      // → 立即红框显示可攻目标；旧版 clearSelection() 清掉一切提示，体感"移完就不能打"。
      recomputeHighlights();
      note(session.attackTargets.size > 0 ? '已移动 · 红框目标可攻击' : '已移动');
    }
    renderNow();
    return;
  }

  // 2) 已选单位 + 红框目标 → attack（敌兵战斗 / 敌城攻城，targetId 原样交给 core）
  const attackTarget = session.attackTargets.get(index);
  if (session.selectedUnitId !== null && attackTarget !== undefined) {
    const unitId = session.selectedUnitId;
    if (submit({ type: 'attack', unitId, targetId: attackTarget }) !== null) {
      const isCity = session.state.cities.some((city) => city.id === attackTarget);
      note(isCity ? '已攻城（削城墙耐久）' : '已攻击');
    }
    renderNow(); // 保留选择：面板刷新 HP / 已攻击旗标（高亮由 legalActions 重算）
    return;
  }

  const unit = session.state.units.find((other) => other.x === x && other.y === y && other.owner === PLAYER_IDX);
  if (unit !== undefined && (viewCell === undefined || viewCell.visibility !== 'hidden')) {
    // 3) 点资源格（单位在格上）→ harvest；领土 / 科技门槛由 core §2 谓词裁定
    if (tile.resource !== null && tile.resource !== undefined) {
      const label = RESOURCE_LABELS[tile.resource] ?? tile.resource;
      if (submit({ type: 'harvest', unitId: unit.id }) !== null) note(`已采集 ${label}`);
    }
    session.selectedUnitId = unit.id;
    session.selectedCityId = null;
    renderNow();
    return;
  }

  // 4) 点己方城 → 面板（训练 / 升级 / 研究，可选项按 legalActions 过滤）
  const city = ownCityAt(x, y);
  if (city !== undefined && (viewCell === undefined || viewCell.visibility !== 'hidden')) {
    session.selectedCityId = city.id;
    session.selectedUnitId = null;
    renderNow();
    return;
  }

  // 5) 可见敌军 / 中立村提示；其余点击 = 取消选择
  const enemy = viewCell?.enemyUnits;
  if (enemy !== undefined && enemy.length > 0) {
    const first = enemy[0];
    session.status = `⚔️ 可见敌军：${UNIT_LABELS[first.type] ?? first.type} HP ${first.hp} —— 选中己方单位后点红框攻击`;
  } else if (tile.village && viewCell !== undefined && viewCell.visibility !== 'hidden') {
    session.status = '中立村庄：派单位踩上去即占领';
  } else {
    session.status = session.mode === 'vs' ? '你的回合：点己方单位或首都开始' : '点击己方单位或首都开始';
  }
  clearSelection();
  renderNow();
}

// ── bot 回合（Phase 12 第 3 步）：人类 endTurn → botAction 逐步执行 → bot endTurn → 人类 ──

/**
 * bot 每步种子（合法化说明）：core/src/bot.ts 要求 `0..2^53−1` 的整数、`level ∈ {0,1}`。
 * 取 **世界种子 ⊕ 当前回合号**：起始屏把世界种子限定在 `0..2^31−1`（SEED_MAX），回合号远小于
 * 该域，32 位 XOR 后 `>>> 0` 归一为无符号 → 必落在 botAction 允许域。
 * 同局同回合 → 同种子（步间动作差异来自 legalActions 池收缩与状态变化，非随机源）。
 */
function botSeed(): number {
  return (session.seed ^ session.state.turn) >>> 0;
}

function startBotTurn(): void {
  if (session.mode === 'vs' && session.winner === null && session.state.currentPlayer !== PLAYER_IDX) {
    session.botBusy = true;
    session.botSteps = 0;
  }
  renderNow();
  if (session.botBusy) window.setTimeout(botStep, BOT_STEP_MS);
}

function botStep(): void {
  // 定时器可能在切模式 / 结算后触发 → 先把关（会话被重开即作废）
  if (session.mode !== 'vs' || !session.botBusy || session.winner !== null) return;
  session.botSteps += 1;
  const explored = exploredPairs(session.botExplored);
  const action = coreGuard<Action | null>(
    () => botAction(session.state, CONTENT, { explored }, botSeed(), 1),
    null,
  );
  if (action === null) {
    endBotTurn('botAction 未给出动作（返回 null 或 core 抛错，见状态栏）');
    return;
  }
  if (session.botSteps > BOT_STEP_CAP) {
    endBotTurn(`bot 单回合步数达上限 ${BOT_STEP_CAP}`);
    return;
  }
  const result = coreGuard<ApplyResult | null>(
    () => applyAction(session.state, action, CONTENT, { explored }),
    null,
  );
  if (result === null) {
    endBotTurn('bot 动作触发 core 抛错（见状态栏）');
    return;
  }
  if (result.rejected) {
    // legalActions 出身 + 同一迷雾输入 → 不应被拒；防御性强制收束，原因原样上屏
    endBotTurn(`bot 动作被 core 拒绝：${result.reason}`);
    return;
  }
  session.state = result.state;
  if (result.winner !== null && session.winner === null) {
    session.winner = result.winner;
    session.status =
      result.winner === PLAYER_IDX ? '🏆 征服胜利：你已占领全部首都' : '💀 被征服：Bot 占领了你的全部首都';
  }
  accumulateVisibleFor(BOT_IDX);
  if (session.winner !== null) {
    session.botBusy = false;
    renderNow();
    return;
  }
  if (action.type === 'endTurn') {
    session.botBusy = false;
    session.status = `你的回合（回合 ${session.state.turn}）`;
    renderNow();
    return;
  }
  renderNow(); // 步进可视：每步刷新地图（bot 动作 150ms 一拍）
  window.setTimeout(botStep, BOT_STEP_MS);
}

/** 步数上限 / 异常时强制结束 bot 回合（500 步强制 endTurn + 告警上屏） */
function endBotTurn(reason: string): void {
  const result = coreGuard<ApplyResult | null>(
    () => applyAction(session.state, { type: 'endTurn' }, CONTENT, { explored: exploredPairs(session.botExplored) }),
    null,
  );
  session.botBusy = false;
  if (result === null) {
    // coreGuard 已把抛错写进状态栏 → 追加告警而不是覆盖，两条报告都在
    session.status = `⚠ ${reason}；强制结束回合同样被 core 拦截 —— ${session.status}`;
  } else if (result.rejected) {
    session.status = `⚠ ${reason}；强制结束回合被拒：${result.reason}`;
  } else {
    session.state = result.state;
    if (result.winner !== null && session.winner === null) {
      session.winner = result.winner;
      session.status =
        result.winner === PLAYER_IDX ? '🏆 征服胜利：你已占领全部首都' : '💀 被征服：Bot 占领了你的全部首都';
    } else {
      session.status = `⚠ ${reason} —— 已强制结束 bot 回合`;
    }
    accumulateVisibleFor(BOT_IDX);
  }
  renderNow();
}

// ── 事件接线 ──

const handlers: Handlers = {
  onTile,
  onEndTurn() {
    if (!humanActive()) {
      renderNow();
      return;
    }
    const before = stars();
    if (submit({ type: 'endTurn' }) === null) {
      renderNow();
      return;
    }
    clearSelection();
    session.newCities.clear(); // 新占领标记只保留到本回合结束（表现层）
    if (session.mode === 'vs') {
      note(`回合 ${session.state.turn} 结束：⭐ ${before} → ${stars()}｜Bot 行动中…`);
      startBotTurn(); // 内部 renderNow + 调度（淘汰跳过 bot 时只刷新）
      return;
    }
    note(`回合 ${session.state.turn}：⭐ ${before} → ${stars()}`);
    renderNow();
  },
  onTrain(unitType) {
    if (!humanActive()) {
      renderNow();
      return;
    }
    const city = activeCity();
    if (city === undefined) return;
    const before = stars();
    if (submit({ type: 'train', cityId: city.id, unitType }) === null) {
      renderNow();
      return;
    }
    note(`已训练 ${UNIT_LABELS[unitType] ?? unitType}（⭐ ${before} → ${stars()}）`);
    renderNow();
  },
  onUpgrade(choice) {
    if (!humanActive()) {
      renderNow();
      return;
    }
    const city = activeCity();
    if (city === undefined) return;
    if (submit({ type: 'upgradeCity', cityId: city.id, choice }) === null) {
      renderNow();
      return;
    }
    note(`已升级：${choice === 'stars5' ? '金库 +5 ⭐' : choice === 'workshop' ? '工坊' : '城墙'}`);
    renderNow();
  },
  onResearch(techId) {
    if (!humanActive()) {
      renderNow();
      return;
    }
    const before = stars();
    if (submit({ type: 'research', techId }) === null) {
      renderNow();
      return;
    }
    note(`已研究 ${TECH_LABELS[techId] ?? techId}（⭐ ${before} → ${stars()}）`);
    renderNow();
  },
  onHarvest() {
    if (!humanActive()) {
      renderNow();
      return;
    }
    const unit = unitById(session.selectedUnitId);
    if (unit === undefined) return;
    const tile = session.state.tiles[unit.y][unit.x];
    const resourceId = tile.resource ?? '';
    if (submit({ type: 'harvest', unitId: unit.id }) !== null) {
      note(`已采集 ${RESOURCE_LABELS[resourceId] ?? resourceId}`);
    }
    renderNow();
  },
  onOverlayClose() {
    session.overlayClosed = true;
    session.status =
      session.winner !== null
        ? '对局结束（征服）—— 棋盘已冻结，点「新局」再来一局'
        : '沙盒目标达成 —— 随意继续';
    renderNow();
  },
  onStartVs() {
    readSeedInput();
    startMode('vs');
  },
  onStartSandbox() {
    startMode('sandbox');
  },
  onSeedNext() {
    readSeedInput();
    const current = parseSeed(session.seedInput);
    const next = current === null ? DEFAULT_SEED : (current + 1) % (SEED_MAX + 1);
    session.seedInput = String(next);
    session.startError = null;
    renderNow(); // 起始屏（mode = null）
  },
  onRestart() {
    // 新局 / 回到模式选择屏：作废在途 bot 定时器（botStep 的 mode/botBusy 把关）
    session.mode = null;
    session.botBusy = false;
    session.startError = null;
    session.legal = [];
    clearSelection();
    renderNow();
  },
};

// ── ViewModel 组装 ──

function buildModel(): ViewModel {
  const state = session.state;
  const player = state.players[PLAYER_IDX];
  const territory = territoryColors(state);
  const reachableKeys = new Set(session.reachableCells.map((cell) => cell.y * MAP_W + cell.x));
  const attackKeys = new Set(session.attackTargets.keys());
  const selectedUnit = unitById(session.selectedUnitId);
  const humanTurn = humanActive();
  const frozen = freezeReason();

  const cells: CellModel[] = session.view.map((viewCell, index) => {
    const x = index % MAP_W;
    const y = Math.floor(index / MAP_W);
    const tile = state.tiles[y][x];
    // 己方单位全局已知；敌方单位仅 viewFor 的 enemyUnits（visible 格）→ 不泄漏雾下信息
    const ownUnit = state.units.find((other) => other.x === x && other.y === y && other.owner === PLAYER_IDX);
    const viewEnemy = ownUnit === undefined ? viewCell.enemyUnits?.[0] : undefined;
    const enemyUnit = viewEnemy === undefined ? undefined : state.units.find((other) => other.id === viewEnemy.id);
    const unit = ownUnit ?? enemyUnit;
    const cityId = viewCell.building?.cityId ?? null;
    const city = cityId === null ? undefined : state.cities.find((entry) => entry.id === cityId);
    const cityMine = city !== undefined && city.owner === PLAYER_IDX && viewCell.visibility !== 'hidden';
    const home = ownUnit?.homeCity ?? null;
    const homeStyle = home === null ? null : session.cityStyle.get(home) ?? null;
    const inTerritory = territory.has(index) && viewCell.visibility !== 'hidden';
    const enemy = unit !== undefined && unit.owner !== PLAYER_IDX;
    return {
      x,
      y,
      visibility: viewCell.visibility,
      terrain: viewCell.terrain,
      resource: viewCell.resource ?? null,
      village: tile.village && viewCell.visibility !== 'hidden',
      city: city === undefined ? null : city.isCapital ? 'capital' : 'city',
      cityColor: cityMine ? cityStyle(city.id).color : null,
      cityNew: cityMine && session.newCities.has(city.id),
      unit:
        unit === undefined
          ? null
          : {
              id: unit.id,
              type: unit.type,
              hp: unit.hp,
              // 敌方行动状态不可知 → 恒 false（不泄漏信息）
              acted: enemy ? false : unit.moved || unit.attacked || unit.healed,
              enemy,
              homeTag: enemy ? null : homeStyle?.tag ?? null,
              homeColor: enemy ? null : homeStyle?.color ?? null,
            },
      inTerritory,
      territoryColor: inTerritory ? territory.get(index) ?? null : null,
      reachable: reachableKeys.has(index),
      attack: attackKeys.has(index),
      selected: ownUnit !== undefined && ownUnit.id === session.selectedUnitId,
    };
  });

  const city = activeCity();
  const legalKeys = new Set(session.legal.map(actionKey));
  /** 面板按钮可点性：legalActions 命中 → 可点；否则上屏 core 拒绝原话（冻结时给统一话术） */
  const deny = (action: Action): string | null => {
    if (frozen !== null) return frozen;
    return legalKeys.has(actionKey(action)) ? null : probeRejected(action);
  };
  const unitTypeIds = UNIT_TYPE_ORDER.filter((id) => CONTENT.unitTypes[id] !== undefined);
  const model: ViewModel = {
    mode: session.mode === 'vs' ? 'vs' : 'sandbox',
    seed: session.mode === 'vs' ? session.seed : null,
    stars: player.stars,
    turn: state.turn,
    phaseLabel:
      session.mode === 'vs'
        ? session.botBusy
          ? `🤖 Bot 行动中 · 步 ${session.botSteps}`
          : humanTurn
            ? '⚔ 你的回合'
            : '🤖 Bot 回合'
        : null,
    canEndTurn: humanTurn,
    villages: state.cities.filter((entry) => entry.owner === PLAYER_IDX && !entry.isCapital).length,
    villagesTotal: session.villageTotal,
    exploredPercent: Math.floor((session.explored.size * 100) / TOTAL_CELLS),
    status: session.status,
    warn: eliminationWarn(),
    cells,
    unit:
      selectedUnit === undefined
        ? null
        : (() => {
            const onResource = state.tiles[selectedUnit.y][selectedUnit.x].resource ?? null;
            const home = selectedUnit.homeCity;
            const homeCity = home === null ? undefined : state.cities.find((entry) => entry.id === home);
            const homeTag = home === null ? null : session.cityStyle.get(home)?.tag ?? null;
            return {
              id: selectedUnit.id,
              label: UNIT_LABELS[selectedUnit.type] ?? selectedUnit.type,
              hp: selectedUnit.hp,
              maxHp: CONTENT.unitTypes[selectedUnit.type].hp,
              moved: selectedUnit.moved,
              attacked: selectedUnit.attacked,
              healed: selectedUnit.healed,
              onResource,
              onOwnCity: ownCityAt(selectedUnit.x, selectedUnit.y) !== undefined,
              homeCity: home,
              homeTag,
              homeColor: home === null ? null : session.cityStyle.get(home)?.color ?? null,
              homeLabel:
                homeCity === undefined
                  ? null
                  : `${homeCity.isCapital ? '首都' : '城市'} ${homeTag ?? ''}`.trim(),
              // §2 采集谓词由 core 裁定：探针只取拒绝原因上屏（规则不落在 UI）
              harvestBlocked:
                onResource === null
                  ? null
                  : frozen !== null
                    ? frozen
                    : probeRejected({ type: 'harvest', unitId: selectedUnit.id }),
            };
          })(),
    city:
      city === undefined
        ? null
        : {
            id: city.id,
            label: city.isCapital ? '首都' : '城市',
            level: city.level,
            population: city.population,
            // 升级需人口 = 城级 + 1（core §4.3 upgradeCity，actions.ts 判定为准）—— 仅进度提示
            popNeed: city.level + 1,
            stationed: state.units.filter((unit) => unit.homeCity === city.id).length,
            tag: session.cityStyle.get(city.id)?.tag ?? '?',
            color: session.cityStyle.get(city.id)?.color ?? '#9aa2bd',
            isNew: session.newCities.has(city.id),
            upgrades:
              city === undefined
                ? []
                : UPGRADES.map((upgrade) => ({
                    ...upgrade,
                    blocked: deny({ type: 'upgradeCity', cityId: city.id, choice: upgrade.choice }),
                  })),
          },
    unitTypes: unitTypeIds.map((id) => ({
      id,
      label: UNIT_LABELS[id] ?? id,
      cost: CONTENT.unitTypes[id].cost,
      tech: CONTENT.unitTypes[id].tech ?? null,
      blocked: city === undefined ? null : deny({ type: 'train', cityId: city.id, unitType: id }),
    })),
    techs: TECH_ORDER.filter((id) => CONTENT.techs[id] !== undefined).map((id) => ({
      id,
      label: TECH_LABELS[id] ?? id,
      done: player.techs.includes(id),
      requires: [...CONTENT.techs[id].requires],
      blocked: player.techs.includes(id) || city === undefined ? null : deny({ type: 'research', techId: id }),
    })),
    overlay: overlayModel(),
  };
  return model;
}

/** 覆盖层：征服结算（对战，最高优先）/ 沙盒完成（各只弹一次） */
function overlayModel(): ViewModel['overlay'] {
  if (session.overlayClosed) return null;
  const turn = session.state.turn;
  if (session.winner !== null) {
    const win = session.winner === PLAYER_IDX;
    return win
      ? { title: '🏆 征服胜利！', body: `你已占领全部首都 · 用时 ${turn} 回合`, button: '查看棋盘' }
      : { title: '💀 战败', body: `Bot 占领了你的全部首都 · 用时 ${turn} 回合`, button: '查看棋盘' };
  }
  if (session.celebrated && session.mode === 'sandbox') {
    return {
      title: '🎉 完成！',
      body: `探索 100% · 占领全部 ${session.villageTotal} 座村庄 · 用时 ${turn} 回合`,
      button: '继续探索',
    };
  }
  return null;
}

function renderNow(): void {
  const root = document.getElementById('app');
  if (root === null) throw new Error('demo: 缺少 #app 容器');
  if (session.mode === null) {
    const model: StartModel = { seed: session.seedInput, error: session.startError };
    renderStart(root, model);
    return;
  }
  refreshView();
  session.legal = computeLegal();
  recomputeHighlights();
  render(root, buildModel());
}

// ── 模式启动（Phase 12 第 1 步） ──

function parseSeed(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value <= SEED_MAX ? value : null;
}

function readSeedInput(): void {
  const input = document.getElementById('seedInput') as HTMLInputElement | null;
  if (input !== null) session.seedInput = input.value;
}

function startMode(mode: Mode): void {
  if (mode === 'vs') {
    const seed = parseSeed(session.seedInput);
    if (seed === null) {
      session.startError = `种子须是 0..${SEED_MAX} 的整数（当前输入：${session.seedInput}）`;
      renderNow();
      return;
    }
    const result = createVsInitialState(seed);
    if (!result.ok) {
      session.startError = result.reason;
      renderNow();
      return;
    }
    session.state = result.setup.state;
    session.seed = seed;
    session.villageTotal = result.setup.villageTotal;
    session.status = `对战开始 · 你先手（种子 ${seed}，worldgen 尝试 ${result.setup.attempts} 次）`;
  } else {
    session.state = createInitialState();
    session.villageTotal = VILLAGE_TOTAL;
    session.status = '点击己方单位或首都开始';
  }
  session.mode = mode;
  session.startError = null;
  session.explored = new Set<number>();
  session.botExplored = new Set<number>();
  session.legal = [];
  session.celebrated = false;
  session.overlayClosed = false;
  session.winner = null;
  session.botBusy = false;
  session.botSteps = 0;
  session.cityStyle = new Map<string, { color: string; tag: string }>();
  session.seenCities = new Set<string>();
  session.newCities = new Set<string>();
  clearSelection();
  // 开局迷雾：双方各自累计本方视野（§4.5 按行动方算）
  accumulateVisibleFor(PLAYER_IDX);
  if (mode === 'vs') accumulateVisibleFor(BOT_IDX);
  syncCityStyles(false); // 首都开局配色，不算新占领
  renderNow();
}

function boot(): void {
  const root = document.getElementById('app');
  if (root === null) throw new Error('demo: 缺少 #app 容器');
  mount(root, handlers);
  renderNow(); // 模式选择屏
}

boot();
