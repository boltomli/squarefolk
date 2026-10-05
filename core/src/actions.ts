/**
 * applyAction —— core-spec §2 动作谓词 + §3.2 单动作管线（Phase 5）。
 *
 * 硬红线（AGENTS.md）：纯函数、仅整数运算，禁随机 / 浮点中间值 / 系统时间 / I/O；
 * 可调常数全部来自 data/balance.json（capitalBonus / healHome / healAway / promotion.kills /
 * elimination.eliminationGraceTurns）。
 *
 * 结构（§3.2）：谓词（§2）全部通过 → 克隆态落地 → 胜利检查 → actionLog 追加。
 * - 拒绝 = 输入状态零变化：先克隆、仅在克隆态上写，拒绝即弃用克隆态（runner 以前后
 *   规范化序列化相等断言，§6 行 483「rejected: true 时其余字段全不校验」）。
 * - 动作身份 = state.currentPlayer（§6 action 型夹具无 player 字段；联机身份由传输层归属）。
 * - 迷雾不入 State（§1 行 47）：move 的 hidden 判定由调用方经 options.explored 按行动玩家传入。
 * - 内容三件（unitTypes / techs / resources）注入（§6 行 478：运行时来自 data 层）。
 * - 派生量（besieged / 领地 / 可达 / 视野）一律现算，不落状态（§1 行 47）。
 * - 任何动作后立即执行 §4.7 征服检查与淘汰同步（§3.2 检查点），胜者随结果返回。
 *
 * 规格层备注（不改 docs / testdata，随交付报告）：
 * - §2 行 61 train 载荷键 `type` 与 §6 行 461 动作判别键 `type` 同名 —— 夹具以重复键表达，
 *   Action 侧将载荷兵种定名 `unitType`，runner 按原文本恢复（见 turn-vector-runner）。
 * - attack 的 cityId 目标依赖 D6 破城分支（§4.4 未定案）→ 拒绝而非发明语义。
 */
import balance from '../../data/balance.json';
import { resolveCombat, type UnitBase } from './combat';
import { reachable, type MapFixture } from './movement';
import { owningCity, resolveBorderRadius, type TerritoryCity } from './territory';
import { visibleCellsFor } from './vision';
import type { City, State, Tile, Unit } from './state';

// ── 内容层注入（§6 行 478：夹具内联，运行时来自 units.json / techs.json / resources） ──

/** 兵种类型（units.json 行段）；canAttackAfterMove / killSwap / tech 为可选数据字段 */
export interface UnitTypeDef {
  cost: number;
  hp: number;
  atk10: number;
  def10: number;
  move: number;
  range: number;
  counter: readonly [number, number];
  /** §4.1-G T6：走打一体 true（默认）、架设型 false（投石）移动后不可攻击 */
  canAttackAfterMove?: boolean;
  /** §4.1-D：近战补位字段；缺省 = v1 约定「近战 true、远程 false」→ range ≤ 1 */
  killSwap?: boolean;
  /** §2「type 已解锁」的科技门槛；内容数据未声明关联 = 无门槛 */
  tech?: string;
}

/** 科技定义（techs.json 行段）：cost = tier × 城市数 + 4（§4.3），requires = 同分支前序 */
export interface TechDef {
  tier: number;
  requires: readonly string[];
}

/** 资源定义（resources 行段）：按 data 一次性给人口或星星（§4.3 采集） */
export interface ResourceDef {
  effect: 'pop' | 'stars';
  amount: number;
  /** §2 harvest「科技已解锁」的科技门槛；内容数据未声明关联 = 无门槛 */
  tech?: string;
}

/** 内容三件（动作管线的数据侧输入） */
export interface ActionContext {
  unitTypes: Record<string, UnitTypeDef>;
  techs: Record<string, TechDef>;
  resources: Record<string, ResourceDef>;
}

