# Core Spec — 语言无关核心规格

> **状态：骨架（M0 进行中）** · 与 design.md 版本对齐（v0.9）
> 本文件是项目里**唯一可编码的规格**：任何语言的实现以「本文件 + 黄金向量」为准。
> 与 `design.md` 冲突时**先报告再改稿**，不要在实现里自行取舍。
> 红线与交付标准见仓库根目录 [AGENTS.md](../AGENTS.md)。

## 0. 全局约定

| 项 | 约定 | 状态 |
| --- | --- | --- |
| 数值定点 | 属性 ×10 存储（支持 0.5 步进）；中间运算 64 位整数 | ✅ design §5.2 |
| 舍入 | 只在**最终一步** half-up，不使用语言自带 round() | ✅ design §5.2 |
| id | 字符串 `domain.name`（`unit.warrior`）；持久化禁止枚举整数 | ✅ design §6 |
| 距离 / 邻接 | 切比雪夫 `max(\|dx\|,\|dy\|)`；**8 向邻接** | ✅ design §2.2 / D1 |
| 随机 | 战斗与结算**零随机**；PRNG 仅用于世界生成 | ✅ design §5.2 |
| **PRNG** | **splitmix64**（仅世界生成）：`s += 0x9E3779B97F4A7C15`；`z = s`；`z = (z ^ (z>>>30)) * 0xBF58476D1CE4E5B9`；`z = (z ^ (z>>>27)) * 0x94D049BB133111EB`；`return z ^ (z>>>31)`。全部 u64 回绕，`>>>` 为逻辑右移；状态显式传递，禁 `Math.random()` / `rand()` | ✅ **本节定案** |
| **stateHash** | **FNV-1a 64**：`h = 0xcbf29ce484222325`，逐字节 `h = (h ^ b) * 0x100000001b3`（u64 回绕）；输入 = 规范化序列化字节 | ✅ **本节定案** |
| 规范化序列化 | UTF-8；对象键按**键名 UTF-8 字节序升序**；无空白；整数无前导零、无 `+`、**无浮点**；缺省/null 字段不输出；数组序见 §1（按 id / 行主序 / seq）；**u64（seed / rng / stateHash / contentHash）一律 16 位小写 hex 字符串** —— JSON 数字 > 2^53 在 JS 侧丢精度（向量：`testdata/golden/meta/*`） | ✅ |
| 遍历顺序 | 一切集合结算前按 id / 坐标显式排序 | ✅ design §5.2 |
| 版本 | `rulesVersion`（规则语义）与 `schemaVersion`（数据结构）双轨 | ✅ design §6 |
| 数值来源 | 一切可调常数（K、减伤率、造价、ε、d_min…）读 `balance.json`，core 不写死（AGENTS.md 红线 2） | ✅ |

## 1. 状态模型 `State`（冻结 v0.1）

数组的**存储序 = 规范序**：`units / cities / players` 按 id 字典序，`tiles` 行主序 `(y, x)`，`actionLog` 按 `seq` 升序且连续无洞。

| 字段 | 类型 | 说明与不变量 |
| --- | --- | --- |
| `schemaVersion` | u16 | 序列化结构版本 |
| `rulesVersion` | string | semver，建局写入，回放头记录 |
| `contentHash` | string(16 hex) | 内容包指纹 |
| `seed` | u64 | 世界种子；**不参与战斗结算** |
| `rng` | u64 | splitmix64 状态；地图生成与出生点挑选后**冻结** |
| `map.width / height` | u16 | ≤ 30×30 |
| `turn` | u32 | 从 0 起 |
| `currentPlayer` | u8 | `players[]` 下标 |
| `phase` | enum | `prep / act / commit` |
| `tiles[y][x]` | struct | `terrain: id`、`resource: id?`、`cityId: id?`、`village: bool`（中立村庄标记；移动进入 → 转 `cityId`、`village=false`）、`road: bool`、`improved: id?`（~~`owner`~~ 已删：领地是衍生量，见 §4.3） |
| `units[]` | list | `id, owner, type, x, y, hp, moved, attacked, healed: bool, kills: u16, promoted: bool, homeCity` |
| `cities[]` | list | `id, x, y, owner, level, population, hasWorkshop, hasWall, wallDurability(0..3), isCapital` |
| `players[]` | list | `idx, name, tribe, stars(i32), techs[], met[], noCityTurns(u16 连续无城回合，占城清零), eliminated` |
| `actionLog[]` | list | `{seq, player, type, payload}`，append-only；**全状态可由 seed + log 重建** |

**不变量**（每动作后必须成立，测试断言用）：`0 ≤ hp ≤ maxHp(type)`；每格 ≤1 单位；`cityId` 全局唯一；`stars ≥ 0`；`level ≥ 1`；`population ≥ 0`；`hasWall ⇔ wallDurability ∈ 1..3`；**`eliminated ⇒ 无城市`**（无城 ≠ 立即淘汰 —— 宽限规则见 §4.7）。

**id 生成（动作新建对象）**：`city.` / `unit.` + **六位零填充十进制**，序号 = 现有同前缀 id 的**最大数值后缀 + 1** —— 纯状态导出、无隐藏计数器（村庄占领建城、训练造兵同用此规则）。

**衍生量不入状态**（一律现算）：`besieged`、防御姿态、可达集、视野三态、领地（§4.3）。**已探索迷雾历史不入 State**：`explored` 由 `seed + actionLog` 重放推导（§3.3 确定性），`viewFor` 以参数传入（design §2.5 每玩家位图存档）—— 迷雾影响视图与移动合法性，但 `stateHash` 的哈希对象是 State 本身，不含迷雾。

> 未定项索引见附录（T1 / T6 已关，剩 T2–T5 与 T1a）；**未定前不实现相关分支**。

