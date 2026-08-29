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
  onResetCrop: () => void;
};

export function GeometryPanel({
  crop,
  cropToolActive,
  onToggleCropTool,
  onLive,
  onCommit,
  onAspect,
  onResetCrop,
}: GeometryPanelProps) {
  return (
    <>
      <div className="crop-tool-row">
        <button
          type="button"
          className={cropToolActive ? "on crop-tool-btn" : "crop-tool-btn"}
          onClick={onToggleCropTool}
        >
          {cropToolActive ? "Done (R)" : "Crop (R)"}
        </button>
        <button type="button" className="btn-ghost" onClick={onResetCrop} disabled={!crop.enabled && crop.angle === 0}>
          Reset
        </button>
      </div>
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
        onChange={(v) => onLive({ angle: v })}
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

/**
 * Hit box for a corner handle, kept fully inside the preview. Handles centred on a
 * frame-edge corner spill outside the clipped preview column and stop receiving
 * pointer events, so the box is nudged inward instead.
 */
export function handleHitBox(
  centerX: number,
  centerY: number,
  hit: number,
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number } {
  const fit = (v: number, extent: number) => Math.min(Math.max(v, 0), Math.max(0, extent - hit));
  return {
    left: fit(centerX - hit / 2, width),
    top: fit(centerY - hit / 2, height),
    width: hit,
    height: hit,
  };
}

type CropOverlayProps = {
  crop: Crop;
  width: number;
  height: number;
  /** View zoom applied to the stage; handles are counter-scaled to stay a constant size. */
  scale: number;
  onLive: (patch: CropPatch) => void;
  onCommit: () => void;
};

function screenToNorm(clientX: number, clientY: number, rect: DOMRect): [number, number] {
  return [
    Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
    Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
  ];
}

export function CropOverlay({ crop, width, height, scale, onLive, onCommit }: CropOverlayProps) {
  const left = crop.x * width;
  const top = crop.y * height;
  const boxW = crop.width * width;
  const boxH = crop.height * height;
  // Hit areas stay a generous 24px on screen; the visible marker inside is smaller.
  const hit = 24 / scale;
  const dot = 10 / scale;

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
        });
        return;
      }
      if (handle === "straighten") {
        const cx = base.x + base.width / 2;
        const cy = base.y + base.height / 2;
        const angle = (Math.atan2(ny - cy, nx - cx) * 180) / Math.PI;
        onLive({ angle: Math.min(RANGES.cropAngle[1], Math.max(RANGES.cropAngle[0], angle)) });
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
      onLive({ x, y, width: w, height: h, aspect: "custom" });
    }

    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onCommit();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const handleStyle = (x: number, y: number): React.CSSProperties => handleHitBox(x, y, hit, width, height);

  const handles: { id: CropHandle; style: React.CSSProperties }[] = [
    { id: "nw", style: handleStyle(left, top) },
    { id: "ne", style: handleStyle(left + boxW, top) },
    { id: "sw", style: handleStyle(left, top + boxH) },
    { id: "se", style: handleStyle(left + boxW, top + boxH) },
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
          borderWidth: 1 / scale,
        }}
        onPointerDown={(e) => startDrag("move", e)}
      />
      {handles.map((h) => (
        <div key={h.id} className={`crop-handle ${h.id}`} style={h.style} onPointerDown={(e) => startDrag(h.id, e)}>
          <span className="crop-handle-dot" style={{ width: dot, height: dot, borderWidth: 1 / scale }} />
        </div>
      ))}
      <div
        className="crop-straighten"
        style={{
          left: left + boxW / 2 - 40 / scale,
          top: top + boxH * 0.9,
          width: 80 / scale,
          height: 8 / scale,
          borderRadius: 4 / scale,
        }}
        onPointerDown={(e) => startDrag("straighten", e)}
      />
    </div>
  );
}
