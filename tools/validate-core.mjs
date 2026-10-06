/**
 * Squarefolk 校验核心 —— design §6.1：JSON Schema 子集校验 + 交叉引用检查。
 * **纯函数**：入参 = 已解析的 JSON 对象 + schema 对象，出参 = 错误字符串数组（空 = 通过）。
 * 零 node API、零 I/O —— CLI 壳（tools/validate.mjs）、validate-selftest、
 * 桌面编辑器 webview（tools/editor）共用这一份，禁止在任何宿主里重实现（design §6.1 分工原则）。
 *
 * ── 支持的 Schema 关键字子集（边界即本清单，schema 漂移宁可报错也不静默放过）──
 *   type（object / array / string / integer / number / boolean / null）
 *   required / properties / additionalProperties（true | false | 子 schema 三种取值）
 *   enum / items / pattern / minimum / maximum
 * 元数据关键字仅透传不判定：$schema / $id / $comment / title / description / default / examples。
 * 子集之外（$ref、allOf/anyOf/oneOf、not、minItems/maxItems、uniqueItems、propertyNames、
 * patternProperties、format、if/then、dependentRequired、unevaluatedProperties …）
 * **出现即报错**，迫使 schema 只用本子集表达。
 *
 * ── design §6.1 交叉引用检查（schema 管不到的跨文件约束）──
 *   1. 兵种 / 科技 id 命名规范 ^\w+\.\w+$
 *   2. 科技树无环（requires 显式排序遍历，DFS 三色标记）
 *   3. 兵种 / 资源 / 改善的 tech 字段指向存在的科技；科技 requires 指向存在的科技
 *   4. 改善 allowedOn ⊆ 已知地形 id（core/src/actions.ts LEGEND_BY_TERRAIN）
 *   5. 数值区间：schema minimum/maximum 管单值；此处补跨字段项
 *      （unit.counter 恰为 2 个非负整数 —— 解释器子集无 minItems/maxItems）
 *   6. balance.world 参数一致性（§4.6 T3）：terrainWeights 键集=已知地形且总和 1000、
 *      smoothPriority 为已知地形全排列、resourcePlacement/resourceCount/resourceValue
 *      键集一致且 ⊆ resources 数据、minMapSize ≤ maxMapSize
 */

/** 五个内容文件与其 schema 的配对表（I/O 宿主按此读文件；顺序显式，红线 3） */
export const CONTENT_PAIRS = [
  ['units.json', 'units.schema.json'],
  ['techs.json', 'techs.schema.json'],
  ['improvements.json', 'improvements.schema.json'],
  ['resources.json', 'resources.schema.json'],
  ['balance.json', 'balance.schema.json'],
];

const META_KEYWORDS = new Set(['$schema', '$id', '$comment', 'title', 'description', 'default', 'examples']);
const SUPPORTED_KEYWORDS = new Set([
  'type', 'required', 'properties', 'additionalProperties', 'enum', 'items', 'pattern', 'minimum', 'maximum',
]);

/** design §6 id 红线：字符串 id（unit.warrior / tech.archery），禁止裸名与枚举整数 */
const ID_PATTERN = /^\w+\.\w+$/;

/**
 * 已知地形 id —— 与 core 接受的地形集合一致（core/src/actions.ts LEGEND_BY_TERRAIN）。
 * 新地形进 core 时同步扩充此表，否则 validate 会拦下 allowedOn 的新 id。
 */
const KNOWN_TERRAIN = ['forest', 'mountain', 'plain', 'swamp', 'water'];

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** JSON 值 → Schema 类型名（整数是 number 的子型，单列便于 type: integer 判定） */
function jsonType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return 'object';
}

function display(v) {
  return JSON.stringify(v);
}

/**
 * 子集解释器：对 instance 跑 schema，错误全部推入 errors（路径式前缀）。
 * 返回值无 —— 只通过 errors 报告，便于一次性列出全部问题。
 */
