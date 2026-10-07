/**
 * 零依赖 ZIP 打包（STORE 不压缩）—— 编辑器「导出数据包」用。
 *
 * 格式要点（APPNOTE 6.3.9）：
 * - local file header（签名 0x04034b50）+ 紧跟文件数据，**无数据描述符**（大小前置写入）
 * - central directory（0x02014b50）逐条记录，末尾 EOCD（0x06054b50）
 * - method = 0（STORE）、version needed = 20、DOS 时间固定（1980-01-01 00:00:00，确定性）
 * - 文件名按 UTF-8 写入并置通用位 bit 11（0x0800）
 * CRC32 用标准查表实现（多项式 0xEDB88320，反射式）。
 *
 * 分工红线：本文件只做容器格式，不碰游戏规则；数据内容由调用方（编辑器）组装。
 */

export interface ZipEntry {
  /** zip 内路径（如 "units.json"），不含前导斜杠 */
  name: string;
  bytes: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** 标准 CRC32（反射式，初值/终值异或 0xFFFFFFFF），返回无符号 32 位 */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = (CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** 固定 DOS 日期时间：1980-01-01 00:00:00（最小合法值，产物确定性） */
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

const UTF8_FLAG = 0x0800;

/**
 * 组装 zip 字节（STORE、无数据描述符）。
 * @param entries 按此顺序写入 local header 与 central directory
 */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: { nameBytes: Uint8Array; crc: number; size: number; offset: number }[] = [];
  let offset = 0;

  const push = (b: Uint8Array): void => {
    chunks.push(b);
    offset += b.length;
  };

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.bytes);
    const size = entry.bytes.length;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, UTF8_FLAG, true);
    local.setUint16(8, 0, true); // method = STORE
    local.setUint16(10, DOS_TIME, true);
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true); // compressed size = size
    local.setUint32(22, size, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true); // extra length
    push(new Uint8Array(local.buffer));
    push(nameBytes);
    push(entry.bytes);

    central.push({ nameBytes, crc, size, offset: offset - size - nameBytes.length - 30 });
  }

  const centralStart = offset;
  for (const c of central) {
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true); // version made by
    cd.setUint16(6, 20, true); // version needed
    cd.setUint16(8, UTF8_FLAG, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, DOS_TIME, true);
    cd.setUint16(14, DOS_DATE, true);
    cd.setUint32(16, c.crc, true);
    cd.setUint32(20, c.size, true);
    cd.setUint32(24, c.size, true);
    cd.setUint16(28, c.nameBytes.length, true);
    cd.setUint16(30, 0, true); // extra
    cd.setUint16(32, 0, true); // comment
    cd.setUint16(34, 0, true); // disk number start
    cd.setUint16(36, 0, true); // internal attrs
    cd.setUint32(38, 0, true); // external attrs
    cd.setUint32(42, c.offset, true);
    push(new Uint8Array(cd.buffer));
    push(c.nameBytes);
  }
  const centralSize = offset - centralStart;

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(4, 0, true); // disk number
  eocd.setUint16(6, 0, true); // central dir disk
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, centralStart, true);
  eocd.setUint16(20, 0, true); // comment length
  push(new Uint8Array(eocd.buffer));

  const out = new Uint8Array(offset);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}
