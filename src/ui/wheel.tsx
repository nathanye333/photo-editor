import { useEffect, useRef } from "react";
import type { GradeWheel } from "../recipe/types";

const SIZE = 108;
const RADIUS = SIZE / 2 - 4;

/** Hue/saturation disc, drawn once and cached — only the handle moves. */
function drawDisc(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const image = ctx.createImageData(SIZE, SIZE);
  const c = SIZE / 2;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - c;
      const dy = y - c;
      const r = Math.hypot(dx, dy);
      const i = (y * SIZE + x) * 4;
      if (r > RADIUS) continue;
      const hue = angleToHue(dx, dy);
      const [red, green, blue] = hslToRgb(hue / 360, Math.min(1, r / RADIUS), 0.5);
      image.data[i] = red;
      image.data[i + 1] = green;
      image.data[i + 2] = blue;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function angleToHue(dx: number, dy: number): number {
  // 0 degrees at the top, increasing clockwise, matching the handle placement.
  return (((Math.atan2(dx, -dy) * 180) / Math.PI) + 360) % 360;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s <= 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let v = t;
    if (v < 0) v += 1;
    if (v > 1) v -= 1;
    if (v < 1 / 6) return p + (q - p) * 6 * v;
    if (v < 0.5) return q;
    if (v < 2 / 3) return p + (q - p) * (2 / 3 - v) * 6;
    return p;
  };
  return [channel(h + 1 / 3) * 255, channel(h) * 255, channel(h - 1 / 3) * 255];
}

let disc: HTMLCanvasElement | null = null;

type Props = {
  label: string;
  wheel: GradeWheel;
  onLive: (next: Partial<GradeWheel>) => void;
  onCommit: () => void;
};

export function ColorWheel({ label, wheel, onLive, onCommit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    if (!disc) disc = drawDisc();
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(disc, 0, 0);

    const c = SIZE / 2;
    const theta = (wheel.hue * Math.PI) / 180;
    const r = (wheel.sat / 100) * RADIUS;
    const hx = c + Math.sin(theta) * r;
    const hy = c - Math.cos(theta) * r;
    ctx.strokeStyle = "#0b0b0c";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(hx, hy, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [wheel.hue, wheel.sat]);

  function fromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = ((e.clientX - rect.left) / rect.width) * SIZE - SIZE / 2;
    const dy = ((e.clientY - rect.top) / rect.height) * SIZE - SIZE / 2;
    onLive({
      hue: Math.round(angleToHue(dx, dy)),
      sat: Math.round(Math.min(100, (Math.hypot(dx, dy) / RADIUS) * 100)),
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLCanvasElement>) {
    const stepSize = e.shiftKey ? 10 : 1;
    const moves: Record<string, Partial<GradeWheel>> = {
      ArrowLeft: { hue: wheel.hue - stepSize },
      ArrowRight: { hue: wheel.hue + stepSize },
      ArrowUp: { sat: Math.min(100, wheel.sat + stepSize) },
      ArrowDown: { sat: Math.max(0, wheel.sat - stepSize) },
    };
    const next = moves[e.key];
    if (!next) return;
    e.preventDefault();
    onLive(next);
    onCommit();
  }

  return (
    <div className="wheel">
      <span className="wheel-label">{label}</span>
      <canvas
        ref={canvasRef}
        className="wheel-disc"
        width={SIZE}
        height={SIZE}
        tabIndex={0}
        role="slider"
        aria-label={`${label} hue and saturation`}
        aria-valuetext={`hue ${Math.round(wheel.hue)}, saturation ${Math.round(wheel.sat)}`}
        aria-valuenow={Math.round(wheel.hue)}
        aria-valuemin={0}
        aria-valuemax={360}
        onKeyDown={onKeyDown}
        onDoubleClick={() => {
          onLive({ hue: 0, sat: 0 });
          onCommit();
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          draggingRef.current = true;
          fromEvent(e);
        }}
        onPointerMove={(e) => {
          if (draggingRef.current) fromEvent(e);
        }}
        onPointerUp={() => {
          if (!draggingRef.current) return;
          draggingRef.current = false;
          onCommit();
        }}
      />
      <span className="wheel-val">
        H {Math.round(wheel.hue)}° · S {Math.round(wheel.sat)}
      </span>
    </div>
  );
}