export function validateValue(instance, schema, at, errors) {
  if (!isPlainObject(schema)) {
    errors.push(`${at}: schema 本身非法（应为对象）`);
    return;
  }
  for (const kw of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(kw) && !META_KEYWORDS.has(kw)) {
      errors.push(`${at}: schema 使用子集之外的关键字 ${kw}（子集边界见 tools/validate-core.mjs 文件头）`);
    }
  }

  if (schema.type !== undefined) {
    const actual = jsonType(instance);
    const want = schema.type;
    const ok = want === 'number' ? actual === 'number' || actual === 'integer' : actual === want;
    if (!ok) {
      errors.push(`${at}: 类型应为 ${want}，实际为 ${actual}（值 ${display(instance)}）`);
      return; // 类型已错，后续关键字判定只会制造噪声
    }
  }

  if (schema.enum !== undefined && !schema.enum.some((e) => e === instance)) {
    errors.push(`${at}: 值 ${display(instance)} 不在枚举 ${display(schema.enum)} 内`);
    return;
  }

  if (typeof instance === 'string' && schema.pattern !== undefined) {
    if (!new RegExp(schema.pattern).test(instance)) {
      errors.push(`${at}: 字符串 ${display(instance)} 不匹配 pattern ${schema.pattern}`);
    }
  }

  if (typeof instance === 'number') {
    if (schema.minimum !== undefined && instance < schema.minimum) {
      errors.push(`${at}: 值 ${display(instance)} 违反 minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && instance > schema.maximum) {
      errors.push(`${at}: 值 ${display(instance)} 违反 maximum ${schema.maximum}`);
    }
  }

  if (Array.isArray(instance)) {
    if (schema.items !== undefined) {
      instance.forEach((item, i) => validateValue(item, schema.items, `${at}[${i}]`, errors));
    }
    return;
  }

  if (isPlainObject(instance)) {
    for (const key of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(instance, key)) {
        errors.push(`${at}: 缺少必填字段 ${key}`);
      }
    }
    const props = schema.properties ?? {};
    const known = new Set(Object.keys(props));
    for (const [key, value] of Object.entries(instance)) {
      if (known.has(key)) {
        validateValue(value, props[key], `${at}[${JSON.stringify(key)}]`, errors);
        continue;
      }
      const extra = schema.additionalProperties;
      if (extra === false) {
        errors.push(`${at}: 不允许的字段 ${key}（additionalProperties: false）`);
      } else if (isPlainObject(extra)) {
        validateValue(value, extra, `${at}[${JSON.stringify(key)}]`, errors);
      }
      // true / 缺省：放行
    }
  }
}

/**
 * design §6.1 交叉引用检查：跨文件约束（schema 单文件表达不了的）。
 * 入参四件 = 内容层各文件的正文对象（不含头）。
 */
export function crossChecks({ units, techs, resources, improvements, balance }) {
  const errors = [];

  // 1. 兵种 / 科技 id 命名规范（显式排序遍历，红线 3）
  for (const id of Object.keys(units).sort()) {
    if (!ID_PATTERN.test(id)) errors.push(`units: 兵种 id ${JSON.stringify(id)} 不符合 ^\\w+\\.\\w+$`);
  }
  for (const id of Object.keys(techs).sort()) {
    if (!ID_PATTERN.test(id)) errors.push(`techs: 科技 id ${JSON.stringify(id)} 不符合 ^\\w+\\.\\w+$`);
  }

  // 2/3. tech 字段引用存在（兵种 / 资源 / 改善 → 科技表）
  const checkTechRef = (owner, key, techId) => {
    if (techId !== undefined && !Object.prototype.hasOwnProperty.call(techs, techId)) {
      errors.push(`${owner}: tech ${JSON.stringify(techId)} 指向不存在的科技`);
    }
  };
  for (const id of Object.keys(units).sort()) checkTechRef(`units.${id}`, 'tech', units[id].tech);
  for (const id of Object.keys(resources).sort()) checkTechRef(`resources.${id}`, 'tech', resources[id].tech);
  for (const id of Object.keys(improvements).sort()) checkTechRef(`improvements.${id}`, 'tech', improvements[id].tech);

  // 3a. requires 指向存在的科技
  for (const id of Object.keys(techs).sort()) {
    for (const req of techs[id].requires ?? []) {
      if (!Object.prototype.hasOwnProperty.call(techs, req)) {
        errors.push(`techs.${id}: requires ${JSON.stringify(req)} 指向不存在的科技`);
      }
    }
  }

  // 3b. 科技树无环（DFS 三色标记；按 id 排序遍历，路径可复现）
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map(Object.keys(techs).sort().map((id) => [id, WHITE]));
  const stack = [];
  const visit = (id) => {
    color.set(id, GRAY);
    stack.push(id);
    for (const req of (techs[id].requires ?? []).slice().sort()) {
      if (!Object.prototype.hasOwnProperty.call(techs, req)) continue; // 悬空已在 3a 报
      const c = color.get(req);
      if (c === GRAY) {
        const cycle = [...stack.slice(stack.indexOf(req)), req].join(' → ');
        errors.push(`techs: 科技树存在环：${cycle}`);
      } else if (c === WHITE) {
        visit(req);
      }
    }
    stack.pop();
    color.set(id, BLACK);
  };
  for (const id of Object.keys(techs).sort()) {
    if (color.get(id) === WHITE) visit(id);
  }

  // 4. 改善 allowedOn ⊆ 已知地形 id
  for (const id of Object.keys(improvements).sort()) {
    for (const terrain of improvements[id].allowedOn ?? []) {
      if (!KNOWN_TERRAIN.includes(terrain)) {
        errors.push(`improvements.${id}: allowedOn 含未知地形 ${JSON.stringify(terrain)}（已知：${KNOWN_TERRAIN.join(', ')}）`);
      }
    }
  }

  // 5. 跨字段数值区间：counter 恰为 2 元非负整数（schema 单值区间 + 子集无 minItems 的补位）
  for (const id of Object.keys(units).sort()) {
    const counter = units[id].counter;
    if (Array.isArray(counter) && counter.length !== 2) {
      errors.push(`units.${id}: counter 应恰有 2 个元素（反击系数 [存活, 垂死]），实际 ${counter.length}`);
    }
  }

  // 6. balance.world 参数一致性（core-spec §4.6 T3）
  if (balance !== undefined && balance !== null && balance.world !== undefined) {
    const w = balance.world;
    // 6a. terrainWeights：键集 = 已知地形、总和 = 1000（§4.6 撒点权重）
    const tw = w.terrainWeights ?? {};
    const twKeys = Object.keys(tw).sort();
    const knownSorted = [...KNOWN_TERRAIN].sort();
    if (twKeys.join(',') !== knownSorted.join(',')) {
      errors.push(`balance.world.terrainWeights: 键集应为已知地形 {${knownSorted.join(', ')}}，实际 {${twKeys.join(', ')}}`);
    }
    const sum = twKeys.reduce((acc, k) => acc + tw[k], 0);
    if (sum !== 1000) errors.push(`balance.world.terrainWeights: 总和应为 1000，实际 ${sum}（§4.6）`);
    // 6b. smoothPriority：已知地形的全排列（平票优先级必须覆盖所有类）
    const sp = w.smoothPriority ?? [];
    if (sp.length !== KNOWN_TERRAIN.length || new Set(sp).size !== sp.length || !sp.every((t) => KNOWN_TERRAIN.includes(t))) {
      errors.push(`balance.world.smoothPriority: 应为已知地形的全排列（${KNOWN_TERRAIN.length} 项互异），实际 ${JSON.stringify(sp)}`);
    }
    // 6c/6d. resourcePlacement / resourceCount / resourceValue 键集一致且 ⊆ resources 数据
    const inResources = (owner, key, ids) => {
      for (const id of [...ids].sort()) {
        if (!Object.prototype.hasOwnProperty.call(resources, id)) {
          errors.push(`${owner}: ${key} 键 ${JSON.stringify(id)} 在 resources 数据中不存在`);
        }
      }
    };
    const pc = Object.keys(w.resourcePlacement ?? {}).sort();
    const pn = Object.keys(w.resourceCount ?? {}).sort();
    if (pc.join(',') !== pn.join(',')) {
      errors.push(`balance.world: resourcePlacement 键集 {${pc.join(', ')}} ≠ resourceCount 键集 {${pn.join(', ')}}`);
    }
    inResources('balance.world.resourcePlacement', 'resource', pc);
    inResources('balance.world.resourceCount', 'resource', pn);
    inResources('balance.world.resourceValue', 'resource', Object.keys(w.resourceValue ?? {}));
    // 6e. minMapSize ≤ maxMapSize
    if (w.minMapSize > w.maxMapSize) {
      errors.push(`balance.world: minMapSize ${w.minMapSize} > maxMapSize ${w.maxMapSize}`);
    }
  }

  return errors;
}

/**
 * 全量校验入口（纯）：五个内容文件 + 五个 schema 的**已解析对象** → 错误数组（空 = 通过）。
 *
 * @param input.data     形如 { 'units.json': <已解析对象|null>, … }，null = 该文件读取/解析失败
 *                       （解析错误由 I/O 宿主自己报告，本核心只负责跳过对应校验 —— 与旧管线一致）
 * @param input.schemas  形如 { 'units.schema.json': <已解析对象|null>, … }
 * @returns {string[]}   路径式错误字符串；schema 校验按 CONTENT_PAIRS 顺序，交叉引用殿后
 */
export function validateDataFiles({ data, schemas }) {
  const errors = [];
  const loaded = {};
  for (const [dataFile, schemaFile] of CONTENT_PAIRS) {
    const d = Object.prototype.hasOwnProperty.call(data, dataFile) ? data[dataFile] : null;
    const s = Object.prototype.hasOwnProperty.call(schemas, schemaFile) ? schemas[schemaFile] : null;
    if (d !== null && s !== null) validateValue(d, s, dataFile, errors);
    loaded[dataFile] = d;
  }
  const { 'units.json': units, 'techs.json': techs, 'resources.json': resources, 'improvements.json': improvements, 'balance.json': balance } = loaded;
  if (units && techs && resources && improvements && balance) {
    errors.push(...crossChecks({
      units: units.units,
      techs: techs.techs,
      resources: resources.resources,
      improvements: improvements.improvements,
      balance,
    }));
  }
  return errors;
}
