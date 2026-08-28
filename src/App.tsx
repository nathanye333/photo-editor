import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runAgentTurn } from "./agent/run";
import type { AgentActions } from "./agent/tools";
import { photosFromFileList, photosFromScanned, loadRawPreview } from "./catalog/import";
import { photoThumbSrc } from "./catalog/media";
import { emptyPhoto, loadPhotos, loadPresets, openCatalog, savePresetRow, upsertPhoto } from "./catalog/store";
import { fileName, type Photo, type Preset } from "./catalog/types";
import { fileExists, fileUrl, isTauri, pickFolder, pickSaveJpeg, scanFolder, writeFileBytes } from "./native";
import { applyAspectPreset } from "./recipe/crop";
import { cloneRecipe, createBrushMask, createColorRangeMask, createLuminanceMask, createRadialMask, defaultRecipe } from "./recipe/defaults";
import { pushHistory, redo, undo } from "./recipe/history";
import { applyCatalogPatch, applyPatch } from "./recipe/patch";
import type { BrushStroke, CatalogPatch, CropAspect, CropPatch, EditRecipe, Flag, GlobalsPatch, Mask } from "./recipe/types";
import { primaryComponent } from "./recipe/types";
import { bitmapFromBlob, PreviewRenderer, thumbnailFromBitmap, type HistogramStats, type ViewMode } from "./render/preview";
import { createSampleBitmap } from "./render/sampleImage";
import { loadSettings, saveSettings, type AppSettings } from "./settings";
import { AgentChat, SettingsModal, type ChatMsg } from "./ui/agentChat";
import { HistogramView, Stars } from "./ui/controls";
import { CropOverlay } from "./ui/crop";
import { DevelopPanels } from "./ui/develop";
import { Filmstrip, FolderList, LibraryGrid, MetaList } from "./ui/library";
import type { BrushToolSettings } from "./ui/masks";
import "./App.css";

type Module = "library" | "develop";

function samplePhoto(): Photo {
  return emptyPhoto({
    id: "sample",
    path: "Sample.jpg",
    width: 1280,
    height: 800,
    folder: "Sample",
    kind: "sample",
  });
}