/**
 * 动作对象（§6 action 型：判别键 type + 载荷字段扁平平铺）。
 * §2 行 61 train 载荷键 `type` 与判别键同名 → 夹具以重复键表达，载荷兵种映射到 `unitType`。
 */
export interface Action {
  type: string;
  unitId?: string;
  x?: number;
  y?: number;
  targetId?: string;
  cityId?: string;
  unitType?: string;
  techId?: string;
  choice?: string;
}

export interface ApplyOptions {
  /** 行动玩家的已探索格 [y,x]（§1 行 47：迷雾不入 State）；缺省或 [] = 全图已探索（§6 约定） */
  explored?: readonly (readonly number[])[] | null;
}

export type ApplyResult =
  | { rejected: false; state: State; winner: number | null }
  | { rejected: true; reason: string };

// ── 地形 id ↔ §6 图例（terrain.json 未入库 → 代码级映射；id 沿用既有 State 测试约定） ──

const LEGEND_BY_TERRAIN: Readonly<Record<string, string>> = {
  plain: '.',
  forest: 'f',
  mountain: 'm',
  swamp: 's',
  water: 'w',
};

const TERRAIN_BY_LEGEND: Readonly<Record<string, string>> = {
  '.': 'plain',
  f: 'forest',
  m: 'mountain',
  s: 'swamp',
  w: 'water',
};

/** §6 地形图例字符 → State 地形 id（夹具装配用；未知图例 throw） */
export function terrainIdFromLegend(legend: string): string {
  const terrain = TERRAIN_BY_LEGEND[legend];
  if (terrain === undefined) {
    throw new Error(`未知地形图例 "${legend}"（§6 图例：. f m s w）`);
  }
  return terrain;
}

/** State 地形 id → §6 图例（可达集 MapFixture 装配用；未知 id throw） */
export function terrainLegendFromId(terrain: string): string {
  const legend = LEGEND_BY_TERRAIN[terrain];
  if (legend === undefined) {
    throw new Error(`未知地形 id "${terrain}"`);
  }
  return legend;
}

const economy = balance.economy;
const promotion = balance.promotion;

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** §0 切比雪夫距离 max(|dx|,|dy|) */
function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax > bx ? ax - bx : bx - ax;
  const dy = ay > by ? ay - by : by - ay;
  return dx > dy ? dx : dy;
}

function findUnit(state: State, id: string): Unit | undefined {
  return state.units.find((unit) => unit.id === id);
}

function findCity(state: State, id: string): City | undefined {
  return state.cities.find((city) => city.id === id);
}

/** content 查表：state 引用的兵种必须在 unitTypes 中（缺 = 内容数据损坏 → 抛错，不静默拒绝） */
function requireUnitType(ctx: ActionContext, type: string): UnitTypeDef {
  const typeDef = ctx.unitTypes[type];
  if (typeDef === undefined) {
    throw new Error(`unitTypes: 状态引用的兵种 ${type} 不在内容数据中`);
  }
  return typeDef;
}

/**
 * §1 行 47 id 生成：前缀 + 六位零填充十进制，序号 = 现有同前缀 id 的最大数值后缀 + 1
 * （纯状态导出、无隐藏计数器；村庄占领建城、训练造兵同用）。
 */
function nextId(items: readonly { id: string }[], prefix: string): string {
  let max = 0;
  for (const item of items) {
    if (!item.id.startsWith(prefix)) continue;
    const suffix = item.id.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) continue;
    const value = Number(suffix);
    if (Number.isSafeInteger(value) && value > max) max = value;
  }
  return prefix + String(max + 1).padStart(6, '0');
}

/** 按 id 字典序插入，保持 §1 行 26 存储序 */
function insertById<T extends { id: string }>(items: T[], item: T): void {
  const at = items.findIndex((existing) => existing.id > item.id);
  if (at === -1) {
    items.push(item);
  } else {
    items.splice(at, 0, item);
  }
}

