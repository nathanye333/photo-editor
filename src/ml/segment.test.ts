import { describe, expect, it } from "vitest";
import { heuristicSegment, segmentImage, setSegmenterForTests } from "./segment";
import { createSemanticMask } from "../recipe/defaults";
import { applyPatch } from "../recipe/patch";
import { defaultRecipe } from "../recipe/defaults";
import { semanticCoverageToRgba } from "../render/preview";

function flat(w: number, h: number, rgb: [number, number, number]): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h, colorSpace: "srgb" } as ImageData;
}

describe("segment heuristics", () => {
  it("marks sky in the upper cool band", () => {
    const img = flat(40, 40, [170, 200, 245]);
    // darken bottom
    for (let y = 25; y < 40; y++) {
      for (let x = 0; x < 40; x++) {
        const i = (y * 40 + x) * 4;
        img.data[i] = 40;
        img.data[i + 1] = 50;
        img.data[i + 2] = 30;
      }
    }
    const sky = heuristicSegment(img, "sky");
    let top = 0;
    let bot = 0;
    for (let y = 0; y < 10; y++) for (let x = 0; x < 40; x++) top += sky.alpha[y * 40 + x];
    for (let y = 30; y < 40; y++) for (let x = 0; x < 40; x++) bot += sky.alpha[y * 40 + x];
    expect(top).toBeGreaterThan(bot);
  });

  it("uses injected segmenter without downloading models", async () => {
    setSegmenterForTests(async (image, label) => ({
      width: image.width,
      height: image.height,
      alpha: new Uint8Array(image.width * image.height).fill(label === "sky" ? 200 : 10),
      model: "mock",
    }));
    const res = await segmentImage(flat(8, 8, [0, 0, 0]), "sky");
    expect(res.model).toBe("mock");
    expect(res.alpha[0]).toBe(200);
    setSegmenterForTests(null);
  });
});

describe("semantic mask recipe", () => {
  it("round-trips coverage through applyPatch", () => {
    const alpha = Array.from({ length: 4 }, (_, i) => (i < 2 ? 255 : 0));
    const mask = createSemanticMask({
      id: "sem-1",
      label: "subject",
      model: "mock",
      width: 2,
      height: 2,
      alpha,
    });
    const next = applyPatch(defaultRecipe(), { masks: { upsert: [mask] } }, "absolute");
    const c = next.masks[0].components[0];
    expect(c.type).toBe("semantic");
    if (c.type === "semantic") {
      expect(c.width).toBe(2);
      expect(c.height).toBe(2);
      expect(c.alpha).toEqual(alpha);
    }
  });

  it("upsamples coverage to rgba weights", () => {
    const rgba = semanticCoverageToRgba([255, 0, 0, 0], 2, 2, 4, 4);
    expect(rgba.length).toBe(4 * 4 * 4);
    expect(rgba[0]).toBe(255);
  });
});
