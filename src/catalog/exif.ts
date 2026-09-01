/**
 * Minimal EXIF reader for the tags the develop pipeline needs: camera and lens
 * for lens-profile matching, shot settings for the metadata panel, and the DNG
 * as-shot neutral for white balance. Handles JPEG APP1 and bare TIFF headers
 * (which covers TIFF-based raw such as DNG, CR2, NEF and ARW).
 */

export type ExifData = {
  tags: Record<string, string>;
  /** DNG AsShotNeutral (tag 0xC628) as r/g/b multipliers. */
  asShotNeutral?: [number, number, number];
};

const IFD0_TAGS: Record<number, string> = {
  0x010f: "Make",
  0x0110: "Model",
  0x0112: "Orientation",
};

const EXIF_TAGS: Record<number, string> = {
  0x829a: "ExposureTime",
  0x829d: "FNumber",
  0x8827: "ISO",
  0x9003: "DateTimeOriginal",
  0x920a: "FocalLength",
  0xa434: "LensModel",
};

const TAG_EXIF_IFD = 0x8769;
const TAG_AS_SHOT_NEUTRAL = 0xc628;

const TYPE_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

class Reader {
  constructor(
    private readonly view: DataView,
    private readonly little: boolean,
  ) {}

  u16(offset: number): number {
    return this.view.getUint16(offset, this.little);
  }

  u32(offset: number): number {
    return this.view.getUint32(offset, this.little);
  }

  i32(offset: number): number {
    return this.view.getInt32(offset, this.little);
  }

  ascii(offset: number, length: number): string {
    let out = "";
    for (let i = 0; i < length; i++) {
      const code = this.view.getUint8(offset + i);
      if (code === 0) break;
      out += String.fromCharCode(code);
    }
    return out.trim();
  }

  get bytes(): number {
    return this.view.byteLength;
  }
}

/** Returns the offset of the TIFF header, or -1 when the buffer has no EXIF. */
function tiffOffset(view: DataView): number {
  if (view.byteLength < 8) return -1;
  const first = view.getUint16(0, false);
  if (first === 0x4949 || first === 0x4d4d) return 0;
  if (first !== 0xffd8) return -1;

  let offset = 2;
  while (offset + 4 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return -1;
    const marker = view.getUint8(offset + 1);
    const size = view.getUint16(offset + 2, false);
    if (marker === 0xe1 && offset + 10 < view.byteLength) {
      const tag = String.fromCharCode(
        view.getUint8(offset + 4),
        view.getUint8(offset + 5),
        view.getUint8(offset + 6),
        view.getUint8(offset + 7),
      );
      if (tag === "Exif") return offset + 10;
    }
    // Start of scan: image data follows, so no more metadata segments.
    if (marker === 0xda) return -1;
    offset += 2 + size;
  }
  return -1;
}

function readValue(
  r: Reader,
  base: number,
  type: number,
  count: number,
  valueOffset: number,
): string | number[] | null {
  const size = TYPE_SIZES[type];
  if (!size) return null;
  const total = size * count;
  const at = total <= 4 ? valueOffset : base + r.u32(valueOffset);
  if (at < 0 || at >= r.bytes) return null;

  // Only the first 256KB of the file is read, so a string can run past the end.
  if (type === 2) return r.ascii(at, Math.min(count, r.bytes - at));
  if (at + total > r.bytes) return null;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const p = at + i * size;
    if (type === 1 || type === 7) out.push(r.u16(p) >> 8);
    else if (type === 3) out.push(r.u16(p));
    else if (type === 4) out.push(r.u32(p));
    else if (type === 9) out.push(r.i32(p));
    else if (type === 5) out.push(ratio(r.u32(p), r.u32(p + 4)));
    else if (type === 10) out.push(ratio(r.i32(p), r.i32(p + 4)));
  }
  return out;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function format(name: string, value: string | number[]): string {
  if (typeof value === "string") return value;
  const first = value[0];
  if (first === undefined) return "";
  if (name === "ExposureTime") return first >= 1 ? `${first}s` : `1/${Math.round(1 / first)}s`;
  if (name === "FNumber") return `f/${round(first, 1)}`;
  if (name === "FocalLength") return `${round(first, 0)}mm`;
  return String(round(first, 2));
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function parseExif(bytes: Uint8Array): ExifData {
  const empty: ExifData = { tags: {} };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const base = tiffOffset(view);
  if (base < 0 || base + 8 > view.byteLength) return empty;

  const little = view.getUint16(base, false) === 0x4949;
  const r = new Reader(view, little);
  if (r.u16(base + 2) !== 0x002a) return empty;

  const out: ExifData = { tags: {} };
  const readIfd = (ifdOffset: number, names: Record<number, string>) => {
    if (ifdOffset + 2 > r.bytes) return;
    const count = r.u16(ifdOffset);
    for (let i = 0; i < count; i++) {
      const entry = ifdOffset + 2 + i * 12;
      if (entry + 12 > r.bytes) return;
      const tag = r.u16(entry);
      const type = r.u16(entry + 2);
      const items = r.u32(entry + 4);
      if (tag === TAG_EXIF_IFD) {
        readIfd(base + r.u32(entry + 8), EXIF_TAGS);
        continue;
      }
      if (tag === TAG_AS_SHOT_NEUTRAL) {
        const value = readValue(r, base, type, items, entry + 8);
        if (Array.isArray(value) && value.length >= 3) {
          out.asShotNeutral = [value[0], value[1], value[2]];
        }
        continue;
      }
      const name = names[tag];
      if (!name) continue;
      const value = readValue(r, base, type, items, entry + 8);
      if (value === null) continue;
      const text = format(name, value);
      if (text) out.tags[name] = text;
    }
  };

  readIfd(base + r.u32(base + 4), IFD0_TAGS);
  return out;
}