function removeUnit(state: State, id: string): void {
  const index = state.units.findIndex((unit) => unit.id === id);
  if (index !== -1) state.units.splice(index, 1);
}

/** §4.4 besieged（衍生量，不入状态）：∃ 敌方单位与城市格 8 向相邻（切比雪夫 = 1） */
function isBesieged(state: State, city: City): boolean {
  for (const unit of state.units) {
    if (unit.owner !== city.owner && chebyshev(unit.x, unit.y, city.x, city.y) === 1) {
      return true;
    }
  }
  return false;
}

/** killSwap 补位的可通行判定（§4.1-D「目标格可进入」；v1 陆地单位不可入水域 §4.2） */
function isPassable(state: State, x: number, y: number): boolean {
  if (y < 0 || y >= state.map.height || x < 0 || x >= state.map.width) return false;
  return state.tiles[y][x].terrain !== 'water';
}

/** State cities → 领地解析（owner = String(players 下标)，radius 按 §4.3 level 表） */
function territoryCities(state: State): TerritoryCity[] {
  return state.cities.map((city) => ({
    id: city.id,
    x: city.x,
    y: city.y,
    owner: String(city.owner),
    radius: resolveBorderRadius(city.level),
  }));
}

/** State tiles → §6 map 型底座（movement.reachable 的夹具接口）；城/村格 cost 1（§6 行 443） */
function mapFixtureOf(state: State, explored: readonly (readonly number[])[] | null): MapFixture {
  const terrain: string[] = [];
  const roads: number[][] = [];
  const cities: number[][] = [];
  for (let y = 0; y < state.map.height; y += 1) {
    let row = '';
    for (let x = 0; x < state.map.width; x += 1) {
      const tile = state.tiles[y][x];
      row += terrainLegendFromId(tile.terrain);
      if (tile.road) roads.push([y, x]);
      if (tile.cityId !== null && tile.cityId !== undefined) cities.push([y, x]);
      else if (tile.village) cities.push([y, x]);
    }
    terrain.push(row);
  }
  return { h: state.map.height, w: state.map.width, terrain, roads, cities, explored: explored ?? [] };
}

// ── 战斗加成派生（§4.1-B；夹具跳过姿态/支援判定，判定属状态级 → 本文件负责运行时汇总） ──

/**
 * §4.1-B 攻侧加成（攻击输出方）：夹击 = 相对被打击格的 180° 对侧邻格有本方单位（design §3.4：
 * 「另一敌方单位位于 180° 相对两侧，仅攻击时判定」）+ 晋升。攻方与反击方各按自身输出调用。
 */
function attackBoni(state: State, attacker: Unit, struck: Unit): string[] {
  const boni: string[] = [];
  const dx = attacker.x - struck.x;
  const dy = attacker.y - struck.y;
  if (dx !== 0 || dy !== 0) {
    // 8 向轴线（共线）才算 180° 对侧；对侧邻格 = struck 反向退一格
    if (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) {
      const cx = struck.x - Math.sign(dx);
      const cy = struck.y - Math.sign(dy);
      const flanker = state.units.some((unit) => unit.owner === attacker.owner && unit.x === cx && unit.y === cy);
      if (flanker) boni.push('flank');
    }
  }
  if (attacker.promoted) boni.push('promotion');
  return boni;
}

/**
 * §4.1-B 防侧加成（被打击方）：地形 / 城（未被围）/ 墙（耐久未耗尽 ⇔ hasWall）/ 防御姿态 /
 * 支援（每邻接友军，合计封顶由 balance 处理）/ 晋升。
 * `stanceAllowed`：防御姿态 = 上一回合未行动（design §3.4「本回合一行动即失去」）——
 * 守方本回合不在行动 → 允许按旗判定；主动攻击方永远不允许。
 */
