import { describe, expect, it } from "vitest";
import {
  analyzeScene,
  suggestHighlightMask,
  suggestSkyMask,
  suggestSubjectMask,
  summarizeScene,
} from "./scene";
import { analyzePixels } from "../recipe/auto";

function makeImage(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { data, width, height, colorSpace: "srgb" } as ImageData;
}

describe("analyzeScene", () => {
  it("reports brighter top region for a sky gradient", () => {
    const img = makeImage(60, 60, (_x, y) => {
      if (y < 20) return [160, 190, 240];
      if (y < 40) return [90, 110, 80];
      return [40, 50, 30];
    });
    const scene = analyzeScene(img);
    expect(scene.regions.top.meanLuma).toBeGreaterThan(scene.regions.bottom.meanLuma);
    expect(scene.suggestedMasks.some((m) => m.kind === "linear")).toBe(true);
    const sky = suggestSkyMask(scene.regions, scene.global);
    expect(sky?.kind).toBe("linear");
    expect(summarizeScene(scene)).toContain("suggestedMasks");
  });

  it("suggests a radial around a dark center subject", () => {
    const img = makeImage(50, 50, (x, y) => {
      const dx = x - 25;
      const dy = y - 25;
      if (dx * dx + dy * dy < 80) return [30, 25, 20];
      return [180, 180, 175];
    });
    const scene = analyzeScene(img);
    const subject = suggestSubjectMask(scene.grid, scene.regions);
    expect(subject?.kind).toBe("radial");
    if (subject?.kind === "radial") {
      expect(subject.cx).toBeGreaterThan(0.3);
      expect(subject.cx).toBeLessThan(0.7);
      expect(subject.cy).toBeGreaterThan(0.3);
      expect(subject.cy).toBeLessThan(0.7);
    }
  });

  it("suggests a luminance mask when highlights clip", () => {
    const img = makeImage(32, 32, () => [255, 255, 255] as [number, number, number]);
    const global = analyzePixels(img.data, 4);
    const mask = suggestHighlightMask(global);
    expect(mask?.kind).toBe("luminance_range");
  });
});
