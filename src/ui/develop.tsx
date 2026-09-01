import { useState } from "react";
import { GRADE_ZONES, HSL_CHANNELS, RANGES, type Crop, type CropAspect, type CropPatch, type EditRecipe, type GlobalsPatch, type HslChannel, type Mask } from "../recipe/types";
import { Panel, Slider } from "./controls";
import { GeometryPanel } from "./crop";
import { CurveEditor } from "./curve";
import { ColorWheel } from "./wheel";
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
        <p className="group-label">Presence</p>
        {num("texture", "Texture", RANGES.texture, 1)}
        {num("clarity", "Clarity", RANGES.clarity, 1)}
        {num("dehaze", "Dehaze", RANGES.dehaze, 1)}
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
      <Panel {...panel("grade", "Color Grading")}>
        <div className="wheels">
          {GRADE_ZONES.map((zone) => (
            <ColorWheel
              key={zone}
              label={zone}
              wheel={g.colorGrading[zone]}
              onLive={(next) => onLive({ colorGrading: { [zone]: next } })}
              onCommit={onCommit}
            />
          ))}
        </div>
        {GRADE_ZONES.map((zone) => (
          <Slider
            key={zone}
            label={`${zone[0].toUpperCase() + zone.slice(1)} lum`}
            value={g.colorGrading[zone].lum}
            min={RANGES.gradeLum[0]}
            max={RANGES.gradeLum[1]}
            step={1}
            onChange={(v) => onLive({ colorGrading: { [zone]: { lum: v } } })}
            onCommit={onCommit}
            onReset={() => {
              onLive({ colorGrading: { [zone]: { lum: 0 } } });
              onCommit();
            }}
          />
        ))}
        <Slider
          label="Blending"
          value={g.colorGrading.blending}
          min={RANGES.gradeBlending[0]}
          max={RANGES.gradeBlending[1]}
          step={1}
          onChange={(v) => onLive({ colorGrading: { blending: v } })}
          onCommit={onCommit}
          onReset={() => {
            onLive({ colorGrading: { blending: 50 } });
            onCommit();
          }}
        />
        <Slider
          label="Balance"
          value={g.colorGrading.balance}
          min={RANGES.gradeBalance[0]}
          max={RANGES.gradeBalance[1]}
          step={1}
          onChange={(v) => onLive({ colorGrading: { balance: v } })}
          onCommit={onCommit}
          onReset={() => {
            onLive({ colorGrading: { balance: 0 } });
            onCommit();
          }}
        />
      </Panel>
      <Panel {...panel("detail", "Detail")}>
        <p className="group-label">Sharpening</p>
        {num("sharpening", "Amount", RANGES.sharpening, 1)}
        {num("sharpenRadius", "Radius", RANGES.sharpenRadius, 1)}
        {num("sharpenDetail", "Detail", RANGES.sharpenDetail, 1)}
        {num("sharpenMasking", "Masking", RANGES.sharpenMasking, 1)}
        <p className="group-label">Noise Reduction</p>
        {num("noiseReduction", "Luminance", RANGES.noiseReduction, 1)}
        {num("noiseReductionDetail", "Detail", RANGES.noiseReductionDetail, 1)}
        {num("colorNoiseReduction", "Color", RANGES.colorNoiseReduction, 1)}
        {num("moire", "Moiré", RANGES.moire, 1)}
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
