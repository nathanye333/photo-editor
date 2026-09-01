import { defaultRecipe } from "../recipe/defaults";
import { cropAffectsPixels, cropPixelSize } from "../recipe/crop";
import { isIdentityToneCurve, LUT_SIZE, toneCurveTexture } from "../recipe/curve";
import { mergeMaskGlobals } from "../recipe/patch";
import {
  HSL_CHANNELS,
  MAX_MASKS,
  primaryComponent,
  type Crop,
  type EditRecipe,
  type Globals,
  type Mask,
  type MaskComponent,
  type ToneCurve,
} from "../recipe/types";
import { rasterizeBrushStrokes, rgbToHueChroma } from "./brushRaster";
import {
  BLIT_FRAG,
  FRAG,
  MIX_FRAG,
  VERT,
  WEIGHT_COLOR_FRAG,
  WEIGHT_LUMA_FRAG,
  WEIGHT_RADIAL_FRAG,
} from "./shader";

export type HistogramStats = {
  bins: number[];
  meanLuma: number;
  clipLow: number;
  clipHigh: number;
};

export type ViewMode = "fit" | "1:1";

export type SourceSample = {
  r: number;
  g: number;
  b: number;
  hue: number;
  chroma: number;
  luma: number;
};

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("shader alloc");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? "compile failed";
    gl.deleteShader(sh);
    throw new Error(log);
  }
  return sh;
}

function linkProgram(gl: WebGL2RenderingContext, vs: WebGLShader, fsSrc: string): WebGLProgram {
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const program = gl.createProgram();
  if (!program) throw new Error("program");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, "aPos");
  gl.bindAttribLocation(program, 1, "aUv");
  gl.linkProgram(program);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "link");
  }
  return program;
}

function loc(gl: WebGL2RenderingContext, program: WebGLProgram, name: string): WebGLUniformLocation {
  const l = gl.getUniformLocation(program, name);
  if (!l) throw new Error(`uniform ${name}`);
  return l;
}

type Fbo = {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
};

function createFbo(gl: WebGL2RenderingContext, w: number, h: number): Fbo {
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!tex || !fbo) throw new Error("fbo");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error("incomplete fbo");
  return { fbo, tex, w, h };
}

function destroyFbo(gl: WebGL2RenderingContext, target: Fbo | null) {
  if (!target) return;
  gl.deleteFramebuffer(target.fbo);
  gl.deleteTexture(target.tex);
}

function isRenderableComponent(c: MaskComponent | null): boolean {
  return (
    !!c &&
    (c.type === "radial" ||
      c.type === "brush" ||
      c.type === "luminance_range" ||
      c.type === "color_range")
  );
}