## 2. 动作类型 `Action`（校验谓词 = `legalActions` 唯一来源）

UI 高亮、bot、联机校验**共用同一份判定**。公共前置（每个动作默认带）：`phase == act`、`player == currentPlayer`、payload 中"本方对象"确属本方、动作后 `stars ≥ 0` 保持。

| action | payload | 附加谓词与后效 |
| --- | --- | --- |
| `move` | `unitId, x, y` | `!moved && (!attacked || unit.canMoveAfterAttack) && !healed`（技能字段默认 false = 现行"攻击即结束回合"，design v0.14）；目标可达（§4.2 算法）；目标无单位；目标非 `hidden`（可进 `explored` 暗区）→ 落地后 `moved = true` |
| `attack` | `unitId, target(unitId \| cityId)` | `!attacked && !healed`；**架设型需 `!moved`**（`canAttackAfterMove || !moved`，§4.1-G T6）；目标为敌方且**可见**；切比雪夫距离 ≤ `range` → 结算后 `attacked = true`（本回合结束，§4.1-E） |
| `train` | `cityId, unitType`（载荷键 **`unitType`** —— 与 §6 判别键 `type` 避撞，2026-10-05 修正） | 城属本方且**未被围**；该城 `homeCity` 驻留数 < `level`（容量）；`unitType` 已解锁；`stars ≥ cost(unitType)`；城上格为空（T2） |
| `harvest` | `unitId` | 单位所在格有 `resource` 且在**己方领土**（§4.3 领地）；科技已解锁 → 资源移除，按 data 给人口或星星 |
| `build` | `unitId, kind` | 目标格在**己方领土**（§4.3 领地；**道路例外**：中立地可修、敌方领土不可）、无既有 `improved`、地形符合 `kind.allowedOn`（data）、`stars ≥ cost`、科技已解锁 |
| `research` | `techId` | 未研究、前置已满足、`stars ≥ cost`（§4.3 公式） |
| `upgradeCity` | `cityId, choice` | 属本方；`population ≥ level+1` 的当级需求；`wall` 需 `!hasWall` → 消耗人口 `level+1`，等级 +1，按 choice 落地 |
| `heal` | `unitId` | `!moved && !attacked && !healed && hp < maxHp` → `hp += (本土 ? 4 : 2)`（上限截断），`healed = true`（**不破坏防御姿态**） |
| `endTurn` | — | 提交后本回合不可再有动作（防重入） |

> **`train` 是对骨架草案的补漏**（建局必须能造单位）。`killSwap`、`canAttackAfterMove` 是**单位数据字段**，不属于动作。

## 3. 结算管线（顺序冻结）

### 3.1 回合结构（design §4.1 → 可执行顺序）

**准备阶段 `prep`**
1. 清本方所有单位 `moved = attacked = healed = false`（敌方在我回合读到的正是我上一轮的标记 → 姿态语义）
2. 收入：按 `cities` id 序逐城 —— 未被围 → `stars += level + (hasWorkshop ? 1 : 0) + (isCapital ? capitalBonus : 0)`；被围城贡献 0；**随后按 §4.3 建设细则结算改善产出（农场 → 归属城人口（城序）→ 矿 → 玩家星星）**
3. `phase = act`

**行动阶段 `act`**：玩家反复提交动作；每个动作走 3.2 管线。

**提交阶段 `commit`（endTurn）**
1. **围城推进**：按 `cities` id 序对每个被围城结算（D6 分支，§4.4；耐久制在**被围方**回合结束时判定）
2. **无城宽限计数（T4，§4.7）**：提交玩家城市数为 0 → `noCityTurns += 1`，`≥ eliminationGraceTurns`（∈ balance，默认 5）→ `eliminated = true` **并移除其全部残余单位**；有城 → `noCityTurns = 0`（占城瞬间亦清零，§4.7）
3. `currentPlayer` 下移并**跳过已淘汰玩家**（提交者自身被淘汰则继续下移）；越过末位 → `turn += 1` → 回 `prep`；若场上只剩一个未淘汰玩家 → 征服模式按 §4.7 判定（其应已持有全部首都）
4. 已提交玩家本回合再收动作 → 拒绝

### 3.2 单动作管线

```
校验(§2 谓词) → 计算(纯函数，基于当前状态) → 落地(写字段)
→ 衍生量重算(视野 / 领地 / 围城标志) → 胜利与淘汰检查 → actionLog 追加(seq++)
```

- 同一次交战内部固定顺序：加成汇总 → 伤害落地 → 存活判定 → 反击落地 → 击杀结算（补位/晋升）（§4.1.D）
- **跨动作排序 = 提交顺序**，不存在"同时事件"；看似并发的规则（围城 vs 占领、治疗 vs 被攻击）由阶段顺序（3.1）消解
- 胜利/淘汰检查点：**任何改变城市归属或城市数的动作之后**立即执行

### 3.3 确定性验收

同 `(seed, rulesVersion, contentHash, actionLog)` → 任意语言实现的**每一步 `stateHash` 逐位一致**（§0 规范化序列化 + FNV-1a 64）。这是跨宿主对账（design §6.3.3 集成层）的判据。

## 4. 规则细则（按域）

| 域 | 规格来源 | 状态 |
| --- | --- | --- |
| 4.1 战斗 | design §3.3 公式 + §3.4 加成折算 + **§3.7 的 8 组标定值** | ✅ **已展开（见下方）** |
| 4.2 移动与 ZOC | design §2.2 | 已定，待写 |
| 4.3 经济与科技 | design §4.2 / §4.3（含 TTR 约束） | 结构已定，细则待写 |
| 4.4 围城与占领 | design §4.4（🔶 D6 未定案：耐久制 vs 血条制） | **未定，勿实现** |
| 4.5 视野与迷雾 | design §2.5 | 已定，待写 |
| 4.6 地图生成与出生点 | design §2.6（两段式：生成 → 评分 → 公平带挑选） | 流程已定，参数待定 |
| 4.7 胜利判定 | design §4.5 | 已定，待写 |

