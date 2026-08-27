import type { BrushStroke } from "../recipe/types";

/** Rasterize brush strokes to an opaque weight map (R channel = coverage). Origin top-left. */
export function rasterizeBrushStrokes(strokes: BrushStroke[], w: number, h: number): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return new ImageData(canvas.width, canvas.height);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const minEdge = Math.min(canvas.width, canvas.height);

  for (const stroke of strokes) {
    if (!stroke.points.length) continue;
    const radius = Math.max(1, (stroke.size / 100) * minEdge * 0.5);
    const hardness = Math.min(1, Math.max(0, stroke.hardness / 100));
    const opacity = Math.min(1, Math.max(0, stroke.opacity / 100));
    ctx.globalCompositeOperation = stroke.erase ? "destination-out" : "source-over";

    const stamp = (x: number, y: number) => {
      const px = x * canvas.width;
      const py = y * canvas.height;
      const soft = Math.max(0.001, 1 - hardness);
      const grad = ctx.createRadialGradient(px, py, radius * (1 - soft), px, py, radius);
      const a = stroke.erase ? opacity : opacity;
      grad.addColorStop(0, `rgba(255,255,255,${a})`);
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
    };

    if (stroke.points.length === 1) {
      stamp(stroke.points[0][0], stroke.points[0][1]);
      continue;
    }

    for (let i = 1; i < stroke.points.length; i++) {
      const [x0, y0] = stroke.points[i - 1];
      const [x1, y1] = stroke.points[i];
      const dx = (x1 - x0) * canvas.width;
      const dy = (y1 - y0) * canvas.height;
      const dist = Math.hypot(dx, dy);
      const step = Math.max(1, radius * 0.35);
      const n = Math.max(1, Math.ceil(dist / step));
      for (let s = 0; s <= n; s++) {
        const t = s / n;
        stamp(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      }
    }
  }

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export function rgbToHueChroma(r: number, g: number, b: number): { hue: number; chroma: number; luma: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-6) return { hue: 0, chroma: 0, luma: l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { hue: h, chroma: s, luma: l };
}