function defenseBoni(state: State, unit: Unit, stanceAllowed: boolean): string[] {
  const boni: string[] = [];
  const tile = state.tiles[unit.y][unit.x];
  if (tile.terrain === 'forest') boni.push('terrain_forest');
  if (tile.terrain === 'mountain') boni.push('terrain_mountain');
  if (tile.cityId !== null && tile.cityId !== undefined) {
    const city = findCity(state, tile.cityId);
    if (city !== undefined) {
      if (!isBesieged(state, city)) boni.push('city');
      if (city.hasWall) boni.push('wall');
    }
  }
  if (stanceAllowed && !unit.moved && !unit.attacked) boni.push('stance_defensive');
  let supports = 0;
  for (const other of state.units) {
    if (other.owner === unit.owner && chebyshev(other.x, other.y, unit.x, unit.y) === 1) supports += 1;
  }
  for (let i = 0; i < supports; i += 1) boni.push('support_each');
  if (unit.promoted) boni.push('promotion');
  return boni;
}

function combatBase(typeDef: UnitTypeDef, unit: Unit): UnitBase {
  if (!isInt(typeDef.atk10) || !isInt(typeDef.def10) || !isInt(typeDef.hp) || typeDef.hp < 0) {
    throw new Error(`unitTypes[${unit.type}]: atk10/def10/hp 非法`);
  }
  return { atk10: typeDef.atk10, def10: typeDef.def10, hp: unit.hp, maxHp: typeDef.hp, counter: typeDef.counter };
}

// ── §3.1 回合阶段 ──

/** §3.1 prep：清本方旗 → 收入（cities id 序；被围归零）→ phase = act */
function prep(state: State): void {
  for (const unit of state.units) {
    if (unit.owner === state.currentPlayer) {
      unit.moved = false;
      unit.attacked = false;
      unit.healed = false;
    }
  }
  const player = state.players[state.currentPlayer];
  for (const city of state.cities) {
    if (city.owner !== state.currentPlayer || isBesieged(state, city)) continue;
    player.stars += city.level + (city.hasWorkshop ? 1 : 0) + (city.isCapital ? economy.capitalBonus : 0);
  }
  state.phase = 'act';
}

/**
 * §3.2 胜利检查（任何动作后立即执行）：
 * - 征服（§4.7）：某玩家拥有全场全部 isCapital 城 → winner = 其 players 下标；否则 null
 * - 淘汰标记不再在此同步（§1 行 45 已改单向 eliminated ⇒ 无城市）：无城先进 §4.7 宽限
 *   （noCityTurns 计数在 endTurn commit-2），达阈值才在提交阶段置 eliminated。
 */
function checkVictory(state: State): number | null {
  const capitals = state.cities.filter((city) => city.isCapital);
  if (capitals.length === 0) return null;
  const owner = capitals[0].owner;
  return capitals.every((city) => city.owner === owner) ? owner : null;
}

/** actionLog.payload = §2 载荷字段（去掉动作判别键 type） */
function payloadOf(action: Action): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(action)) {
    if (key !== 'type' && value !== undefined) payload[key] = value;
  }
  return payload;
}

/**
 * 单动作管线（§2 谓词 → §3.2 落地）：谓词全过才写克隆态，拒绝即弃用克隆态 → 输入零变化。
 * 返回后继状态与 §4.7 征服检查结果；被拒绝时无后继。
 */