### 4.1 战斗细则（展开）

> 依据：design §3.3 公式、§3.4 加成折算、§3.6 结算流程、§3.7 标定值。**本节是战斗实现的唯一依据。**

#### A. 输入

一次交战 = `attack(attackerUnit, defenderUnit)`，取双方**交战前**的静态属性：

| 字段 | 含义 |
| --- | --- |
| `atk10` / `def10_base` | 攻击力 / 基础防御力，×10 定点（2.0 → 20） |
| `hp` / `maxHp` | 当前 / 上限（整数） |
| `counter: [p, q]` | 反击系数**有理数**：近战 `1/1`、弓手 `1/2`、投石 `1/4`、医疗 `0/1` |
| `boni: []` | 加成来源枚举列表（见 B；fixture 与运行时同构） |

#### B. 加成汇总（枚举 → ×10 值，对应 design §3.4）

| key | 攻侧 | 防侧 |
| --- | --- | --- |
| `terrain_forest` / `terrain_mountain` | — | +10 |
| `city`（未被围） | — | +10 |
| `wall`（耐久未耗尽） | — | +20 |
| `stance_defensive`（上一回合未行动） | — | +10 |
| `support_each`（每相邻友军） | — | +5（合计上限 +15） |
| `flank`（敌方在 180° 相对两侧） | +10 | — |
| `promotion`（晋升） | +10 | +10 |

- `def10_eff = min(∑防侧, 50)` —— **封顶在求和之后**（M 下限 40%）
- `atk10_eff = ∑攻侧`（无封顶）
- `M(d) = 100 − (12 × d) / 10`（`d` 为 5 的倍数 → **整除无余数**）

#### C. 计算公式（整数，唯一形式）

```
damage  = round_half_up( atk10_eff(a) × 3 × (maxHp_a + hp_a_pre) × M(def10_eff_d)
                         ──────────────────────────────────────────────────────── )
                                          2000 × maxHp_a

counter = round_half_up( atk10_eff(d) × 3 × (maxHp_d + hp_d_pre) × M(def10_eff_a) × p
                         ──────────────────────────────────────────────────────────── )
                                          2000 × maxHp_d × q × k

round_half_up(n, d) = floor( (2n + d) / (2d) )        # 正数等价于 x + 0.5 取下整
```

- 推导：`E = 50% + 50% × hp/maxHp = (maxHp + hp) / (2 × maxHp)`，代入 design §3.3 后分母合并为 `2000 × maxHp`（属性 ×10 与百分比各贡献因子）。**E 恒取输出方自己的血量** —— design §3.3 明写 `E(攻)` / `E(守)`，P3 释义"残血单位保留一半战斗力"。（2026-10-03 修正：攻击式原误写 `maxHp_d` 下标，12 条向量中唯 `dying-rounds-zero` 因攻方满血而暴露此错，期望 6 → 8）
- 血量项均取**交战前**值：反击基数不受守方本次受伤影响（同时结算，与基线一致）；攻方 `hp_a_pre` 即其出手时血量。
- **`k = 1`** 守方存活（全额反击）；**`k = 4`** 守方被本次攻击击杀 → **垂死反击 = 基数 × 1/4**，`k` 在**最后一次舍入之前**乘入。
- 攻击方无对应规则：伤害先行落地，**全规则只有这一个分支**（design §3.5-C7）。
- 可选内容安全上限（默认关）：`damage ≤ ceil(maxHp × 0.85)`。
- 反击系数 `p/q = 0` 时 counter 天然为 0。

**验算锚点**：design §3.7 的 8 组主动/反击值 = 本公式代入结果，对应向量 `testdata/golden/combat/row1..row8.json`。

#### D. 结算顺序（与 design §3.6 流程图一致）

1. 汇总双方加成（B）→ 2. 计算 `damage` 并落地 → 3. 判定守方存活 →
4a. 存活 → `counter(k=1)` 落地；4b. 阵亡 → `counter(k=4)` 落地 →
5. **击杀结算**：`killSwap`（单位数据字段，v1 约定近战 `true`、远程 `false`）→ 目标格可进入则攻方补位；晋升计数 +1，达到 `promotion.kills`（配置，默认 3）且未晋升过 → `atk10+10、def10+10`（**不加 HP**）→
6. 攻方 `acted = true`，本回合该单位行动结束。

#### E. 回合内语义（引自 design，此处冻结为规格）

- **移动 → 可攻击 → 攻击后本回合结束**；移动后不攻击则等回合结束（design §3.9"三选一"的结构：治疗 = 替代本回合的移动/攻击）。
- 攻击目标必须在**射程内且可见**（距离用切比雪夫，8 向邻接）。
- 一次交战双方伤害**同时基于交战前血量**，无跨字段先后依赖 → 天然可并行/可复现。

#### F. 边界（每条需配向量，见 §5）

垂死反击取整可能为 0 或 1；`def10_eff` 触顶截断；同归于尽（双方同回合致死 —— 仅可能出现在序列入口）；近战补位受阻；`counter = 0` 单位。

#### G. 开放问题与已拍板项

