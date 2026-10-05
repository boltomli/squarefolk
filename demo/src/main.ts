/**
 * demo 壳层：会话状态 + 事件 → core API 调用 + ViewModel 组装。
 *
 * 分工（core-spec §1 行 47 / 任务约束）：
 * - 规则判定只走 core：applyAction（§2 谓词 + §3.2 结算）、reachable（§4.2）、
 *   viewFor / visibleCellsFor（§4.5 三态）、territoryGrid / resolveBorderRadius（§4.3）
 * - 壳层职责：初始 State 构造（map.ts）、explored 迷雾历史累积（不入 State）、视图裁剪与渲染
 */
import { applyAction, terrainLegendFromId, type Action } from '../../core/src/actions';
import { reachable, type Coord, type MapFixture } from '../../core/src/movement';
import { resolveBorderRadius, territoryGrid, type TerritoryCity } from '../../core/src/territory';
import { viewFor, visibleCellsFor, type ViewTile } from '../../core/src/vision';
import type { State } from '../../core/src/state';
import { CONTENT, RESOURCE_LABELS, TECH_LABELS, TECH_ORDER, UNIT_LABELS, UNIT_TYPE_ORDER } from './config';
import { MAP_H, MAP_W, PLAYER_IDX, VILLAGE_TOTAL, createInitialState } from './map';
import { mount, render, type CellModel, type Handlers, type ViewModel } from './ui';

/** content 层山地地形 id（viewFor 注入参数，同 core 惯例） */
const MOUNTAIN_TERRAIN_ID = 'mountain';
const TOTAL_CELLS = MAP_W * MAP_H;

interface Session {
  state: State;
  /** 已探索历史位图（key = y × MAP_W + x；壳侧累积，不入 State） */
  explored: Set<number>;
  view: ViewTile[];
  selectedUnitId: string | null;
  selectedCityId: string | null;
  reachableCells: Coord[];
  status: string;
  celebrated: boolean;
  overlay: boolean;
}

const session: Session = {
  state: createInitialState(),
  explored: new Set<number>(),
  view: [],
  selectedUnitId: null,
  selectedCityId: null,
  reachableCells: [],
  status: '点击己方单位或首都开始',
  celebrated: false,
  overlay: false,
};

function exploredList(): number[][] {
  return [...session.explored].sort((a, b) => a - b).map((key) => [Math.floor(key / MAP_W), key % MAP_W]);
}

/** §4.5：visible 并入 explored 历史（一旦成立不回退） */
function accumulateVisible(): void {
  for (const cell of visibleCellsFor(PLAYER_IDX, session.state, MOUNTAIN_TERRAIN_ID)) {
    session.explored.add(cell.y * MAP_W + cell.x);
  }
}

function refreshView(): void {
  accumulateVisible();
  session.view = viewFor(PLAYER_IDX, session.state, {
    explored: exploredList(),
    mountainTerrainId: MOUNTAIN_TERRAIN_ID,
  });
}

function territoryKeys(state: State): Set<number> {
  const cities: TerritoryCity[] = state.cities.map((city) => ({
    id: city.id,
    x: city.x,
    y: city.y,
    owner: String(city.owner),
    radius: resolveBorderRadius(city.level),
  }));
  const keys = new Set<number>();
  for (const [owner, cells] of Object.entries(territoryGrid(MAP_H, MAP_W, cities))) {
    if (owner !== String(PLAYER_IDX)) continue;
    for (const [y, x] of cells) keys.add(y * MAP_W + x);
  }
  return keys;
}

/** State → §6 map 型夹具（reachable 的输入；explored 参与 §4.2「非 hidden」过滤） */
function mapFixture(): MapFixture {
  const terrain: string[] = [];
  const cities: number[][] = [];
  for (let y = 0; y < MAP_H; y += 1) {
    let row = '';
    for (let x = 0; x < MAP_W; x += 1) {
      const tile = session.state.tiles[y][x];
      row += terrainLegendFromId(tile.terrain);
      if (tile.cityId !== null && tile.cityId !== undefined) cities.push([y, x]);
      else if (tile.village) cities.push([y, x]);
    }
    terrain.push(row);
  }
  return { h: MAP_H, w: MAP_W, terrain, roads: null, cities, explored: exploredList() };
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
}

