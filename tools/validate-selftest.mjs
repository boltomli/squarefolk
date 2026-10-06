#!/usr/bin/env node
/**
 * validate 自测（进 npm test 链）：对**故意破坏**的数据样例断言 tools/validate.mjs 能抓住。
 * 做法：把真实 data/ 整目录复制进临时目录 → 逐例单点破坏 → runValidate（全管线：
 * schema 校验 + 交叉引用检查）→ 断言报出预期错误。基线例（真实数据 0 错误）先行。
 *
 * 覆盖：基线干净 / 环状科技树 / 悬空科技引用 / 越界数值 / id 命名违规 /
 *       未知地形 allowedOn / schema 子集外的多余字段。
 * 退出码：0 = 全部通过；1 = 任一例失败。
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runValidate } from './validate.mjs';

const REPO_DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

let pass = 0;
let fail = 0;

function report(ok, label, detail) {
  if (ok) {
    pass += 1;
    console.log(`PASS ${label}`);
  } else {
    fail += 1;
    console.log(`FAIL ${label}${detail ? ` → ${detail}` : ''}`);
  }
}

/** 复制真实数据到临时目录；mutate(errors, dir) 在复制体上单点破坏；expect(errs) 判定抓住 */
function runCase(label, mutate, expect) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sqf-validate-'));
  try {
    cpSync(REPO_DATA_DIR, dir, { recursive: true });
    mutate(dir);
    const errors = runValidate(dir);
    const verdict = expect(errors);
    report(verdict.ok, label, verdict.detail ?? (errors.length ? `实际报错：${errors[0]}` : 'validate 未报任何错误'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 改写临时目录里某个数据文件：JSON 读 → mutate → 写回 */
function edit(dir, file, mutate) {
  const p = path.join(dir, file);
  const data = JSON.parse(readFileSync(p, 'utf8'));
  mutate(data);
  writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`);
}

const has = (errors, re) => errors.some((e) => re.test(e));
const expectHit = (re) => (errors) => (has(errors, re) ? { ok: true } : { ok: false });
const expectClean = (errors) => (errors.length === 0 ? { ok: true } : { ok: false, detail: `基线不应有错，实际：${errors[0]}` });

// 0. 基线：真实数据全绿（后续各例都以它为单点破坏的起点）
runCase('基线：真实 data/ 0 错误', () => {}, expectClean);

// 1. 环状科技树：orchard → steel → hunt → orchard
runCase(
  '环状科技树被抓住',
  (dir) => edit(dir, 'techs.json', (d) => { d.techs['tech.orchard'].requires = ['tech.steel']; d.techs['tech.steel'].requires = ['tech.hunt']; d.techs['tech.hunt'].requires = ['tech.orchard']; }),
  expectHit(/科技树存在环/),
);

// 2. 悬空引用：改善指向不存在的科技
runCase(
  '悬空科技引用被抓住',
  (dir) => edit(dir, 'improvements.json', (d) => { d.improvements['improvement.mine'].tech = 'tech.nonexistent'; }),
  expectHit(/improvements\.improvement\.mine.*tech.*指向不存在的科技/),
);

// 3. 越界数值：兵种造价为负（schema minimum）
runCase(
  '越界数值被抓住',
  (dir) => edit(dir, 'units.json', (d) => { d.units['unit.warrior'].cost = -1; }),
  expectHit(/units\.json\["units"\]\["unit\.warrior"\]\["cost"\].*minimum 0/),
);

// 4. id 命名违规：科技 id 丢掉 `tech.` 前缀
runCase(
  'id 命名违规被抓住',
  (dir) => edit(dir, 'techs.json', (d) => { d.techs.steel = d.techs['tech.steel']; delete d.techs['tech.steel']; }),
  expectHit(/techs: 科技 id "steel" 不符合/),
);

// 5. allowedOn 未知地形
runCase(
  '未知地形 allowedOn 被抓住',
  (dir) => edit(dir, 'improvements.json', (d) => { d.improvements['improvement.road'].allowedOn = ['plain', 'lava']; }),
  expectHit(/improvement\.road: allowedOn 含未知地形 "lava"/),
);

// 6. schema 层：多余字段（additionalProperties: false）
runCase(
  '多余字段被抓住（additionalProperties: false）',
  (dir) => edit(dir, 'units.json', (d) => { d.units['unit.scout'].hpRegen = 3; }),
  expectHit(/units\.json\["units"\]\["unit\.scout"\]: 不允许的字段 hpRegen/),
);

console.log(`selftest: ${pass}/${pass + fail} PASS`);
if (fail > 0) process.exit(1);