1. ✅ **T6 已拍板：攻城器械移动后不可攻击**（2026-10-03："投石移动后当然不能攻击"）。
   **实际情境 → 规则抽象**：投石机这类重器械**转移阵地后要重新架设**才能开火；步、骑、轻抛射（弓/斧）走打一体 —— 这是**武器系统的固有属性**，不是兵种强弱调整。抽象为单位数据字段：
   - `canAttackAfterMove: bool` —— 走打一体 `true`（默认）；**架设型 `false`（投石）**；在 `units.json` 按单位类型标注，**不进状态机**
   - 谓词落点（§2 `attack`）：`unit.canAttackAfterMove || !unit.moved`
   - 架设型单位移动后：不能攻击、也不能治疗（治疗本就要求 `!moved`）→ 本回合自然结束，与基线 Stiff 语义一致
   - "攻击后能否移动"已由 §4.1-E（攻击即结束回合）覆盖，**不另开字段**
   - 将来加攻城锤/重炮等，按同一属性归类即可，**不新增规则分支**
2. 多回合推演结论（如 §3.7 行 2"先攻方阵亡"）**不属于单次交战向量**，由序列入口 / `sim` 验证。

### 4.2 移动与 ZOC（展开）

**移动力与消耗**（design §2.2）

- 移动力定点：**整点 = 2**（半点为工作单位）。起始 `budget2 = move × 2`；格消耗 `cost2`：普通地形 2、**道路 / 城市 / 村庄 1**、沼泽 3。
- **进入判定**：`ceil_to_whole(budget2) ≥ cost2`，其中 `ceil_to_whole(b) = ((b + 1) // 2) × 2`（`b` 可为负）—— 语义即 design 的"剩 0.5 也能走进 1 费格"。
- 扣减：`budget2 -= cost2`（**允许为负**；为负后 `ceil_to_whole = 0`，自然停止）。
- 每回合至多一次 `move` 动作（一次路径结算，非逐步多次）。

**停止规则（进入该格后本回合不得再动）**

1. 目标格与**敌方单位相邻**（ZOC）—— 优先级最高，**道路不豁免**
2. 粗地形（森林 / 山地，且该格无道路）：可进入、不可穿过
3. 发起攻击后（§4.1-E，攻击即结束回合）

**停止规则作用于"进入"动作**：出发格即使邻敌（ZOC）或处粗地形，也**不冻结**本回合移动 —— 单位"上回合就在那儿"与"这回合走进去"是两回事（P3 实现按此字面读法，已记入 §6 夹具语义）。

**可达集（确定性算法）**

- 以 `budget2` 为预算做 Dijkstra，权重 `cost2 ∈ {1, 2, 3}`，松弛前检查进入判定
- 优先队列排序键 `(dist, y, x)`；邻接枚举顺序固定 `N, NE, E, SE, S, SW, W, NW`
- 可达上界 `dist ≤ budget2 + 1`（判定式允许的超支 ≤ 1 半点）
- 过滤：目的地与**路径经过格**均须无单位（占位即阻断、**不可穿越**）、非 `hidden` 迷雾（`explored` 暗区可进）
- 输出 `reachable[]` 按 `(y, x)` 排序 —— UI、bot、联机校验同源

**进入即结算**：中立村庄 → 占领（新城市 `level=1, population=0` + 一次性奖励按 data），单位停留于该村格。

### 4.3 经济与科技（展开）

**收入**（design §4.2）

```
城市收入 = level + (hasWorkshop ? 1 : 0) + (isCapital ? capitalBonus : 0)   # capitalBonus ∈ balance（基线 1）
回合收入 = Σ 未被围城市，按 cities id 序结算
```

- 被围城 = 0（收入、治疗、城市防御加成**同时**失效）
- **人机同规则**：AI 无任何收入加成（design §4.2.1-4）

**人口与升级**

- 升到 `level+1` 需 `population ≥ level+1`（当级需求 = 目标级数），升级**消耗**等额人口，剩余保留
- 三选一：`workshop` → `hasWorkshop=true`（+1/回合）；`stars5` → `stars += 5`；`wall` → `hasWall=true, wallDurability=3`（需 `!hasWall`）

**单位容量**：每城容量 = `level`，按 `unit.homeCity` 计数，`train` 受其约束（design §4.2.3"人口上限 = 城市容量"）。

**采集与建筑**

- `harvest`：按 data 一次性给人口或星星 —— **给人口时落到该格领土归属的城市**（§4.3 归属规则的自然延伸：格子归谁、人口归谁；无主格上的采集品不可采），给星星则直接进玩家 `stars`；**一次性收入占全程 ≤ 30%**（`sim` 指标，design §4.2.1-3）
- `build`：农场 / 矿 / 道路（锯木厂等后续注册），造价与产出全在 data；**TTR ∈ [2, 4]** 为平衡验收区间（design §4.2.2），由 `dump` 输出实测表

**建设细则（v1 数值与产出，design v0.16 拍板）**

- **内容数据 `improvementTypes`**（data 层；夹具可内联，schema 同 `unitTypes`）：`{ cost: int, allowedOn: [terrainId], tech: techId?, yield?: { kind: 'pop'|'stars', perTurn: int } }`。没有 `yield` 的改善不产生每回合收益；`improvement.road` 特殊 —— 写 `tiles.road = true`（不写 `improved`），其 `allowedOn` 即 §4.2 道路例外的地形限制
- **v1 数值**：
  | kind | cost | allowedOn | tech | yield |
  |---|---|---|---|---|
  | `improvement.farm` | 5 | `plain, swamp` | `tech.orchard` | `pop +1/回合` |
  | `improvement.mine` | 5 | `mountain` | `tech.mining` | `stars +2/回合`（TTR=2.5 ✓） |
  | `improvement.road` | 3 | `plain, forest, swamp`（山/水不可修） | 无 | 无 |
