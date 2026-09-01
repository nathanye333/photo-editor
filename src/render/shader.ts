export const VERT = `#version 300 es
in vec2 aPos;
in vec2 aUv;
out vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

/** Shared develop kernel body — samples uImage, writes developed sRGB via developSample(). */
export const DEVELOP_BODY = `
vec3 toLinear(vec3 s) { return pow(max(s, 0.0), vec3(2.2)); }
vec3 toSRGB(vec3 l) { return pow(max(l, 0.0), vec3(1.0 / 2.2)); }

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 rgb2hsl(vec3 color) {
  float maxc = max(max(color.r, color.g), color.b);
  float minc = min(min(color.r, color.g), color.b);
  float l = (maxc + minc) * 0.5;
  float d = maxc - minc;
  if (d < 1e-5) return vec3(0.0, 0.0, l);
  float s = l > 0.5 ? d / (2.0 - maxc - minc) : d / (maxc + minc);
  float h = 0.0;
  if (maxc == color.r) h = mod((color.g - color.b) / d + (color.g < color.b ? 6.0 : 0.0), 6.0);
  else if (maxc == color.g) h = (color.b - color.r) / d + 2.0;
  else h = (color.r - color.g) / d + 4.0;
  h /= 6.0;
  return vec3(h, s, l);
}

float hue2rgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}

vec3 hsl2rgb(vec3 hsl) {
  float h = hsl.x;
  float s = hsl.y;
  float l = hsl.z;
  if (s <= 0.0) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(hue2rgb(p, q, h + 1.0 / 3.0), hue2rgb(p, q, h), hue2rgb(p, q, h - 1.0 / 3.0));
}

float channelWeight(float hue, float center) {
  float d = abs(hue - center);
  d = min(d, 1.0 - d);
  float w = 1.0 - d / 0.08;
  return clamp(w, 0.0, 1.0);
}

vec3 applyHsl(vec3 rgb) {
  vec3 hsl = rgb2hsl(rgb);
  float centers[8];
  centers[0] = 0.0; centers[1] = 0.083; centers[2] = 0.167; centers[3] = 0.333;
  centers[4] = 0.5; centers[5] = 0.667; centers[6] = 0.75; centers[7] = 0.833;
  float dh = 0.0;
  float ds = 0.0;
  float dl = 0.0;
  float wsum = 0.0;
  for (int i = 0; i < 8; i++) {
    float w = channelWeight(hsl.x, centers[i]);
    dh += w * uHslH[i];
    ds += w * uHslS[i];
    dl += w * uHslL[i];
    wsum += w;
  }
  if (wsum > 0.0) {
    dh /= wsum; ds /= wsum; dl /= wsum;
  }
  hsl.x = fract(hsl.x + dh / 200.0);
  hsl.y = clamp(hsl.y * (1.0 + ds / 100.0), 0.0, 1.0);
  hsl.z = clamp(hsl.z + dl / 200.0, 0.0, 1.0);
  return hsl2rgb(hsl);
}

float toneMapLuma(float x) {
  float sh = uCurveSh / 100.0;
  float dk = uCurveDk / 100.0;
  float li = uCurveLi / 100.0;
  float hi = uCurveHi / 100.0;
  float y = x;
  y += sh * pow(1.0 - x, 3.0) * 0.35;
  y += dk * pow(1.0 - x, 1.5) * x * 0.5;
  y += li * pow(x, 1.5) * (1.0 - x) * 0.5;
  y += hi * pow(x, 3.0) * 0.35;
  return clamp(y, 0.0, 1.0);
}

/** Per-channel point curves, baked into a 256x1 LUT (rgb composite folded in). */
vec3 applyPointCurve(vec3 c) {
  if (uCurveLutOn < 0.5) return c;
  c = clamp(c, 0.0, 1.0);
  return vec3(
    texture(uCurveLut, vec2(c.r, 0.5)).r,
    texture(uCurveLut, vec2(c.g, 0.5)).g,
    texture(uCurveLut, vec2(c.b, 0.5)).b
  );
}

vec2 mapCropUv(vec2 outUv) {
  if (uCropEnabled < 0.5) return outUv;
  vec2 center = uCropRect.xy + uCropRect.zw * 0.5;
  vec2 p = uCropRect.xy + outUv * uCropRect.zw;
  vec2 rel = p - center;
  float rad = -uCropAngle;
  float c = cos(rad);
  float s = sin(rad);
  return vec2(c * rel.x - s * rel.y, s * rel.x + c * rel.y) + center;
}

