import { useEffect, useRef, useState } from "react";
import { evalCurve, identityPoints } from "../recipe/curve";
import {
  CURVE_CHANNELS,
  MAX_CURVE_POINTS,
  type CurveChannel,
  type CurvePoints,
  type ToneCurve,
} from "../recipe/types";

const SIZE = 248;
/** Pointer distance (in normalized units) that counts as grabbing a point. */
const GRAB = 0.045;

const STROKE: Record<CurveChannel, string> = {
  rgb: "#e8e4dc",
  red: "#e06c6c",
  green: "#6fc48a",
  blue: "#6c9ce0",
};

type Props = {
  curve: ToneCurve;
  onLive: (channel: CurveChannel, points: CurvePoints) => void;
  onCommit: () => void;
};

/** Parametric sliders act on luma before the point curve; draw them as a guide. */
function parametricGuide(curve: ToneCurve, x: number): number {
  const sh = curve.shadows / 100;
  const dk = curve.darks / 100;
  const li = curve.lights / 100;
  const hi = curve.highlights / 100;
  let y = x;
  y += sh * Math.pow(1 - x, 3) * 0.35;
  y += dk * Math.pow(1 - x, 1.5) * x * 0.5;
  y += li * Math.pow(x, 1.5) * (1 - x) * 0.5;
  y += hi * Math.pow(x, 3) * 0.35;
  return Math.min(1, Math.max(0, y));
}

export function CurveEditor({ curve, onLive, onCommit }: Props) {
  const [channel, setChannel] = useState<CurveChannel>("rgb");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<number | null>(null);
  const points = curve.channels[channel];

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { width: w, height: h } = canvas;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#141416";
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "#2a2a2e";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const p = (i / 4) * w;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, h);
      ctx.moveTo(0, p);
      ctx.lineTo(w, p);
      ctx.stroke();
    }

    const plot = (fn: (x: number) => number, stroke: string, dash: number[]) => {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(dash);
      ctx.beginPath();
      for (let i = 0; i <= w; i++) {
        const x = i / w;
        const y = fn(x);
        const py = h - y * h;
        if (i === 0) ctx.moveTo(i, py);
        else ctx.lineTo(i, py);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };

    plot((x) => parametricGuide(curve, x), "#4a4a52", [4, 4]);
    plot((x) => evalCurve(points, x), STROKE[channel], []);

    ctx.fillStyle = STROKE[channel];
    for (const [x, y] of points) {
      ctx.beginPath();
      ctx.arc(x * w, h - y * h, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [curve, points, channel]);

  function toNorm(e: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = 1 - (e.clientY - rect.top) / rect.height;
    return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
  }

  function nearest(pt: [number, number]): number | null {
    let best: number | null = null;
    let bestD = GRAB;
    points.forEach(([x, y], i) => {
      const d = Math.hypot(x - pt[0], y - pt[1]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const pt = toNorm(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    const hit = nearest(pt);
    if (hit !== null) {
      dragRef.current = hit;
      return;
    }
    if (points.length >= MAX_CURVE_POINTS) return;
    const next: CurvePoints = [...points, pt].sort((a, b) => a[0] - b[0]);
    dragRef.current = next.findIndex((p) => p === pt);
    onLive(channel, next);
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const i = dragRef.current;
    if (i === null) return;
    const [x, y] = toNorm(e);
    const last = points.length - 1;
    // Endpoints slide vertically only, so the curve always spans the full range.
    const clampedX =
      i === 0 || i === last
        ? points[i][0]
        : Math.min(points[i + 1][0] - 0.01, Math.max(points[i - 1][0] + 0.01, x));
    const next = points.map((p, j) => (j === i ? ([clampedX, y] as [number, number]) : p));
    onLive(channel, next);
  }

  function endDrag() {
    if (dragRef.current === null) return;
    dragRef.current = null;
    onCommit();
  }

  function onDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const pt: [number, number] = [
      (e.clientX - rect.left) / rect.width,
      1 - (e.clientY - rect.top) / rect.height,
    ];
    const hit = nearest(pt);
    if (hit === null || hit === 0 || hit === points.length - 1) return;
    onLive(
      channel,
      points.filter((_, i) => i !== hit),
    );
    onCommit();
  }

  return (
    <div className="curve">
      <div className="hsl-ch">
        {CURVE_CHANNELS.map((ch) => (
          <button
            key={ch}
            type="button"
            className={ch === channel ? "on" : ""}
            onClick={() => setChannel(ch)}
          >
            {ch}
          </button>
        ))}
      </div>
      <canvas
        ref={canvasRef}
        className="curve-canvas"
        width={SIZE}
        height={SIZE}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={onDoubleClick}
      />
      <div className="curve-foot">
        <span className="stub">Click to add, drag to shape, double-click to remove.</span>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            onLive(channel, identityPoints());
            onCommit();
          }}
        >
          Reset {channel}
        </button>
      </div>
    </div>
  );
}