- **谓词补充（§2 `build` 行之外的字段检查）**：`kind=road` → 校验 `tiles.road = false`（已有路不可重复修）；其余 kind → 校验 `tiles.improved = null`；**build 需 `!attacked`**（攻击过的单位本回合不可建）；**无 `!moved` 限制**（走到格上当回合可建，与 harvest 一致）；旗标不因 build 改变
- **产出结算（prep；并入 §3.1 第 2 步，城序 = `cities` id 序）**：
  1. 城市收入（原公式不变，被围 = 0）
  2. **农场 → 人口**：每城 `population += Σ perTurn`，求和范围 = **该城领地（§4.3 归属）内**的农场格 —— 与 harvest 同一归属原则（格子归谁、人口归谁）；**领地易主则产出随之易主**（改善随地走，v1 有意为之）
  3. **矿 → 星星**：`stars += Σ perTurn`，求和范围 = **玩家领地内**的矿格；中立地上的矿无人受益；**矿产不因该城被围清零**（地块产出 ≠ §4.4 的城市收入/治疗/城防）
- **拒绝理由措辞**（vector 钉死，实现照抄）：`build: 地形 ${terrain} 不符合 ${kind}.allowedOn（§2）`、`build: 目标格不在己方领土（§2 / §4.3）`、`build: 本格已有改善（§2）`、`build: 已有道路（§2）`、`build: 星星不足（${stars} < ${cost}）（§2）`、`build: 科技 ${tech} 未解锁（§2）`

**科技**

- `cost = tier × 城市数 + 4`（城市数 = 当前拥有数，动作时刻计算）
- 三层前置：T1 无前置；T2/T3 需同分支前序（data 定义，`validate` 查环）

**领地模型（T1 已拍板 —— 方案 C：动态扩边）**

- **半径**：`radius(city) = ceil(level ÷ 2)` —— L1–2 → 3×3，L3–4 → 5×5，L5–6 → 7×7…，随升级每 2 级扩一圈。实现从 `balance.json` 的 `borderRadiusByLevel` 表按级取值（公式只是默认，逐级可改）
- **暂不加上限**（用户："也许加点限制但以后再说" → 附录登记 **T1a**；将来加限制只动上限规则，不动谓词）
- **归属**：每个格子归**最近的城市**（与城市阵营无关地比较；距离并列 → `city id` 小者胜）；格子在**其归属城市**半径内 → 属该城所有者的领土
  - 双方城市挤压、双城重叠、地图边缘 —— 全部被这一条天然处理，**不另写避让规则**
- `territory(玩家)` = 归属筛选后的己方城市半径格并集 —— **衍生量**：不入状态，每动作后重算；城市易手/升级 → 领地自动跟着变
- **道路例外（沿基线）**：`build kind=road` 不受领土约束 —— **中立地表可修**（敌方领土不可），山地 / 水域不可修；否则早期两城隔着地修不了路，连接体系出不来
- **谓词落点**：`build`（道路除外）、`harvest` → 目标格 ∈ `territory(我)`；**敌方领土内不可建、不可采**（基线一致）
- **视野不随领地变**：§4.5 是视野源制（单位 1 / 山地与城市 2），与基线"领地扩视野"不同 —— 已有意维持差异
- 状态级向量 `turn/territory-*`（重叠归属、随级扩圈、道路例外、易手收缩）待 §1 状态模型实装后补

### 4.4 围城与占领（公共框架；🔶 D6 分支未定）

**已定（两分支通用）**

- `besieged = ∃ 敌方单位与城市格相邻`（衍生量，不入状态）
- 被围期间：该城收入 0、守军不可治疗、城市防御加成（+1）失效、`train` 不可用
- 中立村庄：移动进入即占领
- 易手后：城市保留等级，`population −1`（下限 0），原守军逐出（v1 固定逐出）

**🔶 D6 分支（未拍板，勿实现破城逻辑）**

- **耐久制**（design §4.4 主案）：`hasWall → wallDurability ∈ 0..3`；被围方**回合结束**时相邻敌军 ≥2 → `wallDurability −1`；攻城单位直接削耐久（每次削多少 = 🔶 参数）；归零 → 可占领
- **血条制**（基线近似）：对城攻击走独立城防血条，清零可占领

### 4.5 视野与迷雾（展开，design §2.5）

**三态**（每玩家 × 每格）：`hidden`（未探索）/ `explored`（已见无视野）/ `visible`

- **视野源与半径**：己方单位 1；**位于山地的己方单位 2**；己方城市（含首都）2；距离 = 切比雪夫
- `visible` = 所有源的并集；`explored` 一旦成立**不回退**
- **`viewFor(player)` 输出**：
  - `visible` 格 → 地形、资源、建筑、敌方单位
  - `explored` 格 → 地形与建筑轮廓，**无单位**
  - `hidden` 格 → 仅"未探索"标记
- 存档：每玩家迷雾位图 RLE（design §2.5）；`viewFor` 输出按规范序序列化
- 纯函数 `visible(playerIdx, x, y, state) -> bool`，无逐帧随机

### 4.6 地图生成与出生点（展开，design §2.6）

**确定性**：`rng` 从 `seed` 起 splitmix64 单流推进，**消耗顺序固定**：

1. 地形与资源生成 → 2. 村庄 / 遗迹布置 → 3. 城址候选评分 → 4. 出生点公平带挑选（随机取组合从此流继续）。完成后 `rng` **冻结**（战斗不碰）。

**两段式流程**

1. **自然生成**：全局统计均匀，**零镜像约束**。生成算法本身 🔶-T3 —— 未冻结前 `world/gen-*` 向量只做"同实现同指纹"对账，不做跨实现断言
2. **枚举候选**：预置城址 + 大村庄，数量 > n（落选城址保留为中立目标）
3. **评分** `start_value = w1×近村距离和(负向) + w2×资源价值 + w3×通行率 + w4×边缘惩罚 + w5×遗迹数`，权重全在 `balance.json`
4. **公平带挑选**：`max(start_value) − min(start_value) ≤ ε` 且两两间距 ≥ `d_min`（均 ∈ balance）；在**所有合法组合中等概率随机取一组**；n ≤ 4 穷举，n 大按分数取簇 + 局部交换
5. 无解 → 换 seed 重新生成（尝试上限 ∈ balance，超限**报错**而非硬塞）

