import { useState } from "react";
import { HSL_CHANNELS, RANGES, type Crop, type CropAspect, type CropPatch, type EditRecipe, type GlobalsPatch, type HslChannel, type Mask } from "../recipe/types";
import { Panel, Slider } from "./controls";
import { GeometryPanel } from "./crop";
import { CurveEditor } from "./curve";
import { MasksPanel, type BrushToolSettings } from "./masks";

type Props = {
  recipe: EditRecipe;
  crop: Crop;
  solo: string | null;
  open: Record<string, boolean>;
  selectedMaskId: string | null;
  brushTool: BrushToolSettings;
  cropToolActive: boolean;
  onToggle: (id: string, alt: boolean) => void;
  onLive: (patch: GlobalsPatch) => void;
  onLiveCrop: (patch: CropPatch) => void;
  onCommit: () => void;
  onCommitCrop: () => void;
  onToggleCropTool: () => void;
  onCropAspect: (aspect: CropAspect) => void;
  onResetCrop: () => void;
  onSelectMask: (id: string) => void;
  onAddRadialMask: () => void;
  onAddBrushMask: () => void;
  onAddLuminanceMask: () => void;
  onAddColorMask: () => void;
  onRemoveMask: () => void;
  onLiveMask: (mask: Mask) => void;
  onBrushTool: (next: Partial<BrushToolSettings>) => void;
};

export function DevelopPanels({
  recipe,
  crop,
  solo,
  open,
  selectedMaskId,
  brushTool,
  cropToolActive,
  onToggle,
  onLive,
  onLiveCrop,
  onCommit,
  onCommitCrop,
  onToggleCropTool,
  onCropAspect,
  onResetCrop,
  onSelectMask,
  onAddRadialMask,
  onAddBrushMask,
  onAddLuminanceMask,
  onAddColorMask,
  onRemoveMask,
  onLiveMask,
  onBrushTool,
}: Props) {
  const [hslCh, setHslCh] = useState<HslChannel>("orange");
  const g = recipe.globals;
  const panel = (id: string, title: string) => ({ id, title, solo, open, onToggle });

  const num = (
    key: keyof Omit<GlobalsPatch, "hsl" | "toneCurve">,
    label: string,
    range: readonly [number, number],
    step: number,
  ) => (
    <Slider
      label={label}
      value={g[key] as number}
      min={range[0]}
      max={range[1]}
      step={step}
      onChange={(v) => onLive({ [key]: v })}
      onCommit={onCommit}
      onReset={() => {
        onLive({ [key]: 0 });
        onCommit();
      }}
    />
  );

  return (
    <>
      <Panel {...panel("basic", "Basic")}>
        {num("exposure", "Exposure", RANGES.exposure, 0.05)}
        {num("contrast", "Contrast", RANGES.contrast, 1)}
        {num("highlights", "Highlights", RANGES.highlights, 1)}
        {num("shadows", "Shadows", RANGES.shadows, 1)}
        {num("whites", "Whites", RANGES.whites, 1)}
        {num("blacks", "Blacks", RANGES.blacks, 1)}
        {num("temp", "Temp", RANGES.temp, 1)}
        {num("tint", "Tint", RANGES.tint, 1)}
        {num("vibrance", "Vibrance", RANGES.vibrance, 1)}
        {num("saturation", "Saturation", RANGES.saturation, 1)}
      </Panel>
      <Panel {...panel("curve", "Tone Curve")}>
        <CurveEditor
          curve={g.toneCurve}
          onLive={(channel, points) => onLive({ toneCurve: { channels: { [channel]: points } } })}
          onCommit={onCommit}
        />
        {(["highlights", "lights", "darks", "shadows"] as const).map((k) => (
          <Slider
            key={k}
            label={k[0].toUpperCase() + k.slice(1)}
            value={g.toneCurve[k]}
            min={RANGES.curve[0]}
            max={RANGES.curve[1]}
            step={1}
            onChange={(v) => onLive({ toneCurve: { [k]: v } })}
            onCommit={onCommit}
            onReset={() => {
              onLive({ toneCurve: { [k]: 0 } });
              onCommit();
            }}
          />
        ))}
      </Panel>
      <Panel {...panel("hsl", "HSL")}>
        <div className="hsl-ch">
          {HSL_CHANNELS.map((ch) => (
            <button
              key={ch}
              type="button"
              className={ch === hslCh ? "on" : ""}
              onClick={() => setHslCh(ch)}
            >
              {ch}
            </button>
          ))}
        </div>
        {(["hue", "sat", "lum"] as const).map((k) => (
          <Slider
            key={k}
            label={k.toUpperCase()}
            value={g.hsl[hslCh][k]}
            min={-100}
            max={100}
            step={1}
            onChange={(v) => onLive({ hsl: { [hslCh]: { [k]: v } } })}
            onCommit={onCommit}
            onReset={() => {
              onLive({ hsl: { [hslCh]: { [k]: 0 } } });
              onCommit();
            }}
          />
        ))}
      </Panel>
      <Panel {...panel("grade", "Color Grading")} stub="Global wheels land after v1. Use Temp/Tint and HSL for now." />
      <Panel {...panel("detail", "Detail")}>
        {num("sharpening", "Sharpening", RANGES.sharpening, 1)}
        {num("noiseReduction", "Noise Reduction", RANGES.noiseReduction, 1)}
        {num("clarity", "Clarity", RANGES.clarity, 1)}
        {num("dehaze", "Dehaze", RANGES.dehaze, 1)}
      </Panel>
      <MasksPanel
        masks={recipe.masks}
        selectedId={selectedMaskId}
        solo={solo}
        open={open}
        brushTool={brushTool}
        onToggle={onToggle}
        onSelect={onSelectMask}
        onAddRadial={onAddRadialMask}
        onAddBrush={onAddBrushMask}
        onAddLuminance={onAddLuminanceMask}
        onAddColor={onAddColorMask}
        onRemove={onRemoveMask}
        onLiveMask={onLiveMask}
        onCommit={onCommit}
        onBrushTool={onBrushTool}
      />
      <Panel {...panel("optics", "Optics")}>
        {num("lensCorrection", "Lens correction", RANGES.lensCorrection, 1)}
        <p className="stub">Stored on the recipe; no profile library in v1.</p>
      </Panel>
      <Panel {...panel("geo", "Geometry")}>
        <GeometryPanel
          crop={crop}
          cropToolActive={cropToolActive}
          onToggleCropTool={onToggleCropTool}
          onLive={onLiveCrop}
          onCommit={onCommitCrop}
          onAspect={onCropAspect}
          onResetCrop={onResetCrop}
        />
      </Panel>
    </>
  );
}
