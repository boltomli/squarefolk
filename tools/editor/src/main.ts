/**
 * Squarefolk 数据工坊 —— 前端主逻辑（M1：源码编辑 + 实时校验 + 保存 + diff + 导出）。
 *
 * 分工红线（design §6.1）：本文件不实现任何规则/校验 —— 校验 = tools/validate-core.mjs 纯核心，
 * 导出 = tools/dump-core.mjs 纯核心，diff = ./diff.ts（通用 JSON 结构比较，无游戏语义）。
 * 本文件只做：IPC 编排、防抖调度、DOM 渲染。
 */
import './style.css';
import { invoke } from '@tauri-apps/api/core';
import { CONTENT_PAIRS, validateDataFiles } from '../../validate-core.mjs';
import { dumpMarkdown } from '../../dump-core.mjs';
import { structuredDiff, type DiffEntry } from './diff';
import { parseTable, setCellValue, addRecord, removeRecord } from './table';

const DEBOUNCE_MS = 300;

/** 可表格化的四件 id 记录文件（balance 是嵌套配置，只走源码视图） */
const RECORD_FILES = new Set(['units.json', 'techs.json', 'improvements.json', 'resources.json']);

// ── DOM ──
const elFileList = document.getElementById('file-list') as HTMLElement;
const elActiveName = document.getElementById('active-name') as HTMLElement;
const elDirty = document.getElementById('dirty-flag') as HTMLElement;
const elSave = document.getElementById('btn-save') as HTMLButtonElement;
const elDiff = document.getElementById('btn-diff') as HTMLButtonElement;
const elExport = document.getElementById('btn-export') as HTMLButtonElement;
const elStatus = document.getElementById('status') as HTMLElement;
const elSource = document.getElementById('source') as HTMLTextAreaElement;
const elPanelErrors = document.getElementById('panel-errors') as HTMLElement;
const elPanelDiff = document.getElementById('panel-diff') as HTMLElement;
const elPanelPreview = document.getElementById('panel-preview') as HTMLElement;
const elTablePane = document.getElementById('table-pane') as HTMLElement;
const elTableScroll = document.getElementById('table-scroll') as HTMLElement;
const elEditorPane = document.getElementById('editor-pane') as HTMLElement;
const elBtnSource = document.getElementById('btn-view-source') as HTMLButtonElement;
const elBtnTable = document.getElementById('btn-view-table') as HTMLButtonElement;
const elNewRowId = document.getElementById('new-row-id') as HTMLInputElement;
const elAddRow = document.getElementById('btn-add-row') as HTMLButtonElement;

const TAB_PANELS: Record<string, { tab: HTMLElement; panel: HTMLElement }> = {
  errors: { tab: document.getElementById('tab-errors') as HTMLElement, panel: elPanelErrors },
  diff: { tab: document.getElementById('tab-diff') as HTMLElement, panel: elPanelDiff },
  preview: { tab: document.getElementById('tab-preview') as HTMLElement, panel: elPanelPreview },
};

// ── 状态 ──
/** 五件内容文件的当前缓冲（键 = 文件名，CONTENT_PAIRS 显式序） */
const contents: Record<string, string> = {};
/** 启动时从磁盘读到的已保存文本（dirty = contents ≠ saved） */
const saved: Record<string, string> = {};
/** 已解析的 schema 对象（键 = schema 文件名）—— 启动时装载一次，编辑期不变 */
const schemas: Record<string, unknown> = {};
let active = CONTENT_PAIRS[0][0] as string;
let debounceTimer: number | undefined;
let validateSeq = 0;
let view: 'source' | 'table' = 'source';

function setStatus(text: string, isError = false): void {
  elStatus.textContent = text;
  elStatus.classList.toggle('error', isError);
}

function showTab(name: 'errors' | 'diff' | 'preview'): void {
  for (const [key, { tab, panel }] of Object.entries(TAB_PANELS)) {
    const on = key === name;
    tab.classList.toggle('active', on);
    panel.hidden = !on;
  }
}

function renderFileList(): void {
  elFileList.textContent = '';
  for (const [dataFile] of CONTENT_PAIRS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'file';
    btn.dataset.file = dataFile;
    const dirty = contents[dataFile] !== saved[dataFile];
    btn.textContent = `${dataFile}${dirty ? ' ●' : ''}`;
    if (dataFile === active) btn.classList.add('active');
    btn.addEventListener('click', () => selectFile(dataFile));
    elFileList.appendChild(btn);
  }
}

function flushActive(): void {
  // 表格视图下 textarea 隐藏且值可能过期 —— 只在源码视图回读，避免旧值覆盖表格改动
  if (view === 'source') contents[active] = elSource.value;
}

function selectFile(dataFile: string): void {
  flushActive();
  active = dataFile;
  elSource.value = contents[dataFile] ?? '';
  elActiveName.textContent = dataFile;
  if (view === 'table' && !RECORD_FILES.has(dataFile)) setView('source');
  else if (view === 'table') renderTable();
  updateDirty();
  renderFileList();
  scheduleValidate();
}