**验收**：`sim` 换座胜率差 ≤ ±5%、公平带生成成功率（design §6.2 指标面板）。

### 4.7 胜利判定（展开，design §4.5）

| 模式 | 判定（检查点 = 每次城市归属/数量变化后） |
| --- | --- |
| **征服** | 某玩家拥有**全场全部首都**（开局全部 `isCapital` 城的集合）→ 立即胜利 |
| **积分** | 第 30 回合结束时分数最高者胜；分数公式 🔶-T5 |
| **沙盒** | 无胜利条件 |

- **淘汰（T4 已拍板，参考英雄无敌 3）**：城市丢光 → 进入**宽限期**：`noCityTurns` 自 +1（该玩家自己回合结束时结算），**期间残兵保留不依赖领地的能力**（移动 / 攻击 / 治疗照常；**采集与建造因领地归零自然不可用** —— 领地 = 城市半径并集，§4.3）；宽限期内**占下任何城 → 计数清零**（领地随新城恢复）；连续 `eliminationGraceTurns`（∈ balance，默认 **5**）回合未占城 → `eliminated = true`，其残余单位一并移除（v1 取舍，可后改）。不变量：`eliminated ⇒ 无城市`（反之不成立）
- 同分 tie-break 🔶-T5 一并定

## 5. 边界情况清单（每条需配向量；✅ = 向量已落地）

### 战斗（fixture 可覆盖）

- [x] 垂死反击取整可为 **0**（高防攻方 × 低攻守方）→ `boundary/dying-rounds-zero`
- [x] `def10_eff` 触顶：加成求和 > 50 截断 → `boundary/def-cap`（触顶 M=40 vs 未触顶 M=16，结果必须不同）
- [x] `counter = 0` 单位（医疗 `[0,1]`）→ `boundary/zero-counter`
- [x] 晋升 +10/+10 的实际交换值 → `promotion-01`（对 design §3.9"打 7 挨 4"）
- [ ] 同归于尽 —— **单次交战不可能**（双方伤害同基于战前血量，仅守方可能阵亡）→ 只在序列入口出现
- [ ] 近战补位受阻（目标格不可进入 → 攻方留原地）
- [ ] `hp = 0` 单位不可被选为攻击目标（`attack` 谓词）
- [ ] `kills` 满 `promotion.kills` → 晋升；**已晋升者再杀**：计数继续、加成不再叠加
- [ ] `killSwap` 补位后原格为空、新格合规

### 移动

- [x] 半点预算向上取整：剩 0.5 进 1 费格 **可进**；进 1.5 费格（沼泽）**被拒** → `move/road-overshoot` + `move/swamp-deny`
- [x] 扣减为负后 `ceil_to_whole = 0` 自然停止 → 单测「扣减为负后自然停止」
- [ ] ZOC 优先于道路：ZOC 停走本身 → `move/zoc-block` 已钉死；**"道路不豁免"暂无向量**（待补 `move/zoc-road`）
- [x] 粗地形可进不可穿；**有道路的森林可穿过** → `move/rough-road`
- [x] 不可进入 `hidden`，可进入 `explored` 暗区 → `move/fog-hidden`
- [ ] 中立村庄进入即占领（`level=1` + 奖励，单位停留）—— turn 域，待动作管线阶段

### 经济

- [ ] 升级：人口**恰好等于**需求可升；差 1 拒绝；`wall` 已有拒绝；消耗后余量保留
- [ ] `train`：容量满拒绝、城上格被占拒绝（T2）、被围城拒绝
- [ ] 被围城**同时**失去收入 / 治疗 / 城市防御加成（一条断言三件事）
- [ ] 科技成本整数无小数（`tier × cities + 4`）；重复研究拒绝
- [ ] 一次性收入占比的统计口径（供 `sim` 使用）

### 状态与日志

- [ ] `actionLog.seq` 连续无洞；重复 `endTurn` 拒绝；已提交后再收动作拒绝
- [ ] `stateHash` 规范序**跨实现一致**（键字典序、数组存储序）
- [ ] 淘汰玩家（`eliminated ⇔ 无城市`）不可再产出动作
- [ ] 视野三态裁剪：`hidden` 无输出 / `explored` 有轮廓无单位 / `visible` 全量
- [x] **姿态读写时序**：`prep` 清本方旗 → 敌方回合读到上一轮标记；**新建单位 flags 默认 false → 天然防御姿态** —— 由 §3.1 结构保证，用状态级向量 `turn/stance-*` 固化

## 6. 黄金测试向量格式

路径：`testdata/golden/<域>/<用例名>.json`，**一个文件 = 一个用例**。`given` 有两种形态：

1. **`fixture`（命名夹具 + 参数）** —— 微场景（战斗标定等）。**自包含**：单位属性内联，不依赖尚不存在的 State 与数据文件。当前 `combat/` 全部使用。
2. **`state`（完整状态 + 动作）** —— 整状态级用例（移动、回合推进、地图生成）。待 §1 状态模型冻结后启用。

### 6.1 fixture 型示例

```json
{
  "id": "combat/calibration/row1",
  "rulesVersion": "0.1.0",
  "source": "design.md §3.7 行1",
  "given": {
    "fixture": "combat1v1",
    "attacker": { "base": {"atk10": 20, "def10": 20, "hp": 10, "maxHp": 10, "counter": [1, 1]}, "boni": [] },
    "defender": { "base": {"atk10": 20, "def10": 20, "hp": 10, "maxHp": 10, "counter": [1, 1]}, "boni": [] }
  },
  "expect": {
    "damage": 5, "counterDamage": 5, "counterKind": "full",
    "attackerHpAfter": 5, "defenderHpAfter": 5,
    "defenderDied": false
  },
  "notes": "非防御姿态均势交换：先手优势的基础值"
}
```

