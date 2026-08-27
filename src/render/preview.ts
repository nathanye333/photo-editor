import { defaultRecipe } from "../recipe/defaults";
import { HSL_CHANNELS, type EditRecipe } from "../recipe/types";
import { FRAG, VERT } from "./shader";

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

function loc(gl: WebGL2RenderingContext, program: WebGLProgram, name: string): WebGLUniformLocation {
  const l = gl.getUniformLocation(program, name);
  if (!l) throw new Error(`uniform ${name}`);
  return l;
}

export class PreviewRenderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private texture: WebGLTexture;
  private image: ImageBitmap | null = null;
  private recipe: EditRecipe = defaultRecipe();
  private before = false;
  private raf = 0;
  private dirty = false;
  private hist: HistogramStats | null = null;
  private onHist: ((h: HistogramStats) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL2 required");
    this.canvas = canvas;
    this.gl = gl;
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const program = gl.createProgram();
    if (!program) throw new Error("program");
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, "aPos");
    gl.bindAttribLocation(program, 1, "aUv");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? "link");
    }
    this.program = program;

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

  render() {
    this.dirty = false;
    const gl = this.gl;
    const { canvas } = this;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.08, 0.08, 0.09, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.image) return;

    const recipe = this.before ? defaultRecipe() : this.recipe;
    const g = recipe.globals;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(loc(gl, this.program, "uImage"), 0);
    gl.uniform1f(loc(gl, this.program, "uExposure"), g.exposure);
    gl.uniform1f(loc(gl, this.program, "uContrast"), g.contrast);
    gl.uniform1f(loc(gl, this.program, "uHighlights"), g.highlights);
    gl.uniform1f(loc(gl, this.program, "uShadows"), g.shadows);
    gl.uniform1f(loc(gl, this.program, "uWhites"), g.whites);
    gl.uniform1f(loc(gl, this.program, "uBlacks"), g.blacks);
    gl.uniform1f(loc(gl, this.program, "uTemp"), g.temp);
    gl.uniform1f(loc(gl, this.program, "uTint"), g.tint);
    gl.uniform1f(loc(gl, this.program, "uVibrance"), g.vibrance);
    gl.uniform1f(loc(gl, this.program, "uSaturation"), g.saturation);
    gl.uniform1fv(
      loc(gl, this.program, "uHslH"),
      HSL_CHANNELS.map((c) => g.hsl[c].hue),
    );
    gl.uniform1fv(
      loc(gl, this.program, "uHslS"),
      HSL_CHANNELS.map((c) => g.hsl[c].sat),
    );
    gl.uniform1fv(
      loc(gl, this.program, "uHslL"),
      HSL_CHANNELS.map((c) => g.hsl[c].lum),
    );
    gl.uniform1f(loc(gl, this.program, "uCurveHi"), g.toneCurve.highlights);
    gl.uniform1f(loc(gl, this.program, "uCurveLi"), g.toneCurve.lights);
    gl.uniform1f(loc(gl, this.program, "uCurveDk"), g.toneCurve.darks);
    gl.uniform1f(loc(gl, this.program, "uCurveSh"), g.toneCurve.shadows);
    gl.uniform1f(loc(gl, this.program, "uClarity"), g.clarity);
    gl.uniform1f(loc(gl, this.program, "uDehaze"), g.dehaze);
    gl.uniform1f(loc(gl, this.program, "uSharpen"), g.sharpening);
    gl.uniform1f(loc(gl, this.program, "uNR"), g.noiseReduction);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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
