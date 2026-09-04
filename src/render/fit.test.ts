import { describe, expect, it } from "vitest";
import { fitCanvasSize } from "./preview";

describe("preview fit sizing", () => {
  it("fills the host for a small image (upscales)", () => {
    const size = fitCanvasSize(1000, 800, 200, 100);
    expect(size.w).toBe(1000);
    expect(size.h).toBe(500);
  });

  it("letterboxes a landscape image in a square host", () => {
    const size = fitCanvasSize(800, 800, 1600, 900);
    expect(size.w).toBe(800);
    expect(size.h).toBe(450);
  });

  it("does not stretch aspect when fitting", () => {
    const size = fitCanvasSize(640, 480, 1920, 1080);
    expect(size.w / size.h).toBeCloseTo(1920 / 1080, 2);
  });
});