function updateDirty(): void {
  const dirty = contents[active] !== saved[active];
  elDirty.hidden = !dirty;
  elSave.disabled = !dirty;
}

// ── M2 表格视图 ──
function setView(next: 'source' | 'table'): void {
  if (next === 'table' && !RECORD_FILES.has(active)) return;
  flushActive();
  view = next;
  const isTable = next === 'table';
  elEditorPane.hidden = isTable;
  elTablePane.hidden = !isTable;
  elBtnSource.classList.toggle('active', !isTable);
  elBtnTable.classList.toggle('active', isTable);
  elBtnTable.disabled = !RECORD_FILES.has(active);
  if (isTable) renderTable();
  else elSource.value = contents[active] ?? '';
}

/** 单元格提交：table.ts 纯函数改文本 → 更新缓冲 → 重建表格 + 防抖校验；失败仅提示不写 */
function commitCell(id: string, column: string, input: HTMLInputElement): void {
  const result = setCellValue(contents[active], active.replace(/\.json$/, ''), id, column, input.value);
  if (!result.ok) {
    setStatus(result.error, true);
    input.value = column in (active ? {} : {}) ? input.value : input.value; // 保留原输入待改正
    return;
  }
  contents[active] = result.text;
  setStatus(`已改 ${id}.${column}（未保存）`);
  renderTable();
  scheduleValidate();
  updateDirty();
  renderFileList();
}

function renderTable(): void {
  const contentKey = active.replace(/\.json$/, '');
  const parsed = parseTable(contents[active] ?? '', contentKey);
  elTableScroll.textContent = '';
  if (!parsed.ok) {
    const err = document.createElement('p');
    err.className = 'error';
    err.textContent = `表格视图不可用：${parsed.error}（可回源码视图修正）`;
    elTableScroll.appendChild(err);
    return;
  }
  const { columns, ids, rows } = parsed.data;
  const table = document.createElement('table');
  table.className = 'grid';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const col of ['id', ...columns, '操作']) {
    const th = document.createElement('th');
    th.textContent = col;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const id of ids) {
    const tr = document.createElement('tr');
    const idCell = document.createElement('th');
    idCell.textContent = id;
    idCell.title = id;
    tr.appendChild(idCell);
    for (const col of columns) {
      const td = document.createElement('td');
      const raw = rows[id][col];
      if (raw !== undefined) {
        const input = document.createElement('input');
        input.value = typeof raw === 'string' ? raw : JSON.stringify(raw);
        input.dataset.col = col;
        input.addEventListener('change', () => commitCell(id, col, input));
        td.appendChild(input);
      } else {
        td.className = 'absent';
        const input = document.createElement('input');
        input.placeholder = '—';
        input.dataset.col = col;
        input.addEventListener('change', () => commitCell(id, col, input));
        td.appendChild(input);
      }
      tr.appendChild(td);
    }
    const ops = document.createElement('td');
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '删行';
    del.addEventListener('click', () => {
      const result = removeRecord(contents[active], contentKey, id);
      if (!result.ok) {
        setStatus(result.error, true);
        return;
      }
      contents[active] = result.text;
      setStatus(`已删 ${id}（未保存）`);
      renderTable();
      scheduleValidate();
      updateDirty();
      renderFileList();
    });
    ops.appendChild(del);
    tr.appendChild(ops);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  elTableScroll.appendChild(table);
}

// ── 实时校验（防抖） ──
function scheduleValidate(): void {
  if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    debounceTimer = undefined;
    runValidate();
  }, DEBOUNCE_MS);
}

/** 解析五件缓冲 + 调 validate-core；解析失败的文件按 null 传入并单列解析错误（与 CLI 壳同语义） */
function runValidate(): string[] {
  flushActive();
  const seq = ++validateSeq;
  const data: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const [dataFile] of CONTENT_PAIRS) {
    try {
      data[dataFile] = JSON.parse(contents[dataFile] ?? '');
    } catch (e) {
      data[dataFile] = null;
      errors.push(`${dataFile}: 解析失败 — ${(e as Error).message}`);
    }
  }
  errors.push(...validateDataFiles({ data, schemas }));
  if (seq === validateSeq) renderErrors(errors);
  updateDirty();
  renderFileList();
  return errors;
}

function renderErrors(errors: string[]): void {
  elPanelErrors.textContent = '';
  if (errors.length === 0) {
    const ok = document.createElement('p');
    ok.className = 'ok';
    ok.textContent = '✓ 0 错误 — schema 校验 + 交叉引用检查全通过';
    elPanelErrors.appendChild(ok);
    return;
  }
  const ul = document.createElement('ul');
  ul.className = 'error-list';
  for (const line of errors) {
    const li = document.createElement('li');
    li.textContent = line;
    ul.appendChild(li);
  }
  elPanelErrors.appendChild(ul);
}

