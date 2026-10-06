/**
 * 对战模式（Phase 12）初始 State 装配：worldgen（core-spec §4.6，T3）按 seed 生成 10×10 →
 * 壳层组装双人初始态。分工同 map.ts（core-spec §1 行 47：迷雾不入 State；初始状态构造属壳层，
 * 规则只经 core API）—— 本文件不含任何规则数值，全部来自 data/*.json 或生成结果。
 *
 * 装配约定：
 * - 地图尺寸沿用 demo 的 MAP_W/MAP_H（沙盒与对战同为 10×10 → 壳层索引算术共用）
 * - spawns[0] → 玩家 0（人类，PLAYER_IDX 先手）、spawns[1] → 玩家 1（bot 后手）；
 *   两城均 isCapital（§4.7 征服检查 = 全部首都同一 owner）
 * - 每城 1 初始兵（unit.warrior，homeCity = 该城、站在城格 = 驻军 → 出城前 train 被 core 拒）
 * - 双方 START_STARS ★ 与 START_TECHS（与沙盒同一引导科技，config.ts 唯一事实源）
 * - 村庄 / 资源按生成结果落格（resources 三元组 = [y, x, kind]，§6 坐标序）
 * - state.seed = 世界种子、state.rng = 生成末态 rngFinal（§4.6 坑⑨：生成后冻结）
 */
import { terrainIdFromLegend } from '../../core/src/actions';
import type { City, Player, State, Tile, Unit } from '../../core/src/state';
import { generate, mergeWorldParams } from '../../core/src/worldgen';
import { CONTENT, START_STARS, START_TECHS } from './config';
import { MAP_H, MAP_W, PLAYER_IDX } from './map';

/** 对手玩家下标（单人 vs bot：不热座，bot 固定玩家 1） */
export const BOT_IDX = 1;

/** 起始屏缺省演示种子（同种子 → 同地图，worldgen 确定性） */
export const DEFAULT_SEED = 7;

/** 起始屏种子输入域上界（含）：XOR 进 bot 种子时留足符号位余量（§8.2 要求 0..2^53−1） */
export const SEED_MAX = 2147483647;

export interface VsSetup {
  state: State;
  seed: number;
  /** 中立村总数（完成度统计；对战不设沙盒式完成条件） */
  villageTotal: number;
  /** worldgen 重试次数（失败时上屏） */
  attempts: number;
}

export type VsSetupResult = { ok: true; setup: VsSetup } | { ok: false; reason: string };

/**
 * 按 seed 装配对战初始 State。worldgen 失败（retryCap 用尽）或生成结果不满足双人前提
 * → 返回 ok:false + 原因（上屏，不硬塞半成品地图）。
 */
export function createVsInitialState(seed: number): VsSetupResult {
  const world = generate(seed, MAP_H, MAP_W, mergeWorldParams({}));
  if (!world.ok) return { ok: false, reason: `世界生成失败：${world.reason}（尝试 ${world.attempts} 次）—— 换个种子重试` };
  if (world.spawns.length < 2) return { ok: false, reason: `生成结果 spawns=${world.spawns.length} < 2（对战需两处出生点）` };

  if (world.terrain.length !== MAP_H || world.terrain.some((row) => row.length !== MAP_W)) {
    return { ok: false, reason: `生成地形尺寸 ${world.terrain.length}×${world.terrain[0]?.length ?? 0} ≠ ${MAP_H}×${MAP_W}` };
  }
  const tiles: Tile[][] = [];
  for (const [y, row] of world.terrain.entries()) {
    const line: Tile[] = [];
    for (const [x, ch] of [...row].entries()) {
      try {
        line.push({
          terrain: terrainIdFromLegend(ch),
          resource: null,
          cityId: null,
          village: false,
          road: false,
          improved: null,
        });
      } catch (error) {
        return { ok: false, reason: `地形图例非法 (${x},${y})：${String(error)}` };
      }
    }
    tiles.push(line);
  }

  for (const [y, x] of world.villages) tiles[y][x].village = true;
  for (const entry of world.resources) {
    const [y, x, kind] = entry as [number, number, string];
    tiles[y][x].resource = kind;
  }

  const cityIds = ['city.000001', 'city.000002'];
  const cities: City[] = world.spawns.slice(0, 2).map(([y, x], index) => {
    tiles[y][x].cityId = cityIds[index];
    return {
      id: cityIds[index],
      x,
      y,
      owner: index === 0 ? PLAYER_IDX : BOT_IDX,
      level: 1,
      population: 0,
      hasWorkshop: false,
      hasWall: false,
      wallDurability: 0,
      isCapital: true,
    };
  });

  const warriorHp = CONTENT.unitTypes['unit.warrior'].hp;
  const units: Unit[] = cities.map((city, index) => ({
    id: `unit.${String(index + 1).padStart(6, '0')}`,
    owner: city.owner,
    type: 'unit.warrior',
    x: city.x,
    y: city.y,
    hp: warriorHp,
    moved: false,
    attacked: false,
    healed: false,
    kills: 0,
    promoted: false,
    homeCity: city.id,
  }));

  const players: Player[] = [
    {
      idx: PLAYER_IDX,
      name: '你（方族）',
      tribe: 'tribe.square',
      stars: START_STARS,
      techs: [...START_TECHS],
      met: [BOT_IDX],
      noCityTurns: 0,
      eliminated: false,
    },
    {
      idx: BOT_IDX,
      name: 'Bot（方族）',
      tribe: 'tribe.square',
      stars: START_STARS,
      techs: [...START_TECHS],
      met: [PLAYER_IDX],
      noCityTurns: 0,
      eliminated: false,
    },
  ];

  const state: State = {
    schemaVersion: 1,
    rulesVersion: '0.1.0',
    contentHash: '0000000000000000',
    seed: BigInt(seed),
    rng: BigInt(`0x${world.rngFinal}`),
    map: { width: MAP_W, height: MAP_H },
    turn: 0,
    currentPlayer: PLAYER_IDX,
    phase: 'act',
    tiles,
    units,
    cities,
    players,
    actionLog: [],
  };

  return { ok: true, setup: { state, seed, villageTotal: world.villages.length, attempts: world.attempts } };
}