/** §4.2 可达集高亮（core 计算；本回合已行动的单位不给高亮 = §2 move 谓词的可视化） */
function recomputeReachable(): void {
  session.reachableCells = [];
  const unit = unitById(session.selectedUnitId);
  if (unit === undefined || unit.owner !== PLAYER_IDX) return;
  if (unit.moved || unit.attacked || unit.healed) return;
  const typeDef = CONTENT.unitTypes[unit.type];
  session.reachableCells = reachable(
    { id: unit.id, owner: String(unit.owner), x: unit.x, y: unit.y, move: typeDef.move },
    mapFixture(),
    session.state.units.map((other) => ({
      id: other.id,
      owner: String(other.owner),
      x: other.x,
      y: other.y,
      move: CONTENT.unitTypes[other.type]?.move ?? 0,
    })),
  );
}

/** 单动作管线入口：拒绝 → 状态零变化 + 原因上屏；成功 → 新态 + 迷雾累积 + 完成检查 */
function submit(action: Action): State | null {
  const result = applyAction(session.state, action, CONTENT, { explored: exploredList() });
  if (result.rejected) {
    session.status = `✗ ${result.reason}`;
    return null;
  }
  session.state = result.state;
  refreshView();
  checkCompletion();
  return result.state;
}

function checkCompletion(): void {
  const villages = session.state.cities.filter((city) => city.owner === PLAYER_IDX && !city.isCapital).length;
  const done = villages >= VILLAGE_TOTAL && session.explored.size >= TOTAL_CELLS;
  if (done && !session.celebrated) {
    session.celebrated = true;
    session.overlay = true;
  }
}

function stars(): number {
  return session.state.players[PLAYER_IDX].stars;
}

function onTile(x: number, y: number): void {
  const index = y * MAP_W + x;
  const viewCell = session.view[index];
  const tile = session.state.tiles[y][x];

  // 1) 已选单位 + 目标可达 → move（§4.2 core 裁定可达性与迷雾合法性）
  if (session.selectedUnitId !== null && session.reachableCells.some((cell) => cell.x === x && cell.y === y)) {
    const unitId = session.selectedUnitId;
    if (submit({ type: 'move', unitId, x, y }) !== null) {
      session.status = '已移动';
      clearSelection();
    }
    renderNow();
    return;
  }

  const unit = session.state.units.find((other) => other.x === x && other.y === y && other.owner === PLAYER_IDX);
  if (unit !== undefined && (viewCell === undefined || viewCell.visibility !== 'hidden')) {
    // 2) 点资源格（单位在格上）→ harvest；领土 / 科技门槛由 core §2 谓词裁定
    if (tile.resource !== null && tile.resource !== undefined) {
      const label = RESOURCE_LABELS[tile.resource] ?? tile.resource;
      if (submit({ type: 'harvest', unitId: unit.id }) !== null) {
        session.status = `已采集 ${label}`;
      }
    }
    session.selectedUnitId = unit.id;
    session.selectedCityId = null;
    recomputeReachable();
    renderNow();
    return;
  }

  // 3) 点己方城 → 面板（训练 / 升级 / 研究）
  const city = ownCityAt(x, y);
  if (city !== undefined && (viewCell === undefined || viewCell.visibility !== 'hidden')) {
    session.selectedCityId = city.id;
    session.selectedUnitId = null;
    session.reachableCells = [];
    renderNow();
    return;
  }

  // 4) 中立村（可见时）给提示；其余点击 = 取消选择
  if (tile.village && viewCell !== undefined && viewCell.visibility !== 'hidden') {
    session.status = '中立村庄：派单位踩上去即占领';
  } else {
    session.status = '点击己方单位或首都开始';
  }
  clearSelection();
  renderNow();
}

const handlers: Handlers = {
  onTile,
  onEndTurn() {
    const before = stars();
    if (submit({ type: 'endTurn' }) === null) {
      renderNow();
      return;
    }
    clearSelection();
    session.status = `回合 ${session.state.turn}：⭐ ${before} → ${stars()}`;
    renderNow();
  },
  onTrain(unitType) {
    const city = activeCity();
    if (city === undefined) return;
    const before = stars();
    if (submit({ type: 'train', cityId: city.id, unitType }) === null) {
      renderNow();
      return;
    }
    session.status = `已训练 ${UNIT_LABELS[unitType] ?? unitType}（⭐ ${before} → ${stars()}）`;
    renderNow();
  },
  onUpgrade(choice) {
    const city = activeCity();
    if (city === undefined) return;
    if (submit({ type: 'upgradeCity', cityId: city.id, choice }) === null) {
      renderNow();
      return;
    }
    session.status = `已升级：${choice === 'stars5' ? '金库 +5 ⭐' : choice === 'workshop' ? '工坊' : '城墙'}`;
    renderNow();
  },
  onResearch(techId) {
    const before = stars();
    if (submit({ type: 'research', techId }) === null) {
      renderNow();
      return;
    }
    session.status = `已研究 ${TECH_LABELS[techId] ?? techId}（⭐ ${before} → ${stars()}）`;
    renderNow();
  },
  onHarvest() {
    const unit = unitById(session.selectedUnitId);
    if (unit === undefined) return;
    const tile = session.state.tiles[unit.y][unit.x];
    const resourceId = tile.resource ?? '';
    if (submit({ type: 'harvest', unitId: unit.id }) !== null) {
      session.status = `已采集 ${RESOURCE_LABELS[resourceId] ?? resourceId}`;
    }
    renderNow();
  },
  onOverlayClose() {
    session.overlay = false;
    session.status = '沙盒目标达成 —— 随意继续';
    renderNow();
  },
};