export class PreviewRenderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private developProgram: WebGLProgram;
  private mixProgram: WebGLProgram;
  private blitProgram: WebGLProgram;
  private weightRadialProgram: WebGLProgram;
  private weightLumaProgram: WebGLProgram;
  private weightColorProgram: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private texture: WebGLTexture;
  private brushTex: WebGLTexture;
  private curveTex: WebGLTexture;
  private curveKey = "";
  private image: ImageBitmap | null = null;
  private sourcePixels: ImageData | null = null;
  private recipe: EditRecipe = defaultRecipe();
  private before = false;
  private raf = 0;
  private dirty = false;
  private hist: HistogramStats | null = null;
  private onHist: ((h: HistogramStats) => void) | null = null;
  private resultA: Fbo | null = null;
  private resultB: Fbo | null = null;
  private localFbo: Fbo | null = null;
  private weightFbo: Fbo | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL2 required");
    this.canvas = canvas;
    this.gl = gl;
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    this.developProgram = linkProgram(gl, vs, FRAG);
    this.mixProgram = linkProgram(gl, vs, MIX_FRAG);
    this.blitProgram = linkProgram(gl, vs, BLIT_FRAG);
    this.weightRadialProgram = linkProgram(gl, vs, WEIGHT_RADIAL_FRAG);
    this.weightLumaProgram = linkProgram(gl, vs, WEIGHT_LUMA_FRAG);
    this.weightColorProgram = linkProgram(gl, vs, WEIGHT_COLOR_FRAG);
    gl.deleteShader(vs);

    const buf = gl.createBuffer();
    const vao = gl.createVertexArray();
    if (!buf || !vao) throw new Error("vao");
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 0, 1, 1, -1, 1, 1, -1, 1, 0, 0, 1, 1, 1, 0]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    this.vao = vao;

    const tex = gl.createTexture();
    const brushTex = gl.createTexture();
    const curveTex = gl.createTexture();
    if (!tex || !brushTex || !curveTex) throw new Error("tex");
    for (const t of [tex, brushTex, curveTex]) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    this.texture = tex;
    this.brushTex = brushTex;
    this.curveTex = curveTex;
  }

  /** Binds the LUT on texture unit 1 and re-uploads it when the curves change. */
  private bindCurveTexture(curve: ToneCurve) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.curveTex);
    const key = JSON.stringify(curve.channels);
    if (key === this.curveKey) return;
    this.curveKey = key;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      LUT_SIZE,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      toneCurveTexture(curve),
    );
  }

  setHistogramListener(fn: ((h: HistogramStats) => void) | null) {
    this.onHist = fn;
  }

  setImage(image: ImageBitmap | null) {
    if (this.image && this.image !== image) this.image.close();
    this.image = image;
    this.sourcePixels = null;
    if (!image) {
      this.schedule();
      return;
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    // UVs use top-left origin (v=0 at top of screen). Do not flip uploads.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

    const c = document.createElement("canvas");
    c.width = image.width;
    c.height = image.height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(image, 0, 0);
      this.sourcePixels = ctx.getImageData(0, 0, c.width, c.height);
    }
    this.schedule();
  }

  setRecipe(recipe: EditRecipe) {
    this.recipe = recipe;
    this.schedule();
  }

  setBefore(before: boolean) {
    this.before = before;
    this.schedule();
  }

  imageSize(): { w: number; h: number } | null {
    return this.image ? { w: this.image.width, h: this.image.height } : null;
  }

  /** Sample source image at normalized UV (origin top-left). */
  sampleSource(uvX: number, uvY: number): SourceSample | null {
    const px = this.sourcePixels;
    if (!px) return null;
    const x = Math.min(px.width - 1, Math.max(0, Math.floor(uvX * px.width)));
    const y = Math.min(px.height - 1, Math.max(0, Math.floor(uvY * px.height)));
    const i = (y * px.width + x) * 4;
    const r = px.data[i] / 255;
    const g = px.data[i + 1] / 255;
    const b = px.data[i + 2] / 255;
    const hc = rgbToHueChroma(r, g, b);
    return { r, g, b, ...hc };
  }

  layout(view: ViewMode, hostW: number, hostH: number, editingCrop = false) {
    const img = this.image;
    if (!img) {
      this.canvas.width = hostW;
      this.canvas.height = hostH;
      return;
    }
    const crop = this.recipe.crop;
    const useCrop = crop.enabled && !editingCrop;
    const { w: cropW, h: cropH } = cropPixelSize(
      useCrop ? crop : { ...crop, width: 1, height: 1 },
      img.width,
      img.height,
    );
    if (view === "1:1") {
      this.canvas.width = cropW;
      this.canvas.height = cropH;
    } else {
      const scale = Math.min(hostW / cropW, hostH / cropH, 1);
      this.canvas.width = Math.max(1, Math.round(cropW * scale));
      this.canvas.height = Math.max(1, Math.round(cropH * scale));
    }
    this.schedule();
  }

  private schedule() {
    this.dirty = true;
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (this.dirty) this.render();
    });
  }

  private ensureFbos(w: number, h: number) {
    const gl = this.gl;
    const ok = (f: Fbo | null) => f && f.w === w && f.h === h;
    if (ok(this.resultA) && ok(this.resultB) && ok(this.localFbo) && ok(this.weightFbo)) return;
    destroyFbo(gl, this.resultA);
    destroyFbo(gl, this.resultB);
    destroyFbo(gl, this.localFbo);
    destroyFbo(gl, this.weightFbo);
    this.resultA = createFbo(gl, w, h);
    this.resultB = createFbo(gl, w, h);
    this.localFbo = createFbo(gl, w, h);
    this.weightFbo = createFbo(gl, w, h);
  }

  private setCropUniforms(program: WebGLProgram, crop: Crop) {
    const gl = this.gl;
    gl.uniform1f(loc(gl, program, "uCropEnabled"), cropAffectsPixels(crop) ? 1 : 0);
    gl.uniform4f(loc(gl, program, "uCropRect"), crop.x, crop.y, crop.width, crop.height);
    gl.uniform1f(loc(gl, program, "uCropAngle"), (crop.angle * Math.PI) / 180);
  }

  private setDevelopUniforms(program: WebGLProgram, g: Globals, crop: Crop) {
    const gl = this.gl;
    gl.uniform1i(loc(gl, program, "uImage"), 0);
    gl.uniform1f(loc(gl, program, "uExposure"), g.exposure);
    gl.uniform1f(loc(gl, program, "uContrast"), g.contrast);
    gl.uniform1f(loc(gl, program, "uHighlights"), g.highlights);
    gl.uniform1f(loc(gl, program, "uShadows"), g.shadows);
    gl.uniform1f(loc(gl, program, "uWhites"), g.whites);
    gl.uniform1f(loc(gl, program, "uBlacks"), g.blacks);
    gl.uniform1f(loc(gl, program, "uTemp"), g.temp);
    gl.uniform1f(loc(gl, program, "uTint"), g.tint);
    gl.uniform1f(loc(gl, program, "uVibrance"), g.vibrance);
    gl.uniform1f(loc(gl, program, "uSaturation"), g.saturation);
    gl.uniform1fv(
      loc(gl, program, "uHslH"),
      HSL_CHANNELS.map((c) => g.hsl[c].hue),
    );
    gl.uniform1fv(
      loc(gl, program, "uHslS"),
      HSL_CHANNELS.map((c) => g.hsl[c].sat),
    );
    gl.uniform1fv(
      loc(gl, program, "uHslL"),
      HSL_CHANNELS.map((c) => g.hsl[c].lum),
    );
    gl.uniform1f(loc(gl, program, "uCurveHi"), g.toneCurve.highlights);
    gl.uniform1f(loc(gl, program, "uCurveLi"), g.toneCurve.lights);
    gl.uniform1f(loc(gl, program, "uCurveDk"), g.toneCurve.darks);
    gl.uniform1f(loc(gl, program, "uCurveSh"), g.toneCurve.shadows);
    this.bindCurveTexture(g.toneCurve);
    gl.uniform1i(loc(gl, program, "uCurveLut"), 1);
    gl.uniform1f(loc(gl, program, "uCurveLutOn"), isIdentityToneCurve(g.toneCurve) ? 0 : 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1f(loc(gl, program, "uClarity"), g.clarity);
    gl.uniform1f(loc(gl, program, "uDehaze"), g.dehaze);
    gl.uniform1f(loc(gl, program, "uSharpen"), g.sharpening);
    gl.uniform1f(loc(gl, program, "uNR"), g.noiseReduction);
    this.setCropUniforms(program, crop);
  }

  private drawDevelop(target: WebGLFramebuffer | null, g: Globals, crop: Crop, w: number, h: number) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.developProgram);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    this.setDevelopUniforms(this.developProgram, g, crop);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private drawWeight(component: MaskComponent, mask: Mask, w: number, h: number) {
    const gl = this.gl;
    const target = this.weightFbo!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindVertexArray(this.vao);

    if (component.type === "radial") {
      gl.useProgram(this.weightRadialProgram);
      const feather = Math.max(mask.feather, component.feather);
      gl.uniform1f(loc(gl, this.weightRadialProgram, "uCx"), component.cx);
      gl.uniform1f(loc(gl, this.weightRadialProgram, "uCy"), component.cy);
      gl.uniform1f(loc(gl, this.weightRadialProgram, "uRadiusX"), component.radiusX);
      gl.uniform1f(loc(gl, this.weightRadialProgram, "uRadiusY"), component.radiusY);
      gl.uniform1f(loc(gl, this.weightRadialProgram, "uFeather"), feather);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return;
    }

    if (component.type === "luminance_range") {
      gl.useProgram(this.weightLumaProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.uniform1i(loc(gl, this.weightLumaProgram, "uImage"), 0);
      gl.uniform1f(loc(gl, this.weightLumaProgram, "uMin"), component.min);
      gl.uniform1f(loc(gl, this.weightLumaProgram, "uMax"), component.max);
      gl.uniform1f(loc(gl, this.weightLumaProgram, "uSmooth"), component.smooth);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return;
    }

    if (component.type === "color_range") {
      gl.useProgram(this.weightColorProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.uniform1i(loc(gl, this.weightColorProgram, "uImage"), 0);
      gl.uniform1f(loc(gl, this.weightColorProgram, "uHue"), component.hue);
      gl.uniform1f(loc(gl, this.weightColorProgram, "uChroma"), component.chroma);
      gl.uniform1f(loc(gl, this.weightColorProgram, "uTolerance"), component.tolerance);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return;
    }

    if (component.type === "brush") {
      // TypedArray uploads ignore UNPACK_FLIP_Y. Keep ImageData top-left origin so
      // strokes align with pointer UVs (and sampleSource) without an extra flip.
      const data = rasterizeBrushStrokes(component.strokes, w, h);
      gl.bindTexture(gl.TEXTURE_2D, this.brushTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data.data);
      gl.useProgram(this.blitProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.brushTex);
      gl.uniform1i(loc(gl, this.blitProgram, "uTex"), 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  private drawMix(target: WebGLFramebuffer, prev: WebGLTexture, local: WebGLTexture, mask: Mask, w: number, h: number) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.mixProgram);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, prev);
    gl.uniform1i(loc(gl, this.mixProgram, "uPrev"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, local);
    gl.uniform1i(loc(gl, this.mixProgram, "uLocal"), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.weightFbo!.tex);
    gl.uniform1i(loc(gl, this.mixProgram, "uWeight"), 2);
    gl.uniform1f(loc(gl, this.mixProgram, "uDensity"), mask.density);
    gl.uniform1f(loc(gl, this.mixProgram, "uInvert"), mask.invert || mask.mode === "subtract" ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private blitToCanvas(tex: WebGLTexture, w: number, h: number) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.blitProgram);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc(gl, this.blitProgram, "uTex"), 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  render() {
    this.dirty = false;
    const gl = this.gl;
    const { canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.08, 0.08, 0.09, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.image) return;

    const recipe = this.before ? defaultRecipe() : this.recipe;
    const crop = recipe.crop;
    const masks = recipe.masks
      .slice(0, MAX_MASKS)
      .map((mask) => ({ mask, component: primaryComponent(mask) }))
      .filter((x): x is { mask: Mask; component: MaskComponent } => isRenderableComponent(x.component));

    if (masks.length === 0) {
      this.drawDevelop(null, recipe.globals, crop, w, h);
      this.sampleHistogram();
      return;
    }

    this.ensureFbos(w, h);
    const resultA = this.resultA!;
    const resultB = this.resultB!;
    const localFbo = this.localFbo!;

    this.drawDevelop(resultA.fbo, recipe.globals, crop, w, h);

    let read = resultA;
    let write = resultB;
    for (const { mask, component } of masks) {
      const localGlobals = mergeMaskGlobals(recipe.globals, mask.params);
      this.drawDevelop(localFbo.fbo, localGlobals, crop, w, h);
      this.drawWeight(component, mask, w, h);
      this.drawMix(write.fbo, read.tex, localFbo.tex, mask, w, h);
      const tmp = read;
      read = write;
      write = tmp;
    }

    this.blitToCanvas(read.tex, w, h);
    this.sampleHistogram();
  }

  private sampleHistogram() {
    const gl = this.gl;
    const w = Math.min(128, this.canvas.width);
    const h = Math.min(128, this.canvas.height);
    if (w < 2 || h < 2) return;
    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const bins = new Array(64).fill(0);
    let sum = 0;
    let clipLow = 0;
    let clipHigh = 0;
    const n = w * h;
    for (let i = 0; i < pixels.length; i += 4) {
      const y = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
      sum += y;
      if (y <= 2) clipLow++;
      if (y >= 253) clipHigh++;
      bins[Math.min(63, Math.floor((y / 255) * 64))]++;
    }
    this.hist = {
      bins,
      meanLuma: sum / n / 255,
      clipLow: clipLow / n,
      clipHigh: clipHigh / n,
    };
    this.onHist?.(this.hist);
  }

  histogram(): HistogramStats | null {
    return this.hist;
  }

  async exportJpeg(quality = 0.92): Promise<Blob> {
    const img = this.image;
    if (!img) throw new Error("no image");
    const prevW = this.canvas.width;
    const prevH = this.canvas.height;
    const crop = this.recipe.crop;
    const { w, h } = cropPixelSize(
      crop.enabled ? crop : { ...crop, width: 1, height: 1 },
      img.width,
      img.height,
    );
    this.canvas.width = w;
    this.canvas.height = h;
    this.render();
    const blob = await new Promise<Blob>((resolve, reject) => {
      this.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("export failed"))), "image/jpeg", quality);
    });
    this.canvas.width = prevW;
    this.canvas.height = prevH;
    this.schedule();
    return blob;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    const gl = this.gl;
    destroyFbo(gl, this.resultA);
    destroyFbo(gl, this.resultB);
    destroyFbo(gl, this.localFbo);
    destroyFbo(gl, this.weightFbo);
    this.resultA = null;
    this.resultB = null;
    this.localFbo = null;
    this.weightFbo = null;
    gl.deleteTexture(this.curveTex);
    this.image?.close();
  }
}

const PREVIEW_MAX = 2048;

export async function bitmapFromRgb(width: number, height: number, rgb: Uint8Array): Promise<ImageBitmap> {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    rgba[j] = rgb[i];
    rgba[j + 1] = rgb[i + 1];
    rgba[j + 2] = rgb[i + 2];
    rgba[j + 3] = 255;
  }
  const imageData = new ImageData(rgba, width, height);
  return createImageBitmap(imageData);
}

export async function bitmapFromBlob(blob: Blob): Promise<ImageBitmap> {
  const probe = await createImageBitmap(blob);
  const maxEdge = Math.max(probe.width, probe.height);
  if (maxEdge <= PREVIEW_MAX) return probe;
  const scale = PREVIEW_MAX / maxEdge;
  const w = Math.round(probe.width * scale);
  const h = Math.round(probe.height * scale);
  probe.close();
  return createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
}

export async function thumbnailFromBitmap(image: ImageBitmap, max = 256): Promise<Blob> {
  const scale = Math.min(1, max / Math.max(image.width, image.height));
  const w = Math.max(1, Math.round(image.width * scale));
  const h = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d");
  ctx.drawImage(image, 0, 0, w, h);
  return await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("thumb"))), "image/jpeg", 0.82);
  });
}
