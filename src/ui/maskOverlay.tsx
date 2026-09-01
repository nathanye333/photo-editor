import type { Mask, MaskComponent } from "../recipe/types";
import { handleHitBox } from "./crop";

type RadialComponent = Extract<MaskComponent, { type: "radial" }>;
type LinearComponent = Extract<MaskComponent, { type: "linear" }>;

type Props = {
  component: RadialComponent | LinearComponent;
  width: number;
  height: number;
  scale: number;
  onLive: (component: MaskComponent) => void;
  onCommit: () => void;
};

function screenToNorm(clientX: number, clientY: number, rect: DOMRect): [number, number] {
  return [
    Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
    Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
  ];
}

function Handle({
  x,
  y,
  label,
  hit,
  dot,
  width,
  height,
  onDrag,
  onCommit,
}: {
  x: number;
  y: number;
  label: string;
  hit: number;
  dot: number;
  width: number;
  height: number;
  onDrag: (uv: [number, number]) => void;
  onCommit: () => void;
}) {
  const box = handleHitBox(x, y, hit, width, height);
  return (
    <div
      className={`mask-handle mask-handle-${label}`}
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const overlay = (e.currentTarget as HTMLElement).closest(".mask-overlay") as HTMLElement;
        const rect = overlay.getBoundingClientRect();
        function onMove(ev: PointerEvent) {
          onDrag(screenToNorm(ev.clientX, ev.clientY, rect));
        }
        function onUp() {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          onCommit();
        }
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      }}
    >
      <div className="mask-handle-dot" style={{ width: dot, height: dot }} />
    </div>
  );
}

export function MaskOverlay({ component, width, height, scale, onLive, onCommit }: Props) {
  const hit = 24 / scale;
  const dot = 10 / scale;

  if (component.type === "radial") {
    const cx = component.cx * width;
    const cy = component.cy * height;
    const rx = component.radiusX * width;
    const ry = component.radiusY * height;
    return (
      <div className="mask-overlay" style={{ width, height }}>
        <svg className="mask-guide" width={width} height={height}>
          <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={1 / scale} />
        </svg>
        <Handle
          x={cx}
          y={cy}
          label="center"
          hit={hit}
          dot={dot}
          width={width}
          height={height}
          onDrag={([nx, ny]) => onLive({ ...component, cx: nx, cy: ny })}
          onCommit={onCommit}
        />
        <Handle
          x={cx + rx}
          y={cy}
          label="radius"
          hit={hit}
          dot={dot}
          width={width}
          height={height}
          onDrag={([nx, ny]) => {
            const dx = Math.abs(nx - component.cx);
            const dy = Math.abs(ny - component.cy);
            onLive({
              ...component,
              radiusX: Math.max(0.02, Math.min(1, dx)),
              radiusY: Math.max(0.02, Math.min(1, dy || component.radiusY)),
            });
          }}
          onCommit={onCommit}
        />
      </div>
    );
  }

  const sx = component.start[0] * width;
  const sy = component.start[1] * height;
  const ex = component.end[0] * width;
  const ey = component.end[1] * height;
  return (
    <div className="mask-overlay" style={{ width, height }}>
      <svg className="mask-guide" width={width} height={height}>
        <line
          x1={sx}
          y1={sy}
          x2={ex}
          y2={ey}
          stroke="rgba(255,255,255,0.55)"
          strokeWidth={1 / scale}
          strokeDasharray={`${4 / scale} ${4 / scale}`}
        />
      </svg>
      <Handle
        x={sx}
        y={sy}
        label="start"
        hit={hit}
        dot={dot}
        width={width}
        height={height}
        onDrag={([nx, ny]) => onLive({ ...component, start: [nx, ny] })}
        onCommit={onCommit}
      />
      <Handle
        x={ex}
        y={ey}
        label="end"
        hit={hit}
        dot={dot}
        width={width}
        height={height}
        onDrag={([nx, ny]) => onLive({ ...component, end: [nx, ny] })}
        onCommit={onCommit}
      />
    </div>
  );
}