function buildModel(): ViewModel {
  const state = session.state;
  const player = state.players[PLAYER_IDX];
  const territory = territoryKeys(state);
  const reachableKeys = new Set(session.reachableCells.map((cell) => cell.y * MAP_W + cell.x));
  const selectedUnit = unitById(session.selectedUnitId);

  const cells: CellModel[] = session.view.map((viewCell, index) => {
    const x = index % MAP_W;
    const y = Math.floor(index / MAP_W);
    const tile = state.tiles[y][x];
    const unit = state.units.find((other) => other.x === x && other.y === y);
    const cityId = viewCell.building?.cityId ?? null;
    const city = cityId === null ? undefined : state.cities.find((entry) => entry.id === cityId);
    return {
      x,
      y,
      visibility: viewCell.visibility,
      terrain: viewCell.terrain,
      resource: viewCell.resource ?? null,
      village: tile.village && viewCell.visibility !== 'hidden',
      city: city === undefined ? null : city.isCapital ? 'capital' : 'city',
      unit:
        unit === undefined
          ? null
          : { id: unit.id, type: unit.type, hp: unit.hp, acted: unit.moved || unit.attacked || unit.healed },
      inTerritory: territory.has(index),
      reachable: reachableKeys.has(index),
      selected: unit !== undefined && unit.id === session.selectedUnitId,
    };
  });

  const city = activeCity();
  const unitTypeIds = UNIT_TYPE_ORDER.filter((id) => CONTENT.unitTypes[id] !== undefined);
  const model: ViewModel = {
    stars: player.stars,
    turn: state.turn,
    villages: state.cities.filter((entry) => entry.owner === PLAYER_IDX && !entry.isCapital).length,
    villagesTotal: VILLAGE_TOTAL,
    exploredPercent: Math.floor((session.explored.size * 100) / TOTAL_CELLS),
    status: session.status,
    cells,
    unit:
      selectedUnit === undefined
        ? null
        : {
            id: selectedUnit.id,
            label: UNIT_LABELS[selectedUnit.type] ?? selectedUnit.type,
            hp: selectedUnit.hp,
            maxHp: CONTENT.unitTypes[selectedUnit.type].hp,
            moved: selectedUnit.moved,
            attacked: selectedUnit.attacked,
            healed: selectedUnit.healed,
            onResource: state.tiles[selectedUnit.y][selectedUnit.x].resource ?? null,
            onOwnCity: ownCityAt(selectedUnit.x, selectedUnit.y) !== undefined,
          },
    city:
      city === undefined
        ? null
        : {
            id: city.id,
            label: city.isCapital ? '首都' : '城市',
            level: city.level,
            population: city.population,
            stationed: state.units.filter((unit) => unit.homeCity === city.id).length,
          },
    unitTypes: unitTypeIds.map((id) => ({
      id,
      label: UNIT_LABELS[id] ?? id,
      cost: CONTENT.unitTypes[id].cost,
      tech: CONTENT.unitTypes[id].tech ?? null,
    })),
    techs: TECH_ORDER.filter((id) => CONTENT.techs[id] !== undefined).map((id) => ({
      id,
      label: TECH_LABELS[id] ?? id,
      done: player.techs.includes(id),
      requires: [...CONTENT.techs[id].requires],
    })),
    overlay: session.overlay,
  };
  return model;
}

function renderNow(): void {
  refreshView();
  const root = document.getElementById('app');
  if (root === null) throw new Error('demo: 缺少 #app 容器');
  render(root, buildModel());
}

function boot(): void {
  const root = document.getElementById('app');
  if (root === null) throw new Error('demo: 缺少 #app 容器');
  refreshView();
  recomputeReachable();
  mount(root, handlers);
  render(root, buildModel());
}

boot();
