import { defaultRecipe } from "../recipe/defaults";
import { mergeMaskGlobals } from "../recipe/patch";
import { HSL_CHANNELS, MAX_MASKS, type EditRecipe, type Globals, type Mask } from "../recipe/types";
import { BLIT_FRAG, FRAG, MIX_FRAG, VERT } from "./shader";

export type HistogramStats = {
  bins: number[];
  meanLuma: number;
  clipLow: number;
  clipHigh: number;
};

export type ViewMode = "fit" | "1:1";

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

function firstRadial(mask: Mask): Extract<Mask["components"][number], { type: "radial" }> | null {
  for (const c of mask.components) {
    if (c.type === "radial") return c;
  }
  return null;
}

export class PreviewRenderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private developProgram: WebGLProgram;
  private mixProgram: WebGLProgram;
  private blitProgram: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private texture: WebGLTexture;
  private image: ImageBitmap | null = null;
  private recipe: EditRecipe = defaultRecipe();
  private before = false;
  private raf = 0;
  private dirty = false;
  private hist: HistogramStats | null = null;
  private onHist: ((h: HistogramStats) => void) | null = null;
  private resultA: Fbo | null = null;
  private resultB: Fbo | null = null;
  private localFbo: Fbo | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL2 required");
    this.canvas = canvas;
    this.gl = gl;
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    this.developProgram = linkProgram(gl, vs, FRAG);
    this.mixProgram = linkProgram(gl, vs, MIX_FRAG);
    this.blitProgram = linkProgram(gl, vs, BLIT_FRAG);
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
    if (!tex) throw new Error("tex");
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.texture = tex;
  }

  setHistogramListener(fn: ((h: HistogramStats) => void) | null) {
    this.onHist = fn;
  }

  setImage(image: ImageBitmap | null) {
    if (this.image && this.image !== image) this.image.close();
    this.image = image;
    if (!image) {
      this.schedule();
      return;
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
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

  layout(view: ViewMode, hostW: number, hostH: number) {
    const img = this.image;
    if (!img) {
      this.canvas.width = hostW;
      this.canvas.height = hostH;
      return;
    }
    if (view === "1:1") {
      this.canvas.width = img.width;
      this.canvas.height = img.height;
    } else {
      const scale = Math.min(hostW / img.width, hostH / img.height, 1);
      this.canvas.width = Math.max(1, Math.round(img.width * scale));
      this.canvas.height = Math.max(1, Math.round(img.height * scale));
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
    if (ok(this.resultA) && ok(this.resultB) && ok(this.localFbo)) return;
    destroyFbo(gl, this.resultA);
    destroyFbo(gl, this.resultB);
    destroyFbo(gl, this.localFbo);
    this.resultA = createFbo(gl, w, h);
    this.resultB = createFbo(gl, w, h);
    this.localFbo = createFbo(gl, w, h);
  }

  private setDevelopUniforms(program: WebGLProgram, g: Globals) {
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
    gl.uniform1f(loc(gl, program, "uClarity"), g.clarity);
    gl.uniform1f(loc(gl, program, "uDehaze"), g.dehaze);
    gl.uniform1f(loc(gl, program, "uSharpen"), g.sharpening);
    gl.uniform1f(loc(gl, program, "uNR"), g.noiseReduction);
  }

  private drawDevelop(target: WebGLFramebuffer | null, g: Globals, w: number, h: number) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.developProgram);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    this.setDevelopUniforms(this.developProgram, g);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private drawMix(
    target: WebGLFramebuffer,
    prev: WebGLTexture,
    local: WebGLTexture,
    radial: Extract<Mask["components"][number], { type: "radial" }>,
    mask: Mask,
    w: number,
    h: number,
  ) {
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
    const feather = Math.max(mask.feather, radial.feather);
    gl.uniform1f(loc(gl, this.mixProgram, "uCx"), radial.cx);
    gl.uniform1f(loc(gl, this.mixProgram, "uCy"), radial.cy);
    gl.uniform1f(loc(gl, this.mixProgram, "uRadiusX"), radial.radiusX);
    gl.uniform1f(loc(gl, this.mixProgram, "uRadiusY"), radial.radiusY);
    gl.uniform1f(loc(gl, this.mixProgram, "uFeather"), feather);
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
    const radialMasks = recipe.masks
      .slice(0, MAX_MASKS)
      .map((m) => ({ mask: m, radial: firstRadial(m) }))
      .filter((x): x is { mask: Mask; radial: NonNullable<ReturnType<typeof firstRadial>> } => x.radial !== null);

    if (radialMasks.length === 0) {
      this.drawDevelop(null, recipe.globals, w, h);
      this.sampleHistogram();
      return;
    }

    this.ensureFbos(w, h);
    const resultA = this.resultA!;
    const resultB = this.resultB!;
    const localFbo = this.localFbo!;

    this.drawDevelop(resultA.fbo, recipe.globals, w, h);

    let read = resultA;
    let write = resultB;
    for (const { mask, radial } of radialMasks) {
      const localGlobals = mergeMaskGlobals(recipe.globals, mask.params);
      this.drawDevelop(localFbo.fbo, localGlobals, w, h);
      this.drawMix(write.fbo, read.tex, localFbo.tex, radial, mask, w, h);
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
    this.canvas.width = img.width;
    this.canvas.height = img.height;
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
    this.resultA = null;
    this.resultB = null;
    this.localFbo = null;
    this.image?.close();
  }
}

const PREVIEW_MAX = 2048;

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
