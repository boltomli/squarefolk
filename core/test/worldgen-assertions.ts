/**
 * worldgen 单元断言（core-spec §4.6；并入 npm test）：
 * 幂等 / seed 扰动必异 / 参数浅合并优先级（坑⑪）/ 大图 30×30 冒烟（含耗时上界）。
 * 逐条 PASS/FAIL + 汇总；任一失败进程非零退出（npm test 失败）。
 */
import balance from '../../data/balance.json';
import { generate, mergeWorldParams, type WorldGenOk } from '../src/worldgen';

let pass = 0;
let fail = 0;

function record(label: string, mismatches: string[]): void {
  if (mismatches.length === 0) {
    pass += 1;
    console.log(`PASS ${label}`);
  } else {
    fail += 1;
    console.log(`FAIL ${label} → ${mismatches.join('; ')}`);
  }
}

/** 成功结果的逐字段差异（数组比较顺序敏感 —— 规格序即输出序） */
function diffFields(a: WorldGenOk, b: WorldGenOk): string[] {
  const fields: (keyof WorldGenOk)[] = ['attempts', 'terrain', 'villages', 'resources', 'spawns', 'startValues', 'rngFinal'];
  return fields.filter((field) => JSON.stringify(a[field]) !== JSON.stringify(b[field]));
}

const base = mergeWorldParams({});

// ── 幂等：同 seed 两次逐字段全等（含 rngFinal） ──
const first = generate(7, 10, 10, base);
const second = generate(7, 10, 10, base);
record(
  'worldgen: 同 seed 两次逐字段幂等（terrain/villages/resources/spawns/startValues/rngFinal/attempts）',
  !first.ok || !second.ok
    ? [`ok=${String(first.ok)}/${String(second.ok)}（seed7 应成功）`]
    : diffFields(first, second),
);

// ── seed 扰动：seed+1 → 必异（非对称、非模板） ──
const perturbed = generate(8, 10, 10, base);
record(
  'worldgen: seed+1 → 地图指纹必异',
  !first.ok || !perturbed.ok
    ? [`ok=${String(first.ok)}/${String(perturbed.ok)}（seed7/8 应成功）`]
    : JSON.stringify(first.terrain) === JSON.stringify(perturbed.terrain)
      ? ['seed8 与 seed7 地形相同']
      : [],
);

// ── 参数浅合并（坑⑪）：{...balance.world, ...given.world} ──
const overridden = mergeWorldParams({ villageCount: 9, terrainWeights: { plain: 1000 } });
record(
  'worldgen: 浅合并 —— 覆盖键整值替换（villageCount 9、terrainWeights 整表换新）',
  overridden.villageCount === 9 && overridden.terrainWeights.plain === 1000 && !('water' in overridden.terrainWeights)
    ? []
    : [`villageCount=${overridden.villageCount}, water 键${'water' in overridden.terrainWeights ? '残留' : '已随整表替换消失'}`],
);
record(
  'worldgen: 浅合并 —— 未覆盖键回落 balance（smoothRounds/dMin/epsilon 与 balance.world 同值）',
  overridden.smoothRounds === balance.world.smoothRounds &&
    overridden.dMin === balance.world.dMin &&
    overridden.epsilon === balance.world.epsilon
    ? []
    : [`smoothRounds=${overridden.smoothRounds}, dMin=${overridden.dMin}, epsilon=${overridden.epsilon}`],
);

// ── 大图冒烟：30×30（§1 上限尺寸）在合理时间内完成 ──
const startedAt = Date.now();
const big = generate(42, 30, 30, mergeWorldParams({}));
const elapsedMs = Date.now() - startedAt;
record(
  'worldgen: 大图 30×30 在合理时间内完成（ok、spawns 满额、< 10s）',
  !big.ok
    ? [`ok=false reason=${big.reason}`]
    : big.spawns.length !== base.spawnCount
      ? [`spawns=${big.spawns.length}，期望 ${base.spawnCount}`]
      : elapsedMs > 10_000
        ? [`elapsed=${elapsedMs}ms（> 10s）`]
        : [],
);

console.log(`${pass}/${pass + fail} PASS`);
if (fail > 0) {
  process.exitCode = 1;
}