**语义约定**

- `fixture: "combat1v1"`：只有两个单位，无地形 / 迷雾 / 邻接上下文。
- `boni` 直接列出 core-spec §4.1-B 的加成枚举（姿态 = `stance_defensive`、夹击 = `flank`）—— **夹具跳过姿态判定逻辑**，判定属于状态级向量。
- HP 语义：`hpAfter = max(0, hp − damage)`（伤害可溢出，HP 不为负）。
- `expect` 字段全集：`damage`、`counterDamage`、`counterKind`（`full` | `dying`）、`attackerHpAfter`、`defenderHpAfter`、`defenderDied`，以及可选的 `killSwapApplied`、`promotionApplied`；state 型可另含 `hash`（规范化序列化后的完整状态）。

#### map 型 given（移动 / 视野 / 领地共用底座）

```json
{
  "given": {
    "fixture": "moveReachable",
    "map": {
      "h": 1, "w": 3,
      "terrain": ["..."],
      "roads": [[0, 1]],
      "cities": [],
      "explored": []
    },
    "units": [
      { "id": "u1", "owner": "A", "x": 0, "y": 0, "move": 1 }
    ]
  },
  "expect": { "dest": [[0, 1], [0, 2]] }
}
```

- **坐标**：`units[].x/y` 为列 / 行；`roads`、`cities`、`resources`（三元组 **`[y, x, kind]`**）、`explored` 与 `expect` 一律 **`[y, x]`**（行主序）
- `terrain`：每行一个字符串，图例 `.`平原 `f`森林 `m`山地 `s`沼泽 `w`水域（v1 陆地单位不可通行）
- `roads` / `cities` **叠加**在地形之上：路格 cost 1（森林+路 = 可穿过、cost 1）；城 / 村格 cost 1（占领属 `turn/*`，移动向量只测通行）；**叠加不改水域** —— 水不可入无条件优先（v1 无海军，路也修不到水上 §4.3）
- `explored` **缺省或空数组 `[]` = 全图已探索**；**非空**时其外即 `hidden`（§4.5 三态里移动只区分这两态）
- `units[].move` 为整点移动力（`budget2 = move × 2`）；`owner` 不同 = 敌方（ZOC 与占位判定）
- **`units[0]` = 发起移动的单位**（夹具约定；其余单位为占位 / ZOC 源）
- `expect.dest` = 合法目的地集合（**不含出发格**），按 `[y, x]` 字典序

#### vision 型 given（`fixture: "visionVisible"`）

```json
{
  "given": {
    "fixture": "visionVisible",
    "viewer": "A",
    "map": { "h": 3, "w": 3, "terrain": ["m..", "...", "..."], "cities": [[2, 2, "B"]] },
    "units": [ { "id": "u1", "owner": "A", "x": 1, "y": 1 }, { "id": "e1", "owner": "B", "x": 2, "y": 0 } ]
  },
  "expect": { "visible": [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]] }
}
```

- 观察者 = `given.viewer`；**视野源只算观察者己方**（§4.5）：己方单位半径 1；**位于山地的己方单位**半径 2；**己方城市**半径 2；距离 = 切比雪夫
- `cities` 在 vision 夹具中为 **`[y, x, owner]` 三元组**（归属决定是否成源；move 夹具仍用二元组 —— 移动只关心 cost）
- **空山地不是源**；敌方单位 / 敌城 / 中立城永不是观察者的源
- `expect.visible` = 可见格集合，`[y, x]` 升序；`viewFor` 三态裁剪的**输出格式**不属本夹具（由状态级向量覆盖）

#### territory 型 given（`fixture: "territoryGrid"`）

```json
{
  "given": {
    "fixture": "territoryGrid",
    "map": { "h": 3, "w": 3 },
    "cities": [
      { "id": "c1", "x": 1, "y": 1, "owner": "A", "radius": 1 },
      { "id": "c2", "x": 2, "y": 2, "owner": "B", "radius": 1 }
    ]
  },
  "expect": { "territory": { "A": [[0, 0]], "B": [[2, 2]], "unowned": [[0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1]] } }
}
```

- 每格归**全城池中最近的城市**（切比雪夫，与阵营无关地比较）；**距离并列 → `city id` 字典序小者胜**
- 格子在**其归属城市** `radius` 内 → 属该城 `owner` 的领土；否则 **`unowned`**（即使更远的别的城市半径覆盖到这里也不算）
- `radius` 为已解析值：§4.3 的 `level → borderRadiusByLevel` 映射在 balance，**不属本夹具**
- `expect.territory` 键 = owner id，无主格键 = `"unowned"`；各列表 `[y, x]` 升序

#### action 型 given（`fixture: "actionApply"`）

```json
{
  "given": {
    "fixture": "actionApply",
    "map": { "h": 3, "w": 3, "terrain": ["...", "...", "..."], "roads": [], "villages": [[1, 1]], "resources": [[2, 0, "fruit"]], "improved": [], "explored": [] },
    "units": [ { "id": "unit.000001", "owner": "A", "type": "unit.warrior", "x": 0, "y": 0, "hp": 10, "maxHp": 10, "atk10": 20, "def10": 20, "move": 1, "range": 1, "counter": [1, 1], "homeCity": "city.000001", "kills": 0, "promoted": false, "moved": false, "attacked": false, "healed": false } ],
    "cities": [ { "id": "city.000001", "x": 0, "y": 0, "owner": "A", "level": 1, "population": 0, "hasWorkshop": false, "hasWall": false, "wallDurability": 0, "isCapital": true } ],
    "players": [ { "id": "A", "stars": 5, "techs": [], "met": [], "eliminated": false } ],
    "unitTypes": { "unit.warrior": { "cost": 3, "hp": 10, "atk10": 20, "def10": 20, "move": 1, "range": 1, "counter": [1, 1] } },
    "techs": { "tech.orchard": { "tier": 1, "requires": [] } },
    "resources": { "fruit": { "effect": "pop" } },
    "currentPlayer": "A", "turn": 0, "phase": "act",
    "action": { "type": "move", "unitId": "unit.000001", "x": 1, "y": 1 }
  },
  "expect": { "rejected": false, "cities": [ "……完整期望数组，按 id 序……" ], "villages": [] }
}
```