export function applyAction(
  state: State,
  action: Action,
  ctx: ActionContext,
  options?: ApplyOptions,
): ApplyResult {
  const reject = (reason: string): ApplyResult => ({ rejected: true, reason });
  // §2 公共前置：phase == act；动作身份 = currentPlayer（夹具无 player 字段，见文件头）
  if (state.phase !== 'act') return reject(`phase=${String(state.phase)}，非 act（§2 公共前置）`);
  if (action === null || typeof action !== 'object' || typeof action.type !== 'string') {
    return reject('payload: 动作对象缺 type');
  }
  const actor = state.currentPlayer;
  const next = structuredClone(state);
  const player = next.players[actor];

  switch (action.type) {
    case 'move': {
      const { unitId, x, y } = action;
      if (typeof unitId !== 'string') return reject('payload: move.unitId 缺失');
      if (!isInt(x) || !isInt(y)) return reject('payload: move.x/y 非整数');
      const unit = findUnit(next, unitId);
      if (unit === undefined) return reject(`move: 单位 ${unitId} 不存在`);
      if (unit.owner !== actor) return reject('move: 单位非本方（§2 公共前置）');
      if (unit.moved || unit.attacked || unit.healed) {
        return reject('move: !moved && !attacked && !healed 不满足（§2）');
      }
      const typeDef = requireUnitType(ctx, unit.type);
      // §2「目标可达（§4.2）」：可达集已含占位 / 非 hidden / ZOC / 粗地形过滤
      const dests = reachable(
        { id: unit.id, owner: String(unit.owner), x: unit.x, y: unit.y, move: typeDef.move },
        mapFixtureOf(next, options?.explored ?? null),
        next.units.map((other) => ({
          id: other.id,
          owner: String(other.owner),
          x: other.x,
          y: other.y,
          move: ctx.unitTypes[other.type]?.move ?? 0,
        })),
      );
      if (!dests.some((dest) => dest.x === x && dest.y === y)) return reject('move: 目标不可达（§4.2 可达集）');
      unit.x = x;
      unit.y = y;
      unit.moved = true; // §2 后效
      const tile = next.tiles[y][x];
      if (tile.village) captureVillage(next, unit, tile); // §4.2 进入即结算
      break;
    }

    case 'attack': {
      const { unitId, targetId } = action;
      if (typeof unitId !== 'string') return reject('payload: attack.unitId 缺失');
      if (typeof targetId !== 'string') return reject('payload: attack.targetId 缺失');
      const attacker = findUnit(next, unitId);
      if (attacker === undefined) return reject(`attack: 单位 ${unitId} 不存在`);
      if (attacker.owner !== actor) return reject('attack: 单位非本方（§2 公共前置）');
      if (attacker.attacked || attacker.healed) return reject('attack: !attacked && !healed 不满足（§2）');
      const atkType = requireUnitType(ctx, attacker.type);
      // §2 行 64：架设型需 !moved —— canAttackAfterMove 默认 true（§4.1-G 字段默认）
      if ((atkType.canAttackAfterMove ?? true) === false && attacker.moved) {
        return reject('attack: 架设型单位移动后不可攻击（§4.1-G T6）');
      }
      const target = findUnit(next, targetId);
      if (target === undefined) {
        if (findCity(next, targetId) !== undefined) {
          return reject('attack: 攻城目标（cityId）依赖 D6 破城分支，未定案（§4.4 红线）');
        }
        return reject(`attack: 目标 ${targetId} 不存在`);
      }
      if (target.owner === actor) return reject('attack: 目标须为敌方（§2）');
      if (target.hp <= 0) return reject('attack: hp = 0 单位不可被选为攻击目标（§5）');
      if (!isInt(atkType.range)) throw new Error(`unitTypes[${attacker.type}].range 非法`);
      if (chebyshev(attacker.x, attacker.y, target.x, target.y) > atkType.range) {
        return reject('attack: 目标超出射程（§2 切比雪夫 ≤ range）');
      }
      // §2 目标「可见」：行动玩家的视野源并集（§4.5；content 山地 id = terrain.mountain 约定值）
      const visible = visibleCellsFor(actor, next, 'mountain');
      if (!visible.some((coord) => coord.x === target.x && coord.y === target.y)) {
        return reject('attack: 目标不可见（§4.1-E / §4.5）');
      }
      const defType = requireUnitType(ctx, target.type);
      const result = resolveCombat(
        {
          base: combatBase(atkType, attacker),
          boni: [...attackBoni(next, attacker, target), ...defenseBoni(next, attacker, false)],
        },
        {
          base: combatBase(defType, target),
          boni: [...attackBoni(next, target, attacker), ...defenseBoni(next, target, true)],
        },
      );
      // §4.1-D：伤害落地 → 存活判定 → 反击落地 → 击杀结算 → 攻方 acted
      attacker.hp = result.attackerHpAfter;
      target.hp = result.defenderHpAfter;
      attacker.attacked = true;
      if (result.defenderDied) {
        removeUnit(next, target.id);
        // killSwap（§4.1-D）：目标格可通行且空 → 攻方补位，否则留原地（§5 近战补位受阻）
        const killSwap = atkType.killSwap ?? atkType.range <= 1;
        if (killSwap && isPassable(next, target.x, target.y)) {
          attacker.x = target.x;
          attacker.y = target.y;
        }
        attacker.kills += 1;
        if (!attacker.promoted && attacker.kills >= promotion.kills) attacker.promoted = true; // §4.1-D
      }
      break;
    }

    case 'train': {
      const { cityId, unitType } = action;
      if (typeof cityId !== 'string') return reject('payload: train.cityId 缺失');
      if (typeof unitType !== 'string') return reject('payload: train.unitType 缺失');
      const city = findCity(next, cityId);
      if (city === undefined) return reject(`train: 城市 ${cityId} 不存在`);
      if (city.owner !== actor) return reject('train: 城市非本方（§2 公共前置）');
      if (isBesieged(next, city)) return reject('train: 被围城不可训练（§2 / §4.4）');
      const stationed = next.units.filter((unit) => unit.homeCity === city.id).length;
      if (stationed >= city.level) {
        return reject(`train: 驻留 ${stationed} ≥ 容量 level ${city.level}（§2 / §4.2.3）`);
      }
      const typeDef = ctx.unitTypes[unitType];
      if (typeDef === undefined) return reject(`train: 兵种 ${unitType} 未知（§2 type 已解锁）`);
      if (typeDef.tech !== undefined && !player.techs.includes(typeDef.tech)) {
        return reject(`train: 科技 ${typeDef.tech} 未解锁（§2 type 已解锁）`);
      }
      if (!isInt(typeDef.cost) || typeDef.cost < 0) throw new Error(`unitTypes[${unitType}].cost 非法`);
      if (player.stars < typeDef.cost) {
        return reject(`train: stars ${player.stars} < cost ${typeDef.cost}（§2）`);
      }
      if (next.units.some((unit) => unit.x === city.x && unit.y === city.y)) {
        return reject('train: 城上格被占（§2 行 61 / T2）');
      }
      if (!isInt(typeDef.hp) || typeDef.hp < 0) throw new Error(`unitTypes[${unitType}].hp 非法`);
      const id = nextId(next.units, 'unit.');
      insertById(next.units, {
        id,
        owner: actor,
        type: unitType,
        x: city.x,
        y: city.y,
        hp: typeDef.hp,
        moved: false,
        attacked: false,
        healed: false,
        kills: 0,
        promoted: false,
        homeCity: city.id,
      });
      player.stars -= typeDef.cost;
      break;
    }

    case 'harvest': {
      const { unitId } = action;
      if (typeof unitId !== 'string') return reject('payload: harvest.unitId 缺失');
      const unit = findUnit(next, unitId);
      if (unit === undefined) return reject(`harvest: 单位 ${unitId} 不存在`);
      if (unit.owner !== actor) return reject('harvest: 单位非本方（§2 公共前置）');
      const tile = next.tiles[unit.y][unit.x];
      const resourceId = tile.resource;
      if (resourceId === null || resourceId === undefined) return reject('harvest: 格上无 resource（§2）');
      const def = ctx.resources[resourceId];
      if (def === undefined) throw new Error(`resources: 状态引用的资源 ${resourceId} 不在内容数据中`);
      if (def.tech !== undefined && !player.techs.includes(def.tech)) {
        return reject(`harvest: 科技 ${def.tech} 未解锁（§2）`);
      }
      // §2 / §4.3：格在己方领土（归属 = 最近城 + 半径内），人口落到该格领土归属城
      const owning = owningCity(territoryCities(next), unit.x, unit.y);
      if (owning === null || owning.owner !== String(actor)) {
        return reject('harvest: 目标格不在己方领土（§2 / §4.3）');
      }
      if (!isInt(def.amount) || def.amount < 0) throw new Error(`resources[${resourceId}].amount 非法`);
      tile.resource = null;
      if (def.effect === 'pop') {
        const city = findCity(next, owning.id);
        if (city === undefined) throw new Error(`harvest: 归属城 ${owning.id} 不在 cities 中`);
        city.population += def.amount;
      } else if (def.effect === 'stars') {
        player.stars += def.amount;
      } else {
        throw new Error(`resources[${resourceId}].effect 非法：${String(def.effect)}`);
      }
      break;
    }

    case 'research': {
      const { techId } = action;
      if (typeof techId !== 'string') return reject('payload: research.techId 缺失');
      const def = ctx.techs[techId];
      if (def === undefined) return reject(`research: 科技 ${techId} 未知`);
      if (player.techs.includes(techId)) return reject('research: 已研究（§2 未研究）');
      if (!Array.isArray(def.requires)) throw new Error(`techs[${techId}].requires 非法`);
      for (const required of def.requires) {
        if (!player.techs.includes(required)) return reject(`research: 前置 ${required} 未满足（§2）`);
      }
      if (!isInt(def.tier) || def.tier < 0) throw new Error(`techs[${techId}].tier 非法`);
      const cityCount = next.cities.filter((city) => city.owner === actor).length;
      const cost = def.tier * cityCount + 4; // §4.3：cost = tier × 城市数 + 4
      if (player.stars < cost) return reject(`research: stars ${player.stars} < cost ${cost}（§2）`);
      player.stars -= cost;
      player.techs.push(techId);
      break;
    }

    case 'upgradeCity': {
      const { cityId, choice } = action;
      if (typeof cityId !== 'string') return reject('payload: upgradeCity.cityId 缺失');
      if (choice !== 'workshop' && choice !== 'stars5' && choice !== 'wall') {
        return reject(`upgradeCity: 未知 choice ${String(choice)}（§4.3 三选一）`);
      }
      const city = findCity(next, cityId);
      if (city === undefined) return reject(`upgradeCity: 城市 ${cityId} 不存在`);
      if (city.owner !== actor) return reject('upgradeCity: 城市非本方（§2 公共前置）');
      const need = city.level + 1; // §4.3：升到 level+1 需 population ≥ level+1，等额消耗
      if (city.population < need) {
        return reject(`upgradeCity: population ${city.population} < ${need}（§2）`);
      }
      if (choice === 'wall' && city.hasWall) return reject('upgradeCity: wall 需 !hasWall（§2）');
      city.population -= need;
      city.level += 1;
      if (choice === 'workshop') {
        city.hasWorkshop = true;
      } else if (choice === 'stars5') {
        player.stars += 5;
      } else {
        city.hasWall = true;
        city.wallDurability = 3;
      }
      break;
    }

    case 'heal': {
      const { unitId } = action;
      if (typeof unitId !== 'string') return reject('payload: heal.unitId 缺失');
      const unit = findUnit(next, unitId);
      if (unit === undefined) return reject(`heal: 单位 ${unitId} 不存在`);
      if (unit.owner !== actor) return reject('heal: 单位非本方（§2 公共前置）');
      if (unit.moved || unit.attacked || unit.healed) {
        return reject('heal: !moved && !attacked && !healed 不满足（§2）');
      }
      const typeDef = requireUnitType(ctx, unit.type);
      if (!isInt(typeDef.hp) || typeDef.hp < 0) throw new Error(`unitTypes[${unit.type}].hp 非法`);
      if (unit.hp >= typeDef.hp) return reject('heal: hp 已满（§2 hp < maxHp）');
      // §4.4：被围期间守军不可治疗（守军 = 驻于该城格的单位）
      const garrisonCity = next.cities.find((city) => city.x === unit.x && city.y === unit.y);
      if (garrisonCity !== undefined && isBesieged(next, garrisonCity)) {
        return reject('heal: 被围城守军不可治疗（§4.4）');
      }
      // §2 行 66：本土 +economy.healHome / 境外 +economy.healAway（territory 判定），上限截断
      const owning = owningCity(territoryCities(next), unit.x, unit.y);
      const home = owning !== null && owning.owner === String(unit.owner);
      const amount = home ? economy.healHome : economy.healAway;
      unit.hp = Math.min(typeDef.hp, unit.hp + amount);
      unit.healed = true; // 不破坏防御姿态（moved/attacked 不动）
      break;
    }

    case 'endTurn': {
      // §3.1 commit-1 围城推进：按 cities id 序（存储序）遍历被围城 —— D6 破城分支
      // （§4.4 耐久制 / 血条制）未定案，红线「勿实现破城逻辑」→ 此处仅留确定性遍历结构桩；
      // 无被围城时自然空转，定案后在本循环内推进 wallDurability。
      for (const city of next.cities) {
        if (isBesieged(next, city)) {
          // 结构桩：D6 定案后在此推进被围城耐久
        }
      }
      // §3.1 commit-2 无城宽限计数（T4，§4.7）：提交者无城 → noCityTurns+1，
      // ≥ eliminationGraceTurns → eliminated=true 并移除其全部残余单位；有城 → 归零
      //（占城瞬间的清零见 captureVillage / §4.7）
      if (next.cities.some((city) => city.owner === actor)) {
        player.noCityTurns = 0;
      } else {
        player.noCityTurns += 1;
        if (player.noCityTurns >= balance.elimination.eliminationGraceTurns) {
          player.eliminated = true;
          next.units = next.units.filter((unit) => unit.owner !== actor);
        }
      }
      // §3.1 commit-3：currentPlayer 下移并跳过已淘汰玩家（提交者自身被淘汰则继续下移）；
      // 越过末位 → turn += 1 → 回 prep（count 步内至多回绕一次，保证终止）
      let target = next.currentPlayer;
      for (let step = 0; step < next.players.length; step += 1) {
        target += 1;
        if (target >= next.players.length) {
          target = 0;
          next.turn += 1;
        }
        if (!next.players[target].eliminated) break;
      }
      next.currentPlayer = target;
      prep(next); // §3.1 commit-3 尾：下一玩家的 prep（清旗 + 收入 + phase = act）
      break;
    }

    default:
      return reject(`applyAction: 未知动作类型 "${action.type}"（§2 动作表）`);
  }

  // §3.2 尾序：胜利与淘汰检查 → actionLog 追加（seq 连续无洞）
  const winner = checkVictory(next);
  next.actionLog.push({
    seq: next.actionLog.length,
    player: actor,
    type: action.type,
    payload: payloadOf(action),
  });
  return { rejected: false, state: next, winner };
}

/** §4.2 进入即结算：中立村庄 → 新城市（level1 / pop0 / isCapital=false；§1 行 47 id 生成）。
 * 一次性村庄奖励按 data（villages.json 未入库），core 不发数。
 * §4.7：占下任何城 → noCityTurns 即时清零（领地随新城恢复）。 */
function captureVillage(state: State, unit: Unit, tile: Tile): void {
  tile.village = false;
  const id = nextId(state.cities, 'city.');
  tile.cityId = id;
  insertById(state.cities, {
    id,
    x: unit.x,
    y: unit.y,
    owner: unit.owner,
    level: 1,
    population: 0,
    hasWorkshop: false,
    hasWall: false,
    wallDurability: 0,
    isCapital: false,
  });
  state.players[unit.owner].noCityTurns = 0;
}
