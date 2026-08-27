import { useEffect, useRef } from "react";
import type { HistogramStats } from "../render/preview";

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  onCommit: () => void;
  onReset: () => void;
}) {
  const fmt = props.step < 1 ? props.value.toFixed(2) : String(Math.round(props.value));
  return (
    <div className="slider" onDoubleClick={props.onReset} title="Double-click to reset">
      <span className="slider-label">{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        aria-label={props.label}
        onChange={(e) => props.onChange(Number(e.target.value))}
        onPointerUp={props.onCommit}
        onBlur={props.onCommit}
      />
      <span className="slider-val">{fmt}</span>
    </div>
  );
}

export function Panel(props: {
  id: string;
  title: string;
  solo: string | null;
  open: Record<string, boolean>;
  onToggle: (id: string, alt: boolean) => void;
  children?: React.ReactNode;
  stub?: string;
}) {
  const shown = props.solo ? props.solo === props.id : (props.open[props.id] ?? true);
  if (props.solo && props.solo !== props.id) return null;
  return (
    <section className="acc">
      <button type="button" className="acc-h" onClick={(e) => props.onToggle(props.id, e.altKey)}>
        {props.title}
      </button>
      {shown ? <div className="acc-b">{props.stub ? <p className="stub">{props.stub}</p> : props.children}</div> : null}
    </section>
  );
}

export function HistogramView({ stats }: { stats: HistogramStats | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { width: w, height: h } = canvas;
    ctx.fillStyle = "#141416";
    ctx.fillRect(0, 0, w, h);
    if (!stats) return;
    const max = Math.max(1, ...stats.bins);
    const bw = w / stats.bins.length;
    ctx.fillStyle = "#c4a574";
    stats.bins.forEach((n, i) => {
      const bh = (n / max) * (h - 2);
      ctx.fillRect(i * bw, h - bh, Math.max(1, bw - 0.4), bh);
    });
  }, [stats]);
  return <canvas ref={ref} className="hist" width={248} height={72} />;
}

export function Stars(props: { rating: number; onRate: (n: number) => void }) {
  return (
    <div className="stars">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={n <= props.rating ? "on" : ""}
          aria-label={`${n} stars`}
          onClick={() => props.onRate(n === props.rating ? 0 : n)}
        >
          ★
        </button>
      ))}
    </div>
  );
}
