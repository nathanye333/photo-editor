/** In-memory sample so Develop works before any import. */
export async function createSampleBitmap(): Promise<ImageBitmap> {
  const w = 1280;
  const h = 800;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d");
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.62);
  sky.addColorStop(0, "#6aa8d8");
  sky.addColorStop(1, "#d8c4a0");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  ctx.beginPath();
  ctx.arc(980, 140, 70, 0, Math.PI * 2);
  ctx.fillStyle = "#f4e0a8";
  ctx.fill();
  ctx.fillStyle = "#3d5a3a";
  ctx.beginPath();
  ctx.moveTo(0, h * 0.62);
  ctx.quadraticCurveTo(w * 0.35, h * 0.5, w, h * 0.7);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.fill();
  ctx.fillStyle = "#c45c3e";
  ctx.fillRect(w * 0.28, h * 0.48, 180, 220);
  ctx.fillStyle = "#2a2a2c";
  ctx.beginPath();
  ctx.moveTo(w * 0.28 - 12, h * 0.48);
  ctx.lineTo(w * 0.28 + 90, h * 0.36);
  ctx.lineTo(w * 0.28 + 192, h * 0.48);
  ctx.closePath();
  ctx.fill();
  return createImageBitmap(canvas);
}