export default function App() {
  const [mod, setMod] = useState<Module>("develop");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [clipboard, setClipboard] = useState<EditRecipe | null>(null);
  const [view, setView] = useState<ViewMode>("fit");
  const [before, setBefore] = useState(false);
  const [solo, setSolo] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({
    basic: true,
    curve: true,
    hsl: true,
    detail: true,
    masks: true,
  });
  const [selectedMaskId, setSelectedMaskId] = useState<string | null>(null);
  const [brushTool, setBrushTool] = useState<BrushToolSettings>({
    size: 20,
    hardness: 50,
    opacity: 100,
    erase: false,
  });
  const brushToolRef = useRef(brushTool);
  brushToolRef.current = brushTool;
  const paintingRef = useRef(false);
  const strokePointsRef = useRef<Array<[number, number]>>([]);
  const selectedMaskIdRef = useRef<string | null>(null);
  selectedMaskIdRef.current = selectedMaskId;
  const [cropToolActive, setCropToolActive] = useState(false);
  const [previewSize, setPreviewSize] = useState({ w: 0, h: 0 });
  const [brushCursor, setBrushCursor] = useState<{ x: number; y: number; d: number } | null>(null);
  const [hist, setHist] = useState<HistogramStats | null>(null);
  const [agentOpen, setAgentOpen] = useState(true);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(defaultSettingsSafe);
  const [status, setStatus] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<PreviewRenderer | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<Photo | null>(null);
  const selectedIdRef = useRef<string | null>(null);

  const photo = photos.find((p) => p.id === selectedId) ?? null;
  photoRef.current = photo;
  selectedIdRef.current = selectedId;

  const visible = useMemo(() => {
    const list = folder ? photos.filter((p) => p.folder === folder) : photos;
    return list;
  }, [photos, folder]);
  const folders = useMemo(() => [...new Set(photos.map((p) => p.folder))].sort(), [photos]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await openCatalog();
      const rows = await loadPhotos();
      const marked = isTauri()
        ? await Promise.all(
            rows.map(async (p) =>
              p.kind === "sample" ? p : { ...p, missing: !(await fileExists(p.path)) },
            ),
          )
        : rows;
      if (cancelled) return;
      const list = marked.length ? marked : [samplePhoto()];
      setPhotos(list);
      setSelectedId(list[0].id);
      setPresets(await loadPresets());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new PreviewRenderer(canvas);
    renderer.setHistogramListener(setHist);
    rendererRef.current = renderer;
    return () => {
      renderer.setHistogramListener(null);
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.setBefore(before);
  }, [before]);

  useEffect(() => {
    const recipe = photo?.recipe ?? defaultRecipe();
    const displayRecipe = cropToolActive
      ? { ...recipe, crop: { ...recipe.crop, enabled: false } }
      : recipe;
    rendererRef.current?.setRecipe(displayRecipe);
  }, [photo?.recipe, cropToolActive]);

  useEffect(() => {
    setSelectedMaskId(photo?.recipe.masks[0]?.id ?? null);
    setCropToolActive(false);
  }, [photo?.id]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    let cancelled = false;
    (async () => {
      if (!photo || photo.missing) {
        renderer.setImage(null);
        return;
      }
      try {
        if (photo.kind === "sample") {
          const bmp = await createSampleBitmap();
          if (cancelled) {
            bmp.close();
            return;
          }
          renderer.setImage(bmp);
          if (!photo.blobUrl) {
            const thumb = await thumbnailFromBitmap(bmp);
            const url = URL.createObjectURL(thumb);
            const current = photoRef.current;
            if (current && current.id === photo.id) {
              photoRef.current = { ...current, blobUrl: url };
              setPhotos((ps) => ps.map((p) => (p.id === photo.id ? { ...p, blobUrl: url } : p)));
            }
          }
          return;
        }
        if (photo.blobUrl) {
          const blob = await fetch(photo.blobUrl).then((r) => r.blob());
          const bmp = await bitmapFromBlob(blob);
          if (!cancelled) renderer.setImage(bmp);
          return;
        }
        if (photo.kind === "raw" && isTauri()) {
          const raw = await loadRawPreview(photo.path);
          if (cancelled) {
            raw.bitmap.close();
            return;
          }
          renderer.setImage(raw.bitmap);
          return;
        }
        if (isTauri()) {
          const blob = await fetch(fileUrl(photo.path)).then((r) => r.blob());
          const bmp = await bitmapFromBlob(blob);
          if (!cancelled) renderer.setImage(bmp);
        }
      } catch {
        if (!cancelled) renderer.setImage(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [photo?.id, photo?.path, photo?.kind, photo?.missing]);

  const layoutPreview = useCallback(() => {
    const host = hostRef.current;
    const renderer = rendererRef.current;
    const canvas = canvasRef.current;
    if (!host || !renderer) return;
    renderer.layout(view, host.clientWidth, host.clientHeight);
    if (canvas) setPreviewSize({ w: canvas.width, h: canvas.height });
  }, [view]);

  useEffect(() => {
    layoutPreview();
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(layoutPreview);
    ro.observe(host);
    return () => ro.disconnect();
  }, [layoutPreview, photo?.id, photo?.recipe.crop, cropToolActive]);

  function liveCrop(patch: CropPatch) {
    const current = photoRef.current;
    if (!current) return;
    const next = applyPatch(current.recipe, { crop: patch }, "absolute");
    if (patch.angle !== undefined) {
      next.globals = { ...next.globals, cropAngle: next.crop.angle };
    }
    replacePhoto({ ...current, recipe: next }, false);
  }

  function onCropAspect(aspect: CropAspect) {
    const current = photoRef.current;
    if (!current?.width || !current.height) return;
    const crop = applyAspectPreset(current.recipe.crop, aspect, current.width, current.height);
    commitRecipe(applyPatch(current.recipe, { crop }, "absolute"));
    setCropToolActive(true);
  }

  function replacePhoto(next: Photo, persist = true) {
    photoRef.current = next;
    rendererRef.current?.setRecipe(next.recipe);
    setPhotos((ps) => ps.map((p) => (p.id === next.id ? next : p)));
    if (persist && next.kind !== "sample") void upsertPhoto(next);
  }

  function livePatch(patch: GlobalsPatch) {
    const current = photoRef.current;
    if (!current) return;
    replacePhoto({ ...current, recipe: applyPatch(current.recipe, { globals: patch }, "absolute") }, false);
  }

  function liveMask(mask: Mask) {
    const current = photoRef.current;
    if (!current) return;
    setSelectedMaskId(mask.id);
    replacePhoto(
      { ...current, recipe: applyPatch(current.recipe, { masks: { upsert: [mask] } }, "absolute") },
      false,
    );
  }

  function addMask(mask: Mask) {
    const current = photoRef.current;
    if (!current) return;
    setSelectedMaskId(mask.id);
    commitRecipe(applyPatch(current.recipe, { masks: { upsert: [mask] } }, "absolute"));
  }

  function addRadialMask() {
    addMask(createRadialMask({ params: { exposure: 0.5 } }));
  }

  function addBrushMask() {
    addMask(createBrushMask({ params: { exposure: 0.5 } }));
  }

  function addLuminanceMask() {
    addMask(createLuminanceMask({ params: { exposure: 0.4 } }));
  }

  function addColorMask() {
    addMask(createColorRangeMask({ params: { exposure: 0.4 } }));
  }

  function removeSelectedMask() {
    const current = photoRef.current;
    if (!current || !selectedMaskId) return;
    const next = applyPatch(current.recipe, { masks: { remove: [selectedMaskId] } }, "absolute");
    setSelectedMaskId(next.masks[0]?.id ?? null);
    commitRecipe(next);
  }

  function canvasUv(e: React.PointerEvent<HTMLCanvasElement>): [number, number] | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
  }

  function updateBrushCursor(e: React.PointerEvent<HTMLCanvasElement>) {
    const mask = selectedMask();
    const comp = mask ? primaryComponent(mask) : null;
    if (mod !== "develop" || comp?.type !== "brush") {
      setBrushCursor(null);
      return;
    }
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    const canvasRect = canvas.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const minEdge = Math.min(canvasRect.width, canvasRect.height);
    const d = Math.max(4, (brushToolRef.current.size / 100) * minEdge);
    setBrushCursor({
      x: e.clientX - hostRect.left,
      y: e.clientY - hostRect.top,
      d,
    });
  }

  function selectedMask(): Mask | null {
    const current = photoRef.current;
    if (!current) return null;
    const id = selectedMaskIdRef.current;
    return current.recipe.masks.find((m) => m.id === id) ?? null;
  }

  const committedStrokesRef = useRef<BrushStroke[]>([]);

  function paintBrushLive() {
    const mask = selectedMask();
    if (!mask) return;
    const tool = brushToolRef.current;
    const stroke: BrushStroke = {
      points: [...strokePointsRef.current],
      size: tool.size,
      hardness: tool.hardness,
      opacity: tool.opacity,
      erase: tool.erase,
    };
    const next: Mask = {
      ...mask,
      components: [{ type: "brush", strokes: [...committedStrokesRef.current, stroke] }],
    };
    const current = photoRef.current;
    if (!current) return;
    const recipe = applyPatch(current.recipe, { masks: { upsert: [next] } }, "absolute");
    // Update WebGL immediately so the brush tracks the cursor; defer React state to pointer-up.
    photoRef.current = { ...current, recipe };
    rendererRef.current?.setRecipe(recipe);
  }

  function finishBrushStroke() {
    if (!strokePointsRef.current.length) return;
    const mask = selectedMask();
    if (!mask) return;
    const tool = brushToolRef.current;
    const stroke: BrushStroke = {
      points: [...strokePointsRef.current],
      size: tool.size,
      hardness: tool.hardness,
      opacity: tool.opacity,
      erase: tool.erase,
    };
    committedStrokesRef.current = [...committedStrokesRef.current, stroke];
    const next: Mask = {
      ...mask,
      components: [{ type: "brush", strokes: committedStrokesRef.current }],
    };
    liveMask(next);
    commitHistory();
    strokePointsRef.current = [];
  }

  function onPreviewPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (mod !== "develop" || before) return;
    const mask = selectedMask();
    const comp = mask ? primaryComponent(mask) : null;
    const uv = canvasUv(e);
    updateBrushCursor(e);
    if (!uv || !mask || !comp) return;

    if (comp.type === "brush") {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      paintingRef.current = true;
      committedStrokesRef.current = comp.strokes;
      strokePointsRef.current = [uv];
      paintBrushLive();
      return;
    }

    if (comp.type === "color_range") {
      const sample = rendererRef.current?.sampleSource(uv[0], uv[1]);
      if (!sample) return;
      liveMask({
        ...mask,
        components: [{ ...comp, hue: sample.hue, chroma: sample.chroma }],
      });
      commitHistory();
      return;
    }

    if (comp.type === "luminance_range") {
      const sample = rendererRef.current?.sampleSource(uv[0], uv[1]);
      if (!sample) return;
      const half = Math.max(0.08, (comp.max - comp.min) / 2);
      liveMask({
        ...mask,
        components: [
          {
            ...comp,
            min: Math.max(0, sample.luma - half),
            max: Math.min(1, sample.luma + half),
          },
        ],
      });
      commitHistory();
    }
  }

  function onPreviewPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    updateBrushCursor(e);
    if (!paintingRef.current) return;
    const uv = canvasUv(e);
    if (!uv) return;
    const pts = strokePointsRef.current;
    const last = pts[pts.length - 1];
    if (last && Math.hypot(uv[0] - last[0], uv[1] - last[1]) < 0.003) return;
    strokePointsRef.current.push(uv);
    paintBrushLive();
  }

  function onPreviewPointerUp() {
    if (!paintingRef.current) return;
    paintingRef.current = false;
    finishBrushStroke();
  }

  function onPreviewPointerLeave() {
    if (!paintingRef.current) setBrushCursor(null);
  }

  function commitHistory() {
    const current = photoRef.current;
    if (!current) return;
    const history = pushHistory(current.history, current.recipe);
    replacePhoto({ ...current, history });
  }

  function commitRecipe(nextRecipe: EditRecipe) {
    const current = photoRef.current;
    if (!current) return nextRecipe;
    const history = pushHistory(current.history, nextRecipe);
    replacePhoto({ ...current, recipe: nextRecipe, history });
    return nextRecipe;
  }

  function patchCatalog(patch: CatalogPatch) {
    const current = photoRef.current;
    if (!current) return { rating: 0, flag: "unflagged" as Flag };
    const cat = applyCatalogPatch({ rating: current.rating, flag: current.flag }, patch);
    replacePhoto({ ...current, ...cat });
    return cat;
  }

  function applyNamedPreset(name: string) {
    const preset = presets.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (!preset) return `No preset named "${name}"`;
    commitRecipe(cloneRecipe(preset.recipe));
    return `Applied ${preset.name}`;
  }

  const agentActions: AgentActions = {
    getRecipe: () => photoRef.current?.recipe ?? defaultRecipe(),
    patchDevelop: (patch) => commitRecipe(applyPatch(photoRef.current?.recipe ?? defaultRecipe(), patch, "delta")),
    patchCatalog,
    applyPreset: applyNamedPreset,
    copySettings: () => {
      if (photoRef.current) setClipboard(cloneRecipe(photoRef.current.recipe));
    },
    resetRecipe: () => commitRecipe(defaultRecipe()),
  };

  function doUndo() {
    const current = photoRef.current;
    if (!current) return;
    const history = undo(current.history);
    replacePhoto({ ...current, recipe: history.present, history });
  }

  function doRedo() {
    const current = photoRef.current;
    if (!current) return;
    const history = redo(current.history);
    replacePhoto({ ...current, recipe: history.present, history });
  }

  function selectRelative(delta: number) {
    if (!visible.length) return;
    const i = Math.max(0, visible.findIndex((p) => p.id === selectedId));
    const next = visible[(i + delta + visible.length) % visible.length];
    setSelectedId(next.id);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
        return;
      }
      if (e.key === "\\" || e.key === "]") {
        setBefore((b) => !b);
        return;
      }
      if (e.key >= "0" && e.key <= "5") {
        patchCatalog({ rating: Number(e.key) });
        return;
      }
      if (e.key === "p" || e.key === "P") patchCatalog({ flag: "pick" });
      if (e.key === "x" || e.key === "X") patchCatalog({ flag: "reject" });
      if (e.key === "u" || e.key === "U") patchCatalog({ flag: "unflagged" });
      if (e.key === "ArrowRight") selectRelative(1);
      if (e.key === "ArrowLeft") selectRelative(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, selectedId]);

  async function onImportFolder() {
    if (!isTauri()) {
      fileRef.current?.click();
      return;
    }
    const dir = await pickFolder();
    if (!dir) return;
    setStatus("Scanning…");
    const scanned = await scanFolder(dir);
    const added = await photosFromScanned(photos, scanned);
    setPhotos((ps) => mergePhotos(ps, added));
    if (added[0]) setSelectedId(added[0].id);
    setStatus(added.length ? `Imported ${added.length}` : "No new photos");
  }

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    const added = await photosFromFileList(list);
    setPhotos((ps) => mergePhotos(ps, added));
    if (added[0]) setSelectedId(added[0].id);
    setStatus(added.length ? `Imported ${added.length}` : "No new photos");
  }

  async function onExport() {
    const renderer = rendererRef.current;
    const current = photoRef.current;
    if (!renderer || !current) return;
    try {
      const blob = await renderer.exportJpeg();
      const name = fileName(current.path).replace(/\.[^.]+$/, "") + ".jpg";
      if (isTauri()) {
        const path = await pickSaveJpeg(name);
        if (!path) return;
        await writeFileBytes(path, new Uint8Array(await blob.arrayBuffer()));
        setStatus("Exported");
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Export failed");
    }
  }

  async function onSavePreset() {
    const current = photoRef.current;
    if (!current) return;
    const name = window.prompt("Preset name");
    if (!name?.trim()) return;
    const preset: Preset = { id: crypto.randomUUID(), name: name.trim(), recipe: cloneRecipe(current.recipe) };
    await savePresetRow(preset);
    setPresets((ps) => [...ps.filter((p) => p.id !== preset.id), preset]);
  }

  function pasteSettings() {
    if (!clipboard) return;
    commitRecipe(cloneRecipe(clipboard));
  }

  async function onAgent(text: string) {
    const current = photoRef.current;
    if (!current) return;
    setMessages((m) => [...m, { role: "user", text }]);
    setBusy(true);
    try {
      const result = await runAgentTurn({
        instruction: text,
        recipe: current.recipe,
        histogram: rendererRef.current?.histogram() ?? hist,
        exif: current.exif,
        rating: current.rating,
        flag: current.flag,
        presets: presets.map((p) => p.name),
        settings,
        actions: agentActions,
      });
      setMessages((m) => [...m, { role: "assistant", text: result.text, categories: result.categories }]);
    } catch (err) {
      setMessages((m) => [...m, { role: "error", text: err instanceof Error ? err.message : "Agent failed" }]);
    } finally {
      setBusy(false);
    }
  }

  function onSetting(field: "apiKey" | "baseURL" | "model", value: string) {
    const next = { ...settings, [field]: value };
    setSettings(next);
    saveSettings(next);
  }

  const selectedMaskComp = photo
    ? primaryComponent(photo.recipe.masks.find((m) => m.id === selectedMaskId) ?? { id: "", name: "", mode: "add", components: [], invert: false, feather: 50, density: 100, params: {} })
    : null;
  const brushToolActive = mod === "develop" && selectedMaskComp?.type === "brush";
  const navSrc = photo ? photoThumbSrc(photo) : undefined;

  return (
    <div className={`shell${agentOpen ? " with-agent" : ""}`}>
      <header className="modbar">
        <strong className="brand">Field</strong>
        <button type="button" className={mod === "library" ? "on" : ""} onClick={() => setMod("library")}>
          Library
        </button>
        <button type="button" className={mod === "develop" ? "on" : ""} onClick={() => setMod("develop")}>
          Develop
        </button>
        <span className="grow" />
        <button type="button" onClick={onImportFolder}>
          Import
        </button>
        <button type="button" onClick={onExport} disabled={!photo}>
          Export
        </button>
        <button type="button" onClick={() => setBefore((b) => !b)} className={before ? "on" : ""}>
          Before
        </button>
        <button type="button" onClick={() => setView(view === "fit" ? "1:1" : "fit")}>
          {view}
        </button>
        <button type="button" onClick={() => setSolo((s) => (s ? null : "basic"))} className={solo ? "on" : ""}>
          Solo
        </button>
        <button type="button" onClick={doUndo}>
          Undo
        </button>
        <button type="button" onClick={doRedo}>
          Redo
        </button>
        <button type="button" onClick={() => photo && setClipboard(cloneRecipe(photo.recipe))}>
          Copy
        </button>
        <button type="button" onClick={pasteSettings} disabled={!clipboard}>
          Paste
        </button>
        {photo ? <Stars rating={photo.rating} onRate={(n) => patchCatalog({ rating: n })} /> : null}
        <button type="button" className={agentOpen ? "on" : ""} onClick={() => setAgentOpen((v) => !v)}>
          Agent
        </button>
        <span className="status">{status}</span>
      </header>

      <aside className="left">
        <h3>Navigator</h3>
        {navSrc && !photo?.missing ? (
          <img className="nav-img" src={navSrc} alt="" />
        ) : (
          <p className="stub">No preview</p>
        )}
        <h3>Folders</h3>
        <FolderList folders={folders} active={folder} onPick={setFolder} />
        {mod === "develop" ? (
          <>
            <h3>Presets</h3>
            <ul className="folders">
              {presets.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => applyNamedPreset(p.name)}>
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="btn-ghost" onClick={onSavePreset}>
              Save preset
            </button>
          </>
        ) : null}
      </aside>

      <main className="center">
        <div
          ref={hostRef}
          className={`preview-host${view === "1:1" ? " zoom" : ""}${
            mod === "develop" && selectedMaskId ? " mask-interact" : ""
          }${brushToolActive ? " brush-tool" : ""}${cropToolActive ? " crop-tool" : ""}`}
        >
          <div className="preview-stage">
            <canvas
              ref={canvasRef}
              className="preview"
              onPointerDown={onPreviewPointerDown}
              onPointerMove={onPreviewPointerMove}
              onPointerUp={onPreviewPointerUp}
              onPointerCancel={onPreviewPointerUp}
              onPointerEnter={updateBrushCursor}
              onPointerLeave={onPreviewPointerLeave}
            />
            {cropToolActive && previewSize.w > 0 && photo ? (
              <CropOverlay
                crop={photo.recipe.crop}
                width={previewSize.w}
                height={previewSize.h}
                onLive={liveCrop}
                onCommit={commitHistory}
              />
            ) : null}
          </div>
          {brushCursor ? (
            <div
              className={`brush-cursor${brushTool.erase ? " erase" : ""}`}
              style={{
                width: brushCursor.d,
                height: brushCursor.d,
                transform: `translate(${brushCursor.x - brushCursor.d / 2}px, ${brushCursor.y - brushCursor.d / 2}px)`,
              }}
            />
          ) : null}
          {photo?.missing ? <p className="overlay">File missing on disk.</p> : null}
          {photo?.kind === "raw" && !isTauri() ? (
            <p className="overlay">RAW preview requires the Field desktop app.</p>
          ) : null}
        </div>
        {mod === "library" ? (
          <LibraryGrid
            photos={visible}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onOpen={(id) => {
              setSelectedId(id);
              setMod("develop");
            }}
          />
        ) : null}
      </main>

      <aside className="right">
        <HistogramView stats={hist} />
        {photo && mod === "library" ? <MetaList photo={photo} /> : null}
        {photo && mod === "develop" ? (
          <DevelopPanels
            recipe={photo.recipe}
            solo={solo}
            open={open}
            selectedMaskId={selectedMaskId}
            brushTool={brushTool}
            cropToolActive={cropToolActive}
            onToggle={(id, alt) => {
              if (alt) {
                setSolo((s) => (s === id ? null : id));
                return;
              }
              setOpen((o) => ({ ...o, [id]: !(o[id] ?? true) }));
            }}
            onLive={livePatch}
            onLiveCrop={liveCrop}
            onCommit={commitHistory}
            onToggleCropTool={() => setCropToolActive((v) => !v)}
            onCropAspect={onCropAspect}
            onSelectMask={setSelectedMaskId}
            onAddRadialMask={addRadialMask}
            onAddBrushMask={addBrushMask}
            onAddLuminanceMask={addLuminanceMask}
            onAddColorMask={addColorMask}
            onRemoveMask={removeSelectedMask}
            onLiveMask={liveMask}
            onBrushTool={(next) => setBrushTool((t) => ({ ...t, ...next }))}
          />
        ) : null}
      </aside>

      {agentOpen ? (
        <AgentChat
          messages={messages}
          busy={busy}
          hasKey={Boolean(settings.apiKey.trim())}
          onSend={onAgent}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : null}

      <Filmstrip photos={visible} selectedId={selectedId} onSelect={setSelectedId} />

      <input
        ref={fileRef}
        type="file"
        hidden
        multiple
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => onFiles(e.target.files)}
      />
      {settingsOpen ? (
        <SettingsModal
          apiKey={settings.apiKey}
          baseURL={settings.baseURL}
          model={settings.model}
          onChange={onSetting}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}

function defaultSettingsSafe(): AppSettings {
  return loadSettings();
}

function mergePhotos(current: Photo[], added: Photo[]): Photo[] {
  const ids = new Set(current.map((p) => p.id));
  const next = current.filter((p) => p.kind !== "sample" || added.length === 0);
  for (const p of added) {
    if (!ids.has(p.id)) {
      next.push(p);
      ids.add(p.id);
    }
  }
  return next;
}