vec3 blurTaps(vec2 stepUv) {
  return (
    texture(uImage, mapCropUv(vUv + vec2(stepUv.x, 0.0))).rgb +
    texture(uImage, mapCropUv(vUv - vec2(stepUv.x, 0.0))).rgb +
    texture(uImage, mapCropUv(vUv + vec2(0.0, stepUv.y))).rgb +
    texture(uImage, mapCropUv(vUv - vec2(0.0, stepUv.y))).rgb
  ) * 0.25;
}

/**
 * Detail stage. The fine band (source minus near blur) drives sharpening,
 * texture and noise reduction; the mid band drives clarity. Both come from the
 * source image, so they stay independent of the tone work already applied.
 */
vec3 applyDetail(vec3 srgb, vec3 src, vec3 near, vec3 wide) {
  vec3 fine = src - near;
  vec3 coarse = near - wide;

  float nr = clamp(uNR / 100.0, 0.0, 1.0);
  if (nr > 0.0) {
    float keep = clamp(uNRDetail / 100.0, 0.0, 1.0);
    srgb -= vec3(luma(fine)) * nr * (1.0 - keep * 0.85);
  }

  // Colour noise and moiré both live in chroma; pull it toward the wide average.
  float chromaMix = clamp(uColorNR / 100.0 * 0.85 + uMoire / 100.0 * 0.9, 0.0, 1.0);
  if (chromaMix > 0.0) {
    vec3 wideChroma = wide - vec3(luma(wide));
    srgb = mix(srgb, vec3(luma(srgb)) + wideChroma, chromaMix);
  }

  float amount = uSharpen / 100.0;
  if (amount > 0.0) {
    float masking = clamp(uSharpenMask / 100.0, 0.0, 1.0);
    float edge = smoothstep(0.0, 0.02 + masking * 0.12, length(fine));
    float edgeMask = mix(1.0, edge, masking);
    float detailBoost = mix(0.55, 1.5, clamp(uSharpenDetail / 100.0, 0.0, 1.0));
    srgb += fine * amount * edgeMask * detailBoost;
  }

  srgb += fine * (uTexture / 110.0);
  srgb += coarse * (uClarity / 45.0);
  return srgb;
}

vec3 developSample() {
  vec2 srcUv = mapCropUv(vUv);
  if (uCropEnabled > 0.5 && (srcUv.x < 0.0 || srcUv.x > 1.0 || srcUv.y < 0.0 || srcUv.y > 1.0)) {
    return vec3(0.08);
  }
  vec3 src = texture(uImage, srcUv).rgb;
  vec3 lin = toLinear(src);

  lin *= pow(2.0, uExposure);

  float t = uTemp / 100.0;
  float ti = uTint / 100.0;
  lin.r *= 1.0 + t * 0.25;
  lin.b *= 1.0 - t * 0.25;
  lin.g *= 1.0 + ti * 0.12;

  float mid = 0.18;
  lin = mix(vec3(mid), lin, 1.0 + uContrast / 100.0);

  float Y = luma(lin);
  float hiMask = smoothstep(0.35, 0.85, Y);
  float shMask = 1.0 - smoothstep(0.15, 0.55, Y);
  lin += lin * (uHighlights / 100.0) * hiMask * 0.45;
  lin += vec3(0.18) * (uShadows / 100.0) * shMask * 0.35;
  lin *= 1.0 + uWhites / 200.0 * hiMask;
  lin += uBlacks / 250.0 * shMask;

  lin = max(lin, 0.0);

  float dh = uDehaze / 100.0;
  lin = mix(lin, (lin - vec3(0.08 * dh)) / max(1.0 - 0.18 * dh, 0.2), abs(dh));

  vec3 srgb = toSRGB(lin);
  srgb = applyHsl(srgb);

  float sat = uSaturation / 100.0;
  float vib = uVibrance / 100.0;
  float L = luma(srgb);
  float satAmt = sat + vib * (1.0 - clamp(abs(L - 0.5) * 2.0, 0.0, 1.0));
  srgb = mix(vec3(L), srgb, 1.0 + satAmt);

  float y2 = luma(srgb);
  float y3 = toneMapLuma(y2);
  if (y2 > 1e-5) srgb *= y3 / y2;

  srgb = applyPointCurve(srgb);

  vec2 texel = 1.0 / vec2(textureSize(uImage, 0));
  float radius = mix(0.7, 3.0, clamp(uSharpenRadius / 100.0, 0.0, 1.0));
  vec3 near = blurTaps(texel * radius);
  vec3 wide = blurTaps(texel * radius * 3.0);
  return clamp(applyDetail(srgb, src, near, wide), 0.0, 1.0);
}
`;

const DEVELOP_UNIFORMS = `
uniform sampler2D uImage;
uniform float uExposure;
uniform float uContrast;
uniform float uHighlights;
uniform float uShadows;
uniform float uWhites;
uniform float uBlacks;
uniform float uTemp;
uniform float uTint;
uniform float uVibrance;
uniform float uSaturation;
uniform float uHslH[8];
uniform float uHslS[8];
uniform float uHslL[8];
uniform float uCurveHi;
uniform float uCurveLi;
uniform float uCurveDk;
uniform float uCurveSh;
uniform sampler2D uCurveLut;
uniform float uCurveLutOn;
uniform float uTexture;
uniform float uClarity;
uniform float uDehaze;
uniform float uSharpen;
uniform float uSharpenRadius;
uniform float uSharpenDetail;
uniform float uSharpenMask;
uniform float uNR;
uniform float uNRDetail;
uniform float uColorNR;
uniform float uMoire;
uniform float uCropEnabled;
uniform vec4 uCropRect;
uniform float uCropAngle;
`;

export const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${DEVELOP_UNIFORMS}
${DEVELOP_BODY}
void main() {
  fragColor = vec4(developSample(), 1.0);
}
`;