// ── 保存 ──
async function saveActive(): Promise<void> {
  flushActive();
  const content = contents[active];
  elSave.disabled = true;
  setStatus('保存中…');
  try {
    await invoke<void>('write_data_file', { name: active, content });
    saved[active] = content;
    setStatus(`已保存 ${active}，再校验中…`);
    const errors = runValidate();
    setStatus(errors.length === 0 ? `已保存 ${active} ✓` : `已保存 ${active}（校验 ${errors.length} 个错误）`, errors.length > 0);
    showTab('errors');
  } catch (e) {
    setStatus(`保存失败：${e}`, true);
  } finally {
    updateDirty();
    renderFileList();
  }
}

// ── diff ──
function diffEntryLine(e: DiffEntry): string {
  const show = (v: unknown) => (v === undefined ? '' : JSON.stringify(v));
  if (e.kind === 'add') return `+ ${e.path} = ${show(e.after)}`;
  if (e.kind === 'del') return `- ${e.path} = ${show(e.before)}`;
  return `~ ${e.path}: ${show(e.before)} → ${show(e.after)}`;
}

async function showDiff(): Promise<void> {
  flushActive();
  showTab('diff');
  elPanelDiff.textContent = '';
  const head = document.createElement('p');
  head.className = 'dim';
  head.textContent = `比较 data/${active} 与 git HEAD…`;
  elPanelDiff.appendChild(head);
  try {
    const headText = await invoke<string>('git_show_head', { path: `data/${active}` });
    const result = structuredDiff(active, headText, contents[active] ?? '');
    elPanelDiff.textContent = '';
    if (result.entries.length === 0) {
      const none = document.createElement('p');
      none.className = 'ok';
      none.textContent = '✓ 与 HEAD 无差异';
      elPanelDiff.appendChild(none);
      return;
    }
    const summary = document.createElement('p');
    summary.className = 'dim';
    summary.textContent = `${result.mode === 'json' ? 'JSON 路径 diff' : '行 diff（存在解析失败侧）'}：${result.entries.length} 处差异`;
    elPanelDiff.appendChild(summary);
    const pre = document.createElement('pre');
    pre.className = 'diff-list';
    pre.textContent = result.entries.map(diffEntryLine).join('\n');
    elPanelDiff.appendChild(pre);
  } catch (e) {
    elPanelDiff.textContent = '';
    const err = document.createElement('p');
    err.className = 'error';
    err.textContent = `diff 失败：${e}`;
    elPanelDiff.appendChild(err);
  }
}

// ── 导出（dump-core 共用） ──
function buildMarkdown(): string | { error: string } {
  flushActive();
  const parsed: Record<string, unknown> = {};
  for (const [dataFile] of CONTENT_PAIRS) {
    try {
      parsed[dataFile] = JSON.parse(contents[dataFile] ?? '');
    } catch {
      return { error: `无法导出：${dataFile} 解析失败` };
    }
  }
  return dumpMarkdown({
    units: parsed['units.json'],
    techs: parsed['techs.json'],
    improvements: parsed['improvements.json'],
    resources: parsed['resources.json'],
    balance: parsed['balance.json'],
  } as Parameters<typeof dumpMarkdown>[0]);
}

function showExport(): void {
  const result = buildMarkdown();
  showTab('preview');
  if (typeof result !== 'string') {
    setStatus(result.error, true);
    return;
  }
  elPanelPreview.textContent = '';
  const bar = document.createElement('div');
  bar.className = 'preview-bar';
  const download = document.createElement('button');
  download.type = 'button';
  download.textContent = '下载 squarefolk-data.md';
  download.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([result], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'squarefolk-data.md';
    a.click();
    URL.revokeObjectURL(url);
  });
  bar.appendChild(download);
  elPanelPreview.appendChild(bar);
  const pre = document.createElement('pre');
  pre.className = 'markdown';
  pre.textContent = result;
  elPanelPreview.appendChild(pre);
  setStatus(`已生成 Markdown（${result.length} 字节）`);
}

// ── 启动 ──
async function boot(): Promise<void> {
  setStatus('装载 data/…');
  try {
    for (const [dataFile, schemaFile] of CONTENT_PAIRS) {
      schemas[schemaFile] = JSON.parse(await invoke<string>('read_data_file', { name: `schemas/${schemaFile}` }));
      contents[dataFile] = await invoke<string>('read_data_file', { name: dataFile });
      saved[dataFile] = contents[dataFile];
    }
  } catch (e) {
    setStatus(`装载失败：${e}`, true);
    return;
  }
  elSource.value = contents[active];
  elActiveName.textContent = active;
  renderFileList();
  updateDirty();
  const errors = runValidate();
  setStatus(`就绪 — 5 个文件，${errors.length} 个校验错误`);
}

elSource.addEventListener('input', () => {
  contents[active] = elSource.value;
  updateDirty();
  scheduleValidate();
});
elSource.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    if (!elSave.disabled) void saveActive();
  }
});
elSave.addEventListener('click', () => void saveActive());
elDiff.addEventListener('click', () => void showDiff());
elExport.addEventListener('click', showExport);
for (const [name, { tab }] of Object.entries(TAB_PANELS)) {
  tab.addEventListener('click', () => showTab(name as 'errors' | 'diff' | 'preview'));
}

void boot();
