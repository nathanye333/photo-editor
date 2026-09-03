/**
 * Local semantic segmentation for Field.
 *
 * Uses Transformers.js when available; falls back to heuristic coverage from
 * scene analysis so CI and offline runs never need a model download.
 */

export type SemanticLabel = "subject" | "sky" | "person";

export type SegmentResult = {
  width: number;
  height: number;
  alpha: Uint8Array;
  model: string;
};

export type Segmenter = (image: ImageData, label: SemanticLabel) => Promise<SegmentResult>;

const ADE_SKY = new Set([2]); // sky
const ADE_PERSON = new Set([12]); // person

let pipelinePromise: Promise<unknown> | null = null;
let injectSegmenter: Segmenter | null = null;

/** Test hook — bypass Transformers.js. */
export function setSegmenterForTests(fn: Segmenter | null) {
  injectSegmenter = fn;
}

async function loadPipeline(): Promise<unknown> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const mod = await import("@huggingface/transformers");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pipe = await (mod as any).pipeline(
        "image-segmentation",
        "Xenova/segformer-b0-finetuned-ade-512-512",
        { progress_callback: undefined },
      );
      return pipe;
    })().catch((err) => {
      pipelinePromise = null;
      throw err;
    });
  }
  return pipelinePromise;
}

/** Heuristic coverage used when the ML model is unavailable. */
export function heuristicSegment(image: ImageData, label: SemanticLabel): SegmentResult {
  const { width, height, data } = image;
  const alpha = new Uint8Array(width * height);
  const LUMA = [0.2126, 0.7152, 0.0722] as const;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const luma = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b;
      const nx = x / width;
      const ny = y / height;
      let v = 0;
      if (label === "sky") {
        const cool = b >= r - 0.05;
        v = ny < 0.4 && luma > 0.42 && cool ? Math.min(255, Math.round((0.55 - ny) * 500 + luma * 80)) : 0;
      } else {
        // subject / person: center-weighted midtones
        const dx = nx - 0.5;
        const dy = ny - 0.5;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const center = Math.max(0, 1 - dist * 2.2);
        const mid = 1 - Math.abs(luma - 0.4) * 1.6;
        v = Math.round(Math.max(0, Math.min(1, center * mid)) * 255);
      }
      alpha[y * width + x] = v;
    }
  }
  return { width, height, alpha, model: "heuristic" };
}

function downsample(image: ImageData, maxEdge = 384): ImageData {
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  if (scale >= 0.999) return image;
  const w = Math.max(1, Math.round(image.width * scale));
  const h = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return image;
  const src = document.createElement("canvas");
  src.width = image.width;
  src.height = image.height;
  const sctx = src.getContext("2d");
  if (!sctx) return image;
  sctx.putImageData(image, 0, 0);
  ctx.drawImage(src, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

function upsampleAlpha(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  const out = new Uint8Array(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / dstH));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / dstW));
      out[y * dstW + x] = src[sy * srcW + sx];
    }
  }
  return out;
}

async function transformersSegment(image: ImageData, label: SemanticLabel): Promise<SegmentResult> {
  const small = downsample(image, 384);
  const canvas = document.createElement("canvas");
  canvas.width = small.width;
  canvas.height = small.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context");
  ctx.putImageData(small, 0, 0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipe = (await loadPipeline()) as any;
  const outputs = await pipe(canvas);
  const alpha = new Uint8Array(small.width * small.height);
  const wanted =
    label === "sky" ? ADE_SKY : label === "person" ? ADE_PERSON : null;

  // Transformers.js image-segmentation returns an array of { label, score, mask }
  // where mask may be a RawImage / { data, width, height }.
  const items = Array.isArray(outputs) ? outputs : [outputs];
  for (const item of items) {
    const name = String(item.label ?? item.class ?? "").toLowerCase();
    const id = typeof item.id === "number" ? item.id : -1;
    const match =
      (wanted && wanted.has(id)) ||
      (label === "sky" && name.includes("sky")) ||
      (label === "person" && (name.includes("person") || name.includes("people"))) ||
      (label === "subject" &&
        !name.includes("sky") &&
        !name.includes("wall") &&
        !name.includes("floor") &&
        !name.includes("ceiling"));
    if (!match && label !== "subject") continue;
    if (label === "subject" && (name.includes("sky") || name.includes("wall") || name.includes("floor"))) {
      continue;
    }
    const mask = item.mask ?? item;
    const data: ArrayLike<number> =
      mask.data ?? mask.data?.data ?? mask;
    const mw = mask.width ?? small.width;
    const mh = mask.height ?? small.height;
    if (!data || typeof (data as ArrayLike<number>).length !== "number") continue;
    for (let i = 0; i < alpha.length && i < (data as ArrayLike<number>).length; i++) {
      const v = (data as ArrayLike<number>)[i];
      // masks are often 0/255 or 0..1
      const a = v <= 1 ? Math.round(v * 255) : Math.round(v);
      if (a > alpha[i]) alpha[i] = Math.min(255, a);
    }
    void mw;
    void mh;
  }

  // If subject matched nothing useful, fall back to heuristic on the small image.
  let filled = 0;
  for (let i = 0; i < alpha.length; i++) if (alpha[i] > 16) filled++;
  if (filled < alpha.length * 0.01) {
    return heuristicSegment(image, label);
  }

  return {
    width: image.width,
    height: image.height,
    alpha: upsampleAlpha(alpha, small.width, small.height, image.width, image.height),
    model: "Xenova/segformer-b0-finetuned-ade-512-512",
  };
}

export async function segmentImage(image: ImageData, label: SemanticLabel): Promise<SegmentResult> {
  if (injectSegmenter) return injectSegmenter(image, label);
  try {
    return await transformersSegment(image, label);
  } catch {
    return heuristicSegment(image, label);
  }
}
