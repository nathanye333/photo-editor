import type { Crop, CropAspect, CropPatch } from "../recipe/types";
import { RANGES } from "../recipe/types";
import { Slider } from "./controls";

const ASPECTS: { id: CropAspect; label: string }[] = [
  { id: "original", label: "Original" },
  { id: "1:1", label: "1:1" },
  { id: "4:5", label: "4:5" },
  { id: "16:9", label: "16:9" },
];

type GeometryPanelProps = {
  crop: Crop;
  cropToolActive: boolean;
  onToggleCropTool: () => void;
  onLive: (patch: CropPatch) => void;
  onCommit: () => void;
  onAspect: (aspect: CropAspect) => void;
};

export function GeometryPanel({
  crop,
  cropToolActive,
  onToggleCropTool,
  onLive,
  onCommit,
  onAspect,
}: GeometryPanelProps) {
  return (
    <>
      <button type="button" className={cropToolActive ? "on crop-tool-btn" : "crop-tool-btn"} onClick={onToggleCropTool}>
        {cropToolActive ? "Done cropping" : "Crop overlay"}
      </button>
      <label className="crop-enable">
        <input
          type="checkbox"
          checked={crop.enabled}
          onChange={(e) => {
            onLive({ enabled: e.target.checked });
            onCommit();
          }}
        />
        Apply crop on export
      </label>
      <p className="panel-label">Aspect ratio</p>
      <div className="aspect-btns">
        {ASPECTS.map((a) => (
          <button
            key={a.id}
            type="button"
            className={crop.aspect === a.id ? "on" : ""}
            onClick={() => onAspect(a.id)}
          >
            {a.label}
          </button>
        ))}
      </div>
      <Slider
        label="Straighten"
        value={crop.angle}
        min={RANGES.cropAngle[0]}
        max={RANGES.cropAngle[1]}
        step={0.1}
        onChange={(v) => onLive({ angle: v, enabled: crop.enabled || cropToolActive })}
        onCommit={onCommit}
        onReset={() => {
          onLive({ angle: 0 });
          onCommit();
        }}
      />
    </>
  );
}

export type CropHandle = "move" | "nw" | "ne" | "sw" | "se" | "straighten";

type CropOverlayProps = {
  crop: Crop;
  width: number;
  height: number;
  onLive: (patch: CropPatch) => void;
  onCommit: () => void;
};

function screenToNorm(clientX: number, clientY: number, rect: DOMRect): [number, number] {
  return [
    Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
    Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
  ];
}

export function CropOverlay({ crop, width, height, onLive, onCommit }: CropOverlayProps) {
  const left = crop.x * width;
  const top = crop.y * height;
  const boxW = crop.width * width;
  const boxH = crop.height * height;

  function startDrag(handle: CropHandle, e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const overlay = (e.currentTarget as HTMLElement).closest(".crop-overlay") as HTMLElement;
    const rect = overlay.getBoundingClientRect();
    const start = screenToNorm(e.clientX, e.clientY, rect);
    const base = { ...crop };

    function onMove(ev: PointerEvent) {
      const [nx, ny] = screenToNorm(ev.clientX, ev.clientY, rect);
      const dx = nx - start[0];
      const dy = ny - start[1];
      if (handle === "move") {
        onLive({
          x: Math.min(1 - base.width, Math.max(0, base.x + dx)),
          y: Math.min(1 - base.height, Math.max(0, base.y + dy)),
          enabled: true,
        });
        return;
      }
      if (handle === "straighten") {
        const cx = base.x + base.width / 2;
        const cy = base.y + base.height / 2;
        const angle = (Math.atan2(ny - cy, nx - cx) * 180) / Math.PI;
        onLive({ angle: Math.min(RANGES.cropAngle[1], Math.max(RANGES.cropAngle[0], angle)), enabled: true });
        return;
      }
      let x = base.x;
      let y = base.y;
      let w = base.width;
      let h = base.height;
      if (handle.includes("w")) {
        x = Math.min(base.x + base.width - 0.02, base.x + dx);
        w = base.width - (x - base.x);
      }
      if (handle.includes("e")) {
        w = Math.max(0.02, base.width + dx);
      }
      if (handle.includes("n")) {
        y = Math.min(base.y + base.height - 0.02, base.y + dy);
        h = base.height - (y - base.y);
      }
      if (handle.includes("s")) {
        h = Math.max(0.02, base.height + dy);
      }
      x = Math.min(1 - w, Math.max(0, x));
      y = Math.min(1 - h, Math.max(0, y));
      onLive({ x, y, width: w, height: h, enabled: true, aspect: "custom" });
    }

    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onCommit();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const handles: { id: CropHandle; style: React.CSSProperties }[] = [
    { id: "nw", style: { left: left - 5, top: top - 5 } },
    { id: "ne", style: { left: left + boxW - 5, top: top - 5 } },
    { id: "sw", style: { left: left - 5, top: top + boxH - 5 } },
    { id: "se", style: { left: left + boxW - 5, top: top + boxH - 5 } },
  ];

  return (
    <div className="crop-overlay" style={{ width, height }}>
      <div
        className="crop-box"
        style={{
          left,
          top,
          width: boxW,
          height: boxH,
          transform: `rotate(${crop.angle}deg)`,
        }}
        onPointerDown={(e) => startDrag("move", e)}
      />
      {handles.map((h) => (
        <div key={h.id} className={`crop-handle ${h.id}`} style={h.style} onPointerDown={(e) => startDrag(h.id, e)} />
      ))}
      <div
        className="crop-straighten"
        style={{ left: left + boxW / 2 - 40, top: top + boxH * 0.9 - 4 }}
        onPointerDown={(e) => startDrag("straighten", e)}
      />
    </div>
  );
}
