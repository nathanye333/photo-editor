import {
  RANGES,
  maskKindLabel,
  primaryComponent,
  type BrushStroke,
  type Globals,
  type Mask,
  type MaskComponent,
} from "../recipe/types";
import { Panel, Slider } from "./controls";

export type BrushToolSettings = {
  size: number;
  hardness: number;
  opacity: number;
  erase: boolean;
};

type Props = {
  masks: Mask[];
  selectedId: string | null;
  solo: string | null;
  open: Record<string, boolean>;
  brushTool: BrushToolSettings;
  onToggle: (id: string, alt: boolean) => void;
  onSelect: (id: string) => void;
  onAddRadial: () => void;
  onAddBrush: () => void;
  onAddLuminance: () => void;
  onAddColor: () => void;
  onRemove: () => void;
  onLiveMask: (mask: Mask) => void;
  onCommit: () => void;
  onBrushTool: (next: Partial<BrushToolSettings>) => void;
};

function updateComponent(mask: Mask, next: MaskComponent): Mask {
  return { ...mask, components: [next, ...mask.components.slice(1)] };
}

export function MasksPanel({
  masks,
  selectedId,
  solo,
  open,
  brushTool,
  onToggle,
  onSelect,
  onAddRadial,
  onAddBrush,
  onAddLuminance,
  onAddColor,
  onRemove,
  onLiveMask,
  onCommit,
  onBrushTool,
}: Props) {
  const selected = masks.find((m) => m.id === selectedId) ?? masks[0] ?? null;
  const component = selected ? primaryComponent(selected) : null;

  const update = (next: Mask) => onLiveMask(next);

  const paramSlider = (
    key: keyof Pick<Globals, "exposure" | "contrast" | "highlights" | "shadows">,
    label: string,
    range: readonly [number, number],
    step: number,
  ) => {
    if (!selected) return null;
    const value = (selected.params[key] as number | undefined) ?? 0;
    return (
      <Slider
        label={label}
        value={value}
        min={range[0]}
        max={range[1]}
        step={step}
        onChange={(v) => update({ ...selected, params: { ...selected.params, [key]: v } })}
        onCommit={onCommit}
        onReset={() => {
          const params = { ...selected.params };
          delete params[key];
          update({ ...selected, params });
          onCommit();
        }}
      />
    );
  };

  const sharedMaskChrome = selected ? (
    <>
      <label className="mask-check">
        <input
          type="checkbox"
          checked={selected.invert}
          onChange={(e) => {
            update({ ...selected, invert: e.target.checked });
            onCommit();
          }}
        />
        Invert
      </label>
      <Slider
        label="Density"
        value={selected.density}
        min={RANGES.maskDensity[0]}
        max={RANGES.maskDensity[1]}
        step={1}
        onChange={(v) => update({ ...selected, density: v })}
        onCommit={onCommit}
        onReset={() => {
          update({ ...selected, density: 100 });
          onCommit();
        }}
      />
    </>
  ) : null;

  const localParams = (
    <>
      <p className="stub">Local adjustments</p>
      {paramSlider("exposure", "Exposure", RANGES.exposure, 0.05)}
      {paramSlider("contrast", "Contrast", RANGES.contrast, 1)}
      {paramSlider("highlights", "Highlights", RANGES.highlights, 1)}
      {paramSlider("shadows", "Shadows", RANGES.shadows, 1)}
    </>
  );

  return (
    <Panel id="masks" title="Masks" solo={solo} open={open} onToggle={onToggle}>
      <div className="mask-toolbar wrap">
        <button type="button" onClick={onAddBrush}>
          Brush
        </button>
        <button type="button" onClick={onAddColor}>
          Color
        </button>
        <button type="button" onClick={onAddLuminance}>
          Luma
        </button>
        <button type="button" onClick={onAddRadial}>
          Radial
        </button>
        <button type="button" onClick={onRemove} disabled={!selected}>
          Delete
        </button>
      </div>
      {masks.length === 0 ? (
        <p className="stub">Paint with Brush, or select by Color / Luma. Radial is a soft oval falloff.</p>
      ) : (
        <div className="mask-list hsl-ch">
          {masks.map((m) => (
            <button
              key={m.id}
              type="button"
              className={m.id === selected?.id ? "on" : ""}
              onClick={() => onSelect(m.id)}
              title={maskKindLabel(m)}
            >
              {m.name}
            </button>
          ))}
        </div>
      )}

      {selected && component?.type === "brush" ? (
        <>
          {sharedMaskChrome}
          <p className="stub">Paint on the preview. Hold to stroke; check Erase to remove.</p>
          <label className="mask-check">
            <input
              type="checkbox"
              checked={brushTool.erase}
              onChange={(e) => onBrushTool({ erase: e.target.checked })}
            />
            Erase
          </label>
          <Slider
            label="Size"
            value={brushTool.size}
            min={RANGES.brushSize[0]}
            max={RANGES.brushSize[1]}
            step={1}
            onChange={(v) => onBrushTool({ size: v })}
            onCommit={() => {}}
            onReset={() => onBrushTool({ size: 20 })}
          />
          <Slider
            label="Hardness"
            value={brushTool.hardness}
            min={RANGES.brushHardness[0]}
            max={RANGES.brushHardness[1]}
            step={1}
            onChange={(v) => onBrushTool({ hardness: v })}
            onCommit={() => {}}
            onReset={() => onBrushTool({ hardness: 50 })}
          />
          <Slider
            label="Opacity"
            value={brushTool.opacity}
            min={RANGES.brushOpacity[0]}
            max={RANGES.brushOpacity[1]}
            step={1}
            onChange={(v) => onBrushTool({ opacity: v })}
            onCommit={() => {}}
            onReset={() => onBrushTool({ opacity: 100 })}
          />
          <p className="stub">{component.strokes.length} stroke{component.strokes.length === 1 ? "" : "s"}</p>
          {localParams}
        </>
      ) : null}

      {selected && component?.type === "luminance_range" ? (
        <>
          {sharedMaskChrome}
          <p className="stub">Selects pixels by brightness. Click preview to center the range.</p>
          <Slider
            label="Min"
            value={component.min}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) =>
              update(updateComponent(selected, { ...component, min: Math.min(v, component.max) }))
            }
            onCommit={onCommit}
            onReset={() => {
              update(updateComponent(selected, { ...component, min: 0.25 }));
              onCommit();
            }}
          />
          <Slider
            label="Max"
            value={component.max}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) =>
              update(updateComponent(selected, { ...component, max: Math.max(v, component.min) }))
            }
            onCommit={onCommit}
            onReset={() => {
              update(updateComponent(selected, { ...component, max: 0.75 }));
              onCommit();
            }}
          />
          <Slider
            label="Smooth"
            value={component.smooth}
            min={0}
            max={0.5}
            step={0.01}
            onChange={(v) => update(updateComponent(selected, { ...component, smooth: v }))}
            onCommit={onCommit}
            onReset={() => {
              update(updateComponent(selected, { ...component, smooth: 0.1 }));
              onCommit();
            }}
          />
          {localParams}
        </>
      ) : null}

      {selected && component?.type === "color_range" ? (
        <>
          {sharedMaskChrome}
          <p className="stub">Click the preview to sample a color, then tune tolerance.</p>
          <div
            className="color-swatch"
            style={{
              background: `hsl(${component.hue * 360} ${(0.25 + component.chroma * 0.75) * 100}% 50%)`,
            }}
            title="Sampled color"
          />
          <Slider
            label="Hue"
            value={component.hue}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => update(updateComponent(selected, { ...component, hue: v }))}
            onCommit={onCommit}
            onReset={() => {
              update(updateComponent(selected, { ...component, hue: 0.33 }));
              onCommit();
            }}
          />
          <Slider
            label="Chroma"
            value={component.chroma}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => update(updateComponent(selected, { ...component, chroma: v }))}
            onCommit={onCommit}
            onReset={() => {
              update(updateComponent(selected, { ...component, chroma: 0.45 }));
              onCommit();
            }}
          />
          <Slider
            label="Tolerance"
            value={component.tolerance}
            min={0.02}
            max={0.8}
            step={0.01}
            onChange={(v) => update(updateComponent(selected, { ...component, tolerance: v }))}
            onCommit={onCommit}
            onReset={() => {
              update(updateComponent(selected, { ...component, tolerance: 0.2 }));
              onCommit();
            }}
          />
          {localParams}
        </>
      ) : null}

      {selected && component?.type === "radial" ? (
        <>
          {sharedMaskChrome}
          <Slider
            label="Feather"
            value={selected.feather}
            min={RANGES.maskFeather[0]}
            max={RANGES.maskFeather[1]}
            step={1}
            onChange={(v) => update({ ...selected, feather: v })}
            onCommit={onCommit}
            onReset={() => {
              update({ ...selected, feather: 50 });
              onCommit();
            }}
          />
          <Slider
            label="Center X"
            value={component.cx}
            min={RANGES.maskCoord[0]}
            max={RANGES.maskCoord[1]}
            step={0.01}
            onChange={(v) => update(updateComponent(selected, { ...component, cx: v }))}
            onCommit={onCommit}
            onReset={() => {
              update(updateComponent(selected, { ...component, cx: 0.5 }));
              onCommit();
            }}
          />
          <Slider
            label="Center Y"
            value={component.cy}
            min={RANGES.maskCoord[0]}
            max={RANGES.maskCoord[1]}
            step={0.01}
            onChange={(v) => update(updateComponent(selected, { ...component, cy: v }))}
            onCommit={onCommit}
            onReset={() => {
              update(updateComponent(selected, { ...component, cy: 0.5 }));
              onCommit();
            }}
          />
          <Slider
            label="Radius X"
            value={component.radiusX}
            min={RANGES.maskRadius[0]}
            max={RANGES.maskRadius[1]}
            step={0.01}
            onChange={(v) => update(updateComponent(selected, { ...component, radiusX: v }))}
            onCommit={onCommit}
            onReset={() => {
              update(updateComponent(selected, { ...component, radiusX: 0.35 }));
              onCommit();
            }}
          />
          <Slider
            label="Radius Y"
            value={component.radiusY}
            min={RANGES.maskRadius[0]}
            max={RANGES.maskRadius[1]}
            step={0.01}
            onChange={(v) => update(updateComponent(selected, { ...component, radiusY: v }))}
            onCommit={onCommit}
            onReset={() => {
              update(updateComponent(selected, { ...component, radiusY: 0.35 }));
              onCommit();
            }}
          />
          {localParams}
        </>
      ) : null}
    </Panel>
  );
}

export type { BrushStroke };