/** Copy a texture to the current framebuffer. */
export const BLIT_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
void main() {
  fragColor = texture(uTex, vUv);
}
`;

/** Mix previous composite with locally developed image using a weight texture (R). */
export const MIX_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uPrev;
uniform sampler2D uLocal;
uniform sampler2D uWeight;
uniform float uDensity;
uniform float uInvert;
void main() {
  vec3 prev = texture(uPrev, vUv).rgb;
  vec3 local = texture(uLocal, vUv).rgb;
  float w = texture(uWeight, vUv).r;
  if (uInvert > 0.5) w = 1.0 - w;
  w *= clamp(uDensity / 100.0, 0.0, 1.0);
  fragColor = vec4(mix(prev, local, w), 1.0);
}
`;

export const WEIGHT_RADIAL_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform float uCx;
uniform float uCy;
uniform float uRadiusX;
uniform float uRadiusY;
uniform float uFeather;
void main() {
  vec2 d = (vUv - vec2(uCx, uCy)) / max(vec2(uRadiusX, uRadiusY), vec2(1e-4));
  float dist = length(d);
  float feather = clamp(uFeather / 100.0, 0.001, 1.0);
  float inner = 1.0 - feather;
  float w = 1.0 - smoothstep(inner, 1.0, dist);
  fragColor = vec4(w, w, w, 1.0);
}
`;

export const WEIGHT_LUMA_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uImage;
uniform float uMin;
uniform float uMax;
uniform float uSmooth;
void main() {
  vec3 rgb = texture(uImage, vUv).rgb;
  float Y = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  float s = max(uSmooth, 0.001);
  float lo = smoothstep(uMin - s, uMin + s, Y);
  float hi = 1.0 - smoothstep(uMax - s, uMax + s, Y);
  float w = clamp(lo * hi, 0.0, 1.0);
  fragColor = vec4(w, w, w, 1.0);
}
`;

export const WEIGHT_COLOR_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uImage;
uniform float uHue;
uniform float uChroma;
uniform float uTolerance;
vec3 rgb2hsl(vec3 color) {
  float maxc = max(max(color.r, color.g), color.b);
  float minc = min(min(color.r, color.g), color.b);
  float l = (maxc + minc) * 0.5;
  float d = maxc - minc;
  if (d < 1e-5) return vec3(0.0, 0.0, l);
  float s = l > 0.5 ? d / (2.0 - maxc - minc) : d / (maxc + minc);
  float h = 0.0;
  if (maxc == color.r) h = mod((color.g - color.b) / d + (color.g < color.b ? 6.0 : 0.0), 6.0);
  else if (maxc == color.g) h = (color.b - color.r) / d + 2.0;
  else h = (color.r - color.g) / d + 4.0;
  h /= 6.0;
  return vec3(h, s, l);
}
void main() {
  vec3 hsl = rgb2hsl(texture(uImage, vUv).rgb);
  float dh = abs(hsl.x - uHue);
  dh = min(dh, 1.0 - dh);
  float dc = abs(hsl.y - uChroma);
  float tol = max(uTolerance, 0.001);
  float wh = 1.0 - smoothstep(tol * 0.35, tol, dh);
  float wc = 1.0 - smoothstep(tol * 0.75, tol * 1.5, dc);
  float w = clamp(wh * wc, 0.0, 1.0);
  fragColor = vec4(w, w, w, 1.0);
}
`;
