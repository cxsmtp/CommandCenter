/**
 * A .zip of a few files, stored without compression (the HTML results pages are small): readable by Windows,
 * macOS and every unzip tool, with no dependency.
 */
import { crc32 } from 'node:zlib';

const u16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};

/** @param {{ name: string, data: Buffer|string }[]} files */
export function zip(files, when = new Date()) {
  const time = ((when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1)) & 0xffff;
  const date = (((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate()) & 0xffff;
  const locals = [];
  const central = [];
  let offset = 0;
  const used = new Set();
  for (const f of files) {
    let name = f.name.replace(/[\\/:*?"<>|]+/g, '_');
    for (let i = 2; used.has(name); i += 1) name = f.name.replace(/(\.[^.]+)?$/, ` (${i})$1`);
    used.add(name);
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), 'utf8');
    const crc = crc32(data);
    // Flag 0x0800: the name is UTF-8.
    const head = Buffer.concat([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(time), u16(date), u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0), nameBuf]);
    locals.push(head, data);
    central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(time), u16(date), u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBuf]));
    offset += head.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(dir.length), u32(offset), u16(0)]);
  return Buffer.concat([...locals, dir, end]);
}