- `given` = **动作前的完整切片**（lite State）：`map`（`villages` 中立村庄格、`resources` 资源格与种类、`improved` 可选改善格 `[[y,x,kind]]`（缺省 = 无改善；`improvement.road` 不在此列，用 `roads`）、`roads`）、`units`（×10 属性 + `moved/attacked/healed` 旗 + `homeCity`）、`cities`、`players`、**内容数据内联**（`unitTypes` / `techs` / `resources` / `improvementTypes`（可选，build 向量必须注入，缺省 = 空表）—— 运行时来自 data 层）、回合指针、`action`
- `expect` **只列关心的字段**（纪律 §6.2-3）：`rejected`（true = §2 谓词拒绝、状态零变化）、`units` / `cities` / `villages` / `resources` / `players` / `improved`（完整改善集，`[y,x,kind]` 按 `[y,x]` 升序）/ `roads`（完整路格集，`[y,x]` 升序）/ `turn` / `currentPlayer` / `winner`；**出现的数组必须是完整期望值**（`units`/`cities` 按 id 序，坐标类 `[y,x]` 升序）
- 收入、治疗等常数来自 `balance`（§4.3 `capitalBonus`），夹具不重复声明
- 拒绝路径（谓词不通过）与正常路径同格式：`rejected: true` 时其余字段全不校验

### 6.2 向量纪律

1. 数值**由规格手算或推导**（design §3.7 / core-spec §4.1.C），**禁止由实现反向生成**（防循环论证）。
2. 每条向量必须能在任意语言实现上独立断言，不依赖实现细节。
3. `expect` 只断言规格关心的字段；给 `hash` 的必须是完整规范化状态。
4. 新增规则 → 同时新增向量；改规格 → 向量与修订记录同步更新。

### 6.3 首批与后续

- ✅ **已落地**：`combat/row1..row8.json` —— design §3.7 八组标定，每组 = **单次交战**的主动 / 反击值（纯手算，见各文件 `source` 与 `notes`）。
- 后续：`combat/boundary-*`（垂死取整为 0、`def10` 封顶、`counter=0`、补位受阻）、`combat/stance-outcome-*`（**序列入口**，多回合推演如"先攻方阵亡"）、`world/gen-*`（固定种子地图指纹）、`turn/*`（姿态与回合推进，待 §1/§3 冻结）。

## 7. 版本与兼容

- `rulesVersion` 变更 → 旧回放必须用对应版本实现才能复现（回放头部记录）
- `schemaVersion` 变更 → 数据需迁移函数
- 语义化：破坏规则语义 = minor+1（1.0 前）；纯内容数值调整不改 `rulesVersion`，只改 `contentHash`

## 附录：未定项索引（实施期必须逐个关闭）

| 项 | 类别 | 状态 / 关联决策 |
| --- | --- | --- |
| core 实现语言 | D13 | ✅ **已定：TypeScript**（vite+TS 同栈、零 FFI、web 试玩直出；2026-10-03）—— 编辑器框架倾向 Tauri 稳定线 v2 |
| 游戏壳与首发平台 | D4 | 🔶 未定（M2 才依赖，不阻塞 M0/M1） |
| PRNG、哈希算法 | — | ✅ **已定**：splitmix64 / FNV-1a 64（§0 本节定案） |
| 围城破城机制 + 攻城削耐久参数 | D6 | 🔶 未定 —— §4.4 公共框架已写；**勿实现破城分支** |
| 联机回合模型 | D3 | 🔶 M2 前 |
| 标定常数调参 | D10 | ⏸ M0 回归后 |
| T1 领地 / 边界扩张模型 | spec | ✅ **已拍板（方案 C · 动态）**：半径随等级 `ceil(level/2)` + 最近城市归属 + 道路可修中立地（§4.3） |
| T1a 扩边限制（半径上限 / 增速） | spec | ⏸ 用户："也许加点限制但以后再说" —— 到时只改上限规则与 `borderRadiusByLevel`，**不动谓词** |
| T2 训练占格与强制推挤 | spec | 🔶 design 未覆盖 —— v1 建议"城上格被占不可训练"，推挤机制后置 |
| T3 地图生成算法规格 | spec | 🔶 design §2.6 只定了流程与挑选；地形合成算法单独规格后，`world/gen-*` 才可做跨实现断言 |
| T4 淘汰（英雄无敌 3 式宽限） | spec | ✅ **已拍板**：残兵无城期间保留**不依赖领地**的能力（移动/攻击/治疗；采集、建造随领地归零自然不可用）；连续无城 `eliminationGraceTurns`（默认 5，balance）未占任何城才判负、占城清零；淘汰时移除残兵（§4.7）。**实现待接**：`state.noCityTurns`、endTurn 计数、不变量与单测同步 |
| T5 分数公式与同分 tie-break | spec | ⏸ **低优先**（用户："分数意义不大"）—— 沙盒为当前主玩法、征服模式已有；首接触奖励（3–12★）同级后置 |
| T6 投石 `canAttackAfterMove` | spec | ✅ **已拍板**：架设型（投石）移动后不可攻击 —— 字段默认 `true`、投石 `false`（§4.1-G） |
