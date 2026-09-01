import { describe, expect, it } from "vitest";
import { parseExif } from "./exif";

type Entry = { tag: number; type: number; value: number[] | string };

const entryCount = (entry: Entry) =>
  typeof entry.value === "string" ? entry.value.length + 1 : entry.value.length;

/** Builds a little-endian TIFF block so the parser can be tested without fixtures. */
function tiff(ifd0: Entry[], exifIfd: Entry[] = []): Uint8Array {
  const HEADER = 8;
  const blockSize = (entries: Entry[]) => 2 + entries.length * 12 + 4;
  const ifd0Entries: Entry[] = [...ifd0];
  const exifOffset = HEADER + blockSize(ifd0Entries) + (exifIfd.length ? 12 : 0);
  if (exifIfd.length) {
    ifd0Entries.push({ tag: 0x8769, type: 4, value: [exifOffset] });
  }

  const heapStart = HEADER + blockSize(ifd0Entries) + (exifIfd.length ? blockSize(exifIfd) : 0);
  const heap: number[] = [];
  const bytes: number[] = [];

  const push16 = (target: number[], v: number) => target.push(v & 0xff, (v >> 8) & 0xff);
  const push32 = (target: number[], v: number) =>
    target.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);

  const encode = (entry: Entry): number[] => {
    const out: number[] = [];
    if (typeof entry.value === "string") {
      for (const ch of entry.value) out.push(ch.charCodeAt(0));
      out.push(0);
      return out;
    }
    for (const v of entry.value) {
      if (entry.type === 3) push16(out, v);
      else if (entry.type === 4) push32(out, v);
      else if (entry.type === 5) {
        push32(out, Math.round(v * 1000));
        push32(out, 1000);
      }
    }
    return out;
  };

  const writeIfd = (entries: Entry[]) => {
    push16(bytes, entries.length);
    for (const entry of entries) {
      push16(bytes, entry.tag);
      push16(bytes, entry.type);
      push32(bytes, entryCount(entry));
      const data = encode(entry);
      if (data.length <= 4) {
        while (data.length < 4) data.push(0);
        bytes.push(...data);
      } else {
        push32(bytes, heapStart + heap.length);
        heap.push(...data);
      }
    }
    push32(bytes, 0);
  };

  bytes.push(0x49, 0x49);
  push16(bytes, 0x2a);
  push32(bytes, HEADER);
  writeIfd(ifd0Entries);
  if (exifIfd.length) writeIfd(exifIfd);
  bytes.push(...heap);
  return new Uint8Array(bytes);
}

function jpegWrap(exif: Uint8Array): Uint8Array {
  const size = exif.length + 8;
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe1,
    (size >> 8) & 0xff,
    size & 0xff,
    0x45,
    0x78,
    0x69,
    0x66,
    0,
    0,
    ...exif,
  ]);
}

describe("parseExif", () => {
  it("reads camera, lens and shot settings from a TIFF header", () => {
    const bytes = tiff(
      [
        { tag: 0x010f, type: 2, value: "Canon" },
        { tag: 0x0110, type: 2, value: "Canon R5" },
      ],
      [
        { tag: 0xa434, type: 2, value: "RF 24-70mm F2.8" },
        { tag: 0x920a, type: 5, value: [35] },
        { tag: 0x829d, type: 5, value: [2.8] },
        { tag: 0x8827, type: 3, value: [400] },
        { tag: 0x829a, type: 5, value: [0.008] },
      ],
    );
    const { tags } = parseExif(bytes);
    expect(tags.Make).toBe("Canon");
    expect(tags.Model).toBe("Canon R5");
    expect(tags.LensModel).toBe("RF 24-70mm F2.8");
    expect(tags.FocalLength).toBe("35mm");
    expect(tags.FNumber).toBe("f/2.8");
    expect(tags.ISO).toBe("400");
    expect(tags.ExposureTime).toBe("1/125s");
  });

  it("finds EXIF inside a JPEG APP1 segment", () => {
    const bytes = jpegWrap(tiff([{ tag: 0x0110, type: 2, value: "X-T5" }]));
    expect(parseExif(bytes).tags.Model).toBe("X-T5");
  });

  it("reads the DNG as-shot neutral", () => {
    const bytes = tiff([{ tag: 0xc628, type: 5, value: [0.48, 1, 0.72] }]);
    const { asShotNeutral } = parseExif(bytes);
    expect(asShotNeutral?.[0]).toBeCloseTo(0.48, 3);
    expect(asShotNeutral?.[1]).toBeCloseTo(1, 3);
    expect(asShotNeutral?.[2]).toBeCloseTo(0.72, 3);
  });

  it("returns nothing for buffers without EXIF", () => {
    expect(parseExif(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])).tags).toEqual({});
    expect(parseExif(new Uint8Array()).tags).toEqual({});
  });
});
