import { RANGES, type Globals, type Mask } from "../recipe/types";
import { Panel, Slider } from "./controls";

type Props = {
  masks: Mask[];
  selectedId: string | null;
  solo: string | null;
  open: Record<string, boolean>;
  onToggle: (id: string, alt: boolean) => void;
  onSelect: (id: string) => void;
  onAddRadial: () => void;
  onRemove: () => void;
  onLiveMask: (mask: Mask) => void;
  onCommit: () => void;
};

function radialOf(mask: Mask) {
  const c = mask.components.find((x) => x.type === "radial");
  return c?.type === "radial" ? c : null;
}

export function MasksPanel({
  masks,
  selectedId,
  solo,
  open,
  onToggle,
  onSelect,
  onAddRadial,
  onRemove,
  onLiveMask,
  onCommit,
}: Props) {
  const selected = masks.find((m) => m.id === selectedId) ?? masks[0] ?? null;
  const radial = selected ? radialOf(selected) : null;

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

  return (
    <Panel id="masks" title="Masks" solo={solo} open={open} onToggle={onToggle}>
      <div className="mask-toolbar">
        <button type="button" onClick={onAddRadial}>
          Add radial
        </button>
        <button type="button" onClick={onRemove} disabled={!selected}>
          Delete
        </button>
      </div>
      {masks.length === 0 ? (
        <p className="stub">No masks. Add a radial to brighten a region locally.</p>
      ) : (
        <div className="mask-list hsl-ch">
          {masks.map((m) => (
            <button
              key={m.id}
              type="button"
              className={m.id === selected?.id ? "on" : ""}
              onClick={() => onSelect(m.id)}
            >
              {m.name}
            </button>
          ))}
        </div>
      )}
      {selected && radial ? (
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
          <Slider
            label="Center X"
            value={radial.cx}
            min={RANGES.maskCoord[0]}
            max={RANGES.maskCoord[1]}
            step={0.01}
            onChange={(v) =>
              update({
                ...selected,
                components: selected.components.map((c) =>
                  c.type === "radial" ? { ...c, cx: v } : c,
                ),
              })
            }
            onCommit={onCommit}
            onReset={() => {
              update({
                ...selected,
                components: selected.components.map((c) =>
                  c.type === "radial" ? { ...c, cx: 0.5 } : c,
                ),
              });
              onCommit();
            }}
          />
          <Slider
            label="Center Y"
            value={radial.cy}
            min={RANGES.maskCoord[0]}
            max={RANGES.maskCoord[1]}
            step={0.01}
            onChange={(v) =>
              update({
                ...selected,
                components: selected.components.map((c) =>
                  c.type === "radial" ? { ...c, cy: v } : c,
                ),
              })
            }
            onCommit={onCommit}
            onReset={() => {
              update({
                ...selected,
                components: selected.components.map((c) =>
                  c.type === "radial" ? { ...c, cy: 0.5 } : c,
                ),
              });
              onCommit();
            }}
          />
          <Slider
            label="Radius X"
            value={radial.radiusX}
            min={RANGES.maskRadius[0]}
            max={RANGES.maskRadius[1]}
            step={0.01}
            onChange={(v) =>
              update({
                ...selected,
                components: selected.components.map((c) =>
                  c.type === "radial" ? { ...c, radiusX: v } : c,
                ),
              })
            }
            onCommit={onCommit}
            onReset={() => {
              update({
                ...selected,
                components: selected.components.map((c) =>
                  c.type === "radial" ? { ...c, radiusX: 0.35 } : c,
                ),
              });
              onCommit();
            }}
          />
          <Slider
            label="Radius Y"
            value={radial.radiusY}
            min={RANGES.maskRadius[0]}
            max={RANGES.maskRadius[1]}
            step={0.01}
            onChange={(v) =>
              update({
                ...selected,
                components: selected.components.map((c) =>
                  c.type === "radial" ? { ...c, radiusY: v } : c,
                ),
              })
            }
            onCommit={onCommit}
            onReset={() => {
              update({
                ...selected,
                components: selected.components.map((c) =>
                  c.type === "radial" ? { ...c, radiusY: 0.35 } : c,
                ),
              });
              onCommit();
            }}
          />
          <p className="stub">Local adjustments</p>
          {paramSlider("exposure", "Exposure", RANGES.exposure, 0.05)}
          {paramSlider("contrast", "Contrast", RANGES.contrast, 1)}
          {paramSlider("highlights", "Highlights", RANGES.highlights, 1)}
          {paramSlider("shadows", "Shadows", RANGES.shadows, 1)}
        </>
      ) : null}
    </Panel>
  );
}
