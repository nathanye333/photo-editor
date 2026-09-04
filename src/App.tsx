import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runAgentTurn } from "./agent/run";
import type { AgentActions } from "./agent/tools";
import { photosFromFileList, photosFromScanned, loadRawPreview } from "./catalog/import";
import { photoThumbSrc } from "./catalog/media";
import { emptyPhoto, loadPhotos, loadPresets, openCatalog, openCloudCatalog, savePresetRow, upsertPhoto, loadSnapshots, saveSnapshotRow, deleteSnapshotRow, loadCollections, saveCollectionRow, loadCollectionPhotoIds, addPhotoToCollection, removePhotoFromCollection, createVirtualCopy } from "./catalog/store";
import { DEFAULT_LIBRARY_FILTERS, filterPhotos, photoMatchesFilters, sortPhotos, type LibraryFilters, type LibrarySort } from "./catalog/filter";
import { collapseStacks } from "./catalog/stacks";
import { fileName, photoLabel, type Collection, type Photo, type Preset, type RecipeSnapshot } from "./catalog/types";
import { fileExists, fileUrl, isTauri, pickFolder, pickSaveJpeg, scanFolder, writeFileBytes } from "./native";
import { useAuth } from "./auth/AuthContext";
import { AccountChip, SignInScreen } from "./ui/auth";
import { applyAspectPreset, cropZoom, defaultCrop, normalizeCrop } from "./recipe/crop";
import { cloneRecipe, createBrushMask, createColorRangeMask, createLinearMask, createLuminanceMask, createRadialMask, createSemanticMask, defaultRecipe } from "./recipe/defaults";
import { autoTone } from "./recipe/auto";
import { pushHistory, redo, undo } from "./recipe/history";
import { applyCatalogPatch, applyPatch, defaultCatalogFields } from "./recipe/patch";
import type { BrushStroke, CatalogPatch, Crop, CropAspect, CropPatch, EditRecipe, Flag, GlobalsPatch, Mask } from "./recipe/types";
import { primaryComponent } from "./recipe/types";
import { bitmapFromBlob, PreviewRenderer, thumbnailFromBitmap, type HistogramStats, type ViewMode } from "./render/preview";
import { createSampleBitmap } from "./render/sampleImage";
import { loadSettings, saveSettings, type AppSettings } from "./settings";
import { AgentChat, SettingsModal, type ChatMsg } from "./ui/agentChat";
import { analyzeScene, summarizeScene } from "./agent/scene";
import { segmentImage, type SemanticLabel } from "./ml/segment";
import { HistogramView, Stars } from "./ui/controls";
import { CropOverlay } from "./ui/crop";
import { DevelopPanels } from "./ui/develop";
import { Filmstrip, FolderList, LibraryGrid, MetaList, CollectionsList, SnapshotsList, LibraryToolbar, CompareView, LoupeView, SurveyView, nextLoupeZoom, type LibraryView, type LoupeZoom } from "./ui/library";
import { MapView } from "./ui/map";
import type { BrushToolSettings } from "./ui/masks";
import { MaskOverlay } from "./ui/maskOverlay";
import "./App.css";

type Module = "library" | "develop" | "map";

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
  const auth = useAuth();
  const desktop = isTauri();
  const [mod, setMod] = useState<Module>("develop");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [collectionMembers, setCollectionMembers] = useState<Record<string, string[]>>({});
  const [presets, setPresets] = useState<Preset[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [snapshots, setSnapshots] = useState<RecipeSnapshot[]>([]);
  const [clipboard, setClipboard] = useState<EditRecipe | null>(null);
  const [view, setView] = useState<ViewMode>("fit");
  const [before, setBefore] = useState(false);
  const [solo, setSolo] = useState<string | null>(null);
  const [catalogReady, setCatalogReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
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
  const [draftCrop, setDraftCrop] = useState<Crop | null>(null);
  /** Crop the view is zoomed to; only updated on commit so drags never reframe. */
  const [cropFrame, setCropFrame] = useState<Crop | null>(null);
  const draftCropRef = useRef<Crop | null>(null);
  const [previewSize, setPreviewSize] = useState({ w: 0, h: 0 });
  const [hostSize, setHostSize] = useState({ w: 0, h: 0 });
  const [brushCursor, setBrushCursor] = useState<{ x: number; y: number; d: number } | null>(null);
  const [hist, setHist] = useState<HistogramStats | null>(null);
  const [agentOpen, setAgentOpen] = useState(true);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(defaultSettingsSafe);
  const [status, setStatus] = useState("");
  const [libraryView, setLibraryView] = useState<LibraryView>("grid");
  const [loupeZoom, setLoupeZoom] = useState<LoupeZoom>("fit");
  const [librarySort, setLibrarySort] = useState<LibrarySort>("filename");
  const [libraryFilters, setLibraryFilters] = useState<LibraryFilters>(DEFAULT_LIBRARY_FILTERS);
  const [quickFilterActive, setQuickFilterActive] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [compareSide, setCompareSide] = useState<"left" | "right">("left");
  const [expandedStacks, setExpandedStacks] = useState<Set<string>>(() => new Set());
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
    let list = photos;
    if (folder) list = list.filter((p) => p.folder === folder);
    if (collectionId) {
      const col = collections.find((c) => c.id === collectionId);
      if (col?.kind === "smart" && col.rules) {
        list = list.filter((p) => photoMatchesFilters(p, col.rules!));
      } else {
        const ids = new Set(collectionMembers[collectionId] ?? []);
        list = list.filter((p) => ids.has(p.id));
      }
    }
    if (quickFilterActive) list = list.filter((p) => p.quickCollection);
    list = filterPhotos(list, libraryFilters);
    return sortPhotos(list, librarySort);
  }, [photos, folder, collectionId, collectionMembers, collections, quickFilterActive, libraryFilters, librarySort]);
  const gridPhotos = useMemo(
    () => collapseStacks(visible, expandedStacks),
    [visible, expandedStacks],
  );
  const quickCount = useMemo(() => photos.filter((p) => p.quickCollection).length, [photos]);
  const folders = useMemo(() => [...new Set(photos.map((p) => p.folder))].sort(), [photos]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!desktop) {
        if (auth.loading) return;
        if (!auth.user) {
          setCatalogReady(false);
          setPhotos([]);
          setSelectedId(null);
          return;
        }
        try {
          const { migrated } = await openCloudCatalog();
          if (cancelled) return;
          const rows = await loadPhotos();
          if (cancelled) return;
          const list = rows.length ? rows : [samplePhoto()];
          setPhotos(list);
          setSelectedId(list[0].id);
          setPresets(await loadPresets());
          const cols = await loadCollections();
          setCollections(cols);
          const members: Record<string, string[]> = {};
          for (const c of cols) {
            members[c.id] = await loadCollectionPhotoIds(c.id);
          }
          setCollectionMembers(members);
          setCatalogReady(true);
          if (migrated > 0) {
            setStatus(`Migrated ${migrated} photo${migrated === 1 ? "" : "s"} from browser storage`);
          }
        } catch (err) {
          if (!cancelled) {
            setAuthError(err instanceof Error ? err.message : "Failed to load cloud catalog");
            setCatalogReady(false);
          }
        }
        return;
      }

      await openCatalog();
      const rows = await loadPhotos();
      const marked = await Promise.all(
        rows.map(async (p) => (p.kind === "sample" ? p : { ...p, missing: !(await fileExists(p.path)) })),
      );
      if (cancelled) return;
      const list = marked.length ? marked : [samplePhoto()];
      setPhotos(list);
      setSelectedId(list[0].id);
      setPresets(await loadPresets());
      const cols = await loadCollections();
      setCollections(cols);
      const members: Record<string, string[]> = {};
      for (const c of cols) {
        members[c.id] = await loadCollectionPhotoIds(c.id);
      }
      setCollectionMembers(members);
      setCatalogReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [desktop, auth.loading, auth.user?.id]);

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

  function recipeForPreview(recipe: EditRecipe): EditRecipe {
    if (!cropToolActive) return recipe;
    const crop = draftCrop ?? recipe.crop;
    return { ...recipe, crop: { ...crop, enabled: false } };
  }

  useEffect(() => {
    rendererRef.current?.setRecipe(recipeForPreview(photo?.recipe ?? defaultRecipe()));
  }, [photo?.recipe, cropToolActive, draftCrop]);

  useEffect(() => {
    setSelectedMaskId(photo?.recipe.masks[0]?.id ?? null);
    setCropToolActive(false);
    setDraftCrop(null);
    setCropFrame(null);
    draftCropRef.current = null;
    if (!photo?.id) {
      setSnapshots([]);
      return;
    }
    let cancelled = false;
    loadSnapshots(photo.id).then((rows) => {
      if (!cancelled) setSnapshots(rows);
    });
    return () => {
      cancelled = true;
    };
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
          const canvas = canvasRef.current;
          const host = hostRef.current;
          if (host) {
            const next = { w: host.clientWidth, h: host.clientHeight };
            setHostSize((prev) => (prev.w === next.w && prev.h === next.h ? prev : next));
          }
          if (canvas) {
            const size = { w: canvas.width, h: canvas.height };
            setPreviewSize((prev) => (prev.w === size.w && prev.h === size.h ? prev : size));
          }
          return;
        }
        if (photo.blobUrl) {
          const blob = await fetch(photo.blobUrl).then((r) => r.blob());
          const bmp = await bitmapFromBlob(blob);
          if (!cancelled) {
            renderer.setImage(bmp);
            const canvas = canvasRef.current;
            const host = hostRef.current;
            if (host) {
              const next = { w: host.clientWidth, h: host.clientHeight };
              setHostSize((prev) => (prev.w === next.w && prev.h === next.h ? prev : next));
            }
            if (canvas) {
              const size = { w: canvas.width, h: canvas.height };
              setPreviewSize((prev) => (prev.w === size.w && prev.h === size.h ? prev : size));
            }
          }
          return;
        }
        if (photo.thumbDataUrl) {
          const blob = await fetch(photo.thumbDataUrl).then((r) => r.blob());
          const bmp = await bitmapFromBlob(blob);
          if (!cancelled) {
            renderer.setImage(bmp);
            const canvas = canvasRef.current;
            const host = hostRef.current;
            if (host) {
              const next = { w: host.clientWidth, h: host.clientHeight };
              setHostSize((prev) => (prev.w === next.w && prev.h === next.h ? prev : next));
            }
            if (canvas) {
              const size = { w: canvas.width, h: canvas.height };
              setPreviewSize((prev) => (prev.w === size.w && prev.h === size.h ? prev : size));
            }
          }
          return;
        }
        if (photo.kind === "raw" && isTauri()) {
          const raw = await loadRawPreview(photo.path);
          if (cancelled) {
            raw.bitmap.close();
            return;
          }
          renderer.setImage(raw.bitmap);
          const canvas = canvasRef.current;
          const host = hostRef.current;
          if (host) {
            const next = { w: host.clientWidth, h: host.clientHeight };
            setHostSize((prev) => (prev.w === next.w && prev.h === next.h ? prev : next));
          }
          if (canvas) {
            const size = { w: canvas.width, h: canvas.height };
            setPreviewSize((prev) => (prev.w === size.w && prev.h === size.h ? prev : size));
          }
          return;
        }
        if (isTauri()) {
          const blob = await fetch(fileUrl(photo.path)).then((r) => r.blob());
          const bmp = await bitmapFromBlob(blob);
          if (!cancelled) {
            renderer.setImage(bmp);
            const canvas = canvasRef.current;
            const host = hostRef.current;
            if (host) {
              const next = { w: host.clientWidth, h: host.clientHeight };
              setHostSize((prev) => (prev.w === next.w && prev.h === next.h ? prev : next));
            }
            if (canvas) {
              const size = { w: canvas.width, h: canvas.height };
              setPreviewSize((prev) => (prev.w === size.w && prev.h === size.h ? prev : size));
            }
          }
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
    renderer.layout(view, host.clientWidth, host.clientHeight, cropToolActive);
    const next = { w: host.clientWidth, h: host.clientHeight };
    setHostSize((prev) => (prev.w === next.w && prev.h === next.h ? prev : next));
    if (canvas) {
      const size = { w: canvas.width, h: canvas.height };
      setPreviewSize((prev) => (prev.w === size.w && prev.h === size.h ? prev : size));
    }
  }, [view, cropToolActive]);

  useEffect(() => {
    layoutPreview();
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(layoutPreview);
    ro.observe(host);
    return () => ro.disconnect();
  }, [layoutPreview, photo?.id, cropToolActive]);

  function setDraft(crop: Crop) {
    draftCropRef.current = crop;
    setDraftCrop(crop);
  }

  function patchDraftCrop(patch: CropPatch) {
    const base = draftCropRef.current ?? photoRef.current?.recipe.crop ?? defaultCrop();
    setDraft(normalizeCrop({ ...base, ...patch }));
  }

  /** Apply the drafted crop to the recipe and reframe the view onto it. */
  function commitDraftCrop() {
    const current = photoRef.current;
    const draft = draftCropRef.current;
    if (!current || !draft) return;
    const crop = normalizeCrop({ ...draft, enabled: true });
    setDraft(crop);
    setCropFrame(crop);
    commitRecipe(applyPatch(current.recipe, { crop }, "absolute"));
  }

  function liveCrop(patch: CropPatch) {
    const current = photoRef.current;
    if (!current) return;
    replacePhoto({ ...current, recipe: applyPatch(current.recipe, { crop: patch }, "absolute") }, false);
  }

  function onCropAspect(aspect: CropAspect) {
    const current = photoRef.current;
    if (!current?.width || !current.height) return;
    const base = draftCropRef.current ?? current.recipe.crop;
    const crop = applyAspectPreset(base, aspect, current.width, current.height);
    setDraft(crop);
    setCropFrame(crop);
    commitRecipe(applyPatch(current.recipe, { crop }, "absolute"));
    setCropToolActive(true);
  }

  function onResetCrop() {
    const current = photoRef.current;
    if (!current) return;
    const crop = defaultCrop();
    setDraft(crop);
    setCropFrame(crop);
    commitRecipe(applyPatch(current.recipe, { crop }, "absolute"));
  }

  function openCropTool() {
    const crop = photoRef.current?.recipe.crop ?? defaultCrop();
    setDraft(crop);
    setCropFrame(crop);
    setCropToolActive(true);
  }

  function closeCropTool() {
    commitDraftCrop();
    setCropToolActive(false);
  }

  function toggleCropTool() {
    if (cropToolActive) closeCropTool();
    else openCropTool();
  }

  /** Zoom/pan so the committed crop fills the viewport, Lightroom-style. */
  const cropView = useMemo(() => {
    if (!cropToolActive || !cropFrame || !previewSize.w || !hostSize.w) {
      return { scale: 1, transform: "none" };
    }
    const { scale, dx, dy } = cropZoom(cropFrame, previewSize.w, previewSize.h, hostSize.w, hostSize.h);
    return { scale, transform: `scale(${scale}) translate(${dx}px, ${dy}px)` };
  }, [cropToolActive, cropFrame, previewSize, hostSize]);

  function replacePhoto(next: Photo, persist = true) {
    photoRef.current = next;
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

  function addLinearMask() {
    addMask(createLinearMask({ params: { exposure: 0.5 } }));
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

  async function addSemanticMask(label: SemanticLabel) {
    const pixels = rendererRef.current?.sourceImageData();
    if (!pixels) {
      setStatus("No image loaded");
      return;
    }
    setStatus(`Segmenting ${label}…`);
    try {
      const seg = await segmentImage(pixels, label);
      const mask = createSemanticMask({
        label,
        model: seg.model,
        width: seg.width,
        height: seg.height,
        alpha: seg.alpha,
        params: label === "sky" ? { exposure: -0.25, highlights: -20 } : { exposure: 0.35, shadows: 15 },
      });
      addMask(mask);
      setStatus(`${label} mask ready (${seg.model})`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Segmentation failed");
    }
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
    rendererRef.current?.setRecipe(recipeForPreview(recipe));
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
    if (!current) return defaultCatalogFields();
    const cat = applyCatalogPatch(current, patch);
    replacePhoto({ ...current, ...cat });
    return cat;
  }

  function patchPhotoMeta(
    patch: Partial<
      Pick<
        Photo,
        "title" | "caption" | "copyright" | "creator" | "keywords" | "colorLabel" | "latitude" | "longitude"
      >
    >,
  ) {
    const current = photoRef.current;
    if (!current) return;
    const catalogKeys = ["title", "caption", "copyright", "creator", "keywords", "colorLabel"] as const;
    const catalogPatch: CatalogPatch = {};
    for (const key of catalogKeys) {
      if (key in patch) catalogPatch[key] = patch[key] as never;
    }
    const cat = Object.keys(catalogPatch).length ? applyCatalogPatch(current, catalogPatch) : current;
    let next: Photo = { ...current, ...cat };
    if ("latitude" in patch || "longitude" in patch) {
      const lat = "latitude" in patch ? patch.latitude : current.latitude;
      const lng = "longitude" in patch ? patch.longitude : current.longitude;
      const validLat = lat != null && Number.isFinite(lat) ? lat : undefined;
      const validLng = lng != null && Number.isFinite(lng) ? lng : undefined;
      next = {
        ...next,
        latitude: validLat,
        longitude: validLng,
        exif: { ...next.exif },
      };
      if (validLat != null) next.exif.GPSLatitude = String(validLat);
      else delete next.exif.GPSLatitude;
      if (validLng != null) next.exif.GPSLongitude = String(validLng);
      else delete next.exif.GPSLongitude;
    }
    replacePhoto(next);
  }

  function cullFlag(flag: Flag) {
    patchCatalog({ flag });
    if (autoAdvance && mod === "library" && libraryView !== "grid") {
      selectRelative(1);
    }
  }

  function toggleQuickCollection() {
    const current = photoRef.current;
    if (!current) return;
    patchCatalog({ quickCollection: !current.quickCollection });
    setStatus(current.quickCollection ? "Removed from Quick Collection" : "Added to Quick Collection");
  }

  function applyNamedPreset(name: string) {
    const preset = presets.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (!preset) return `No preset named "${name}"`;
    commitRecipe(cloneRecipe(preset.recipe));
    return `Applied ${preset.name}`;
  }

  function applyAutoTone(): string {
    const stats = rendererRef.current?.sourceStats();
    if (!stats) return "No image loaded";
    const patch = autoTone(stats);
    commitRecipe(applyPatch(photoRef.current?.recipe ?? defaultRecipe(), { globals: patch }, "absolute"));
    return `Auto tone: exposure ${patch.exposure} EV, contrast ${patch.contrast}`;
  }

  const agentActions: AgentActions = {
    getRecipe: () => photoRef.current?.recipe ?? defaultRecipe(),
    autoTone: applyAutoTone,
    patchDevelop: (patch, mode = "delta") =>
      commitRecipe(applyPatch(photoRef.current?.recipe ?? defaultRecipe(), patch, mode)),
    patchCatalog,
    applyPreset: applyNamedPreset,
    copySettings: () => {
      if (photoRef.current) setClipboard(cloneRecipe(photoRef.current.recipe));
    },
    resetRecipe: () => commitRecipe(defaultRecipe()),
    analyzeScene: () => {
      const pixels = rendererRef.current?.sourceImageData();
      return pixels ? analyzeScene(pixels) : null;
    },
    sampleAt: (x, y) => rendererRef.current?.sampleSource(x, y) ?? null,
    createSemanticMask: async (label, params) => {
      const pixels = rendererRef.current?.sourceImageData();
      if (!pixels) return { ok: false, error: "No image loaded" };
      try {
        const seg = await segmentImage(pixels, label);
        const mask = createSemanticMask({
          label,
          model: seg.model,
          width: seg.width,
          height: seg.height,
          alpha: seg.alpha,
          params: params ?? (label === "sky" ? { exposure: -0.25, highlights: -20 } : { exposure: 0.35 }),
        });
        const recipe = commitRecipe(
          applyPatch(photoRef.current?.recipe ?? defaultRecipe(), { masks: { upsert: [mask] } }, "absolute"),
        );
        setSelectedMaskId(mask.id);
        return {
          ok: true,
          maskId: mask.id,
          masks: recipe.masks.map((m) => {
            const component = primaryComponent(m);
            const safeComponent =
              component?.type === "semantic"
                ? {
                    type: "semantic" as const,
                    label: component.label,
                    model: component.model,
                    width: component.width,
                    height: component.height,
                    hasCoverage: Boolean(component.alpha?.length),
                  }
                : component;
            return {
              id: m.id,
              name: m.name,
              kind: component?.type ?? "unknown",
              invert: m.invert,
              density: m.density,
              params: m.params,
              component: safeComponent,
            };
          }),
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Segmentation failed" };
      }
    },
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

  const cropKeys = useRef({ active: cropToolActive, toggle: toggleCropTool, close: closeCropTool });
  cropKeys.current = { active: cropToolActive, toggle: toggleCropTool, close: closeCropTool };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      if (e.key === "r" || e.key === "R") {
        if (mod === "develop") cropKeys.current.toggle();
        return;
      }
      if (cropKeys.current.active && (e.key === "Enter" || e.key === "Escape")) {
        cropKeys.current.close();
        return;
      }
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
      if (mod === "library") {
        if (e.key === "g" || e.key === "G") {
          setLibraryView("grid");
          return;
        }
        if (e.key === "c" || e.key === "C") {
          setLibraryView("compare");
          return;
        }
        if (e.key === "e" || e.key === "E") {
          setLibraryView("loupe");
          return;
        }
        if (e.key === "n" || e.key === "N") {
          setLibraryView("survey");
          return;
        }
        if ((e.key === "z" || e.key === "Z") && libraryView === "loupe") {
          setLoupeZoom((z) => nextLoupeZoom(z));
          return;
        }
        if (e.key === "Enter" && photoRef.current) {
          setMod("develop");
          return;
        }
        const colorKeys: Record<string, NonNullable<CatalogPatch["colorLabel"]>> = {
          "6": "red",
          "7": "yellow",
          "8": "green",
          "9": "blue",
          "-": "purple",
        };
        if (colorKeys[e.key]) {
          const current = photoRef.current;
          if (current) {
            patchCatalog({ colorLabel: current.colorLabel === colorKeys[e.key] ? null : colorKeys[e.key] });
          }
          return;
        }
      }
      if (e.key >= "0" && e.key <= "5") {
        patchCatalog({ rating: Number(e.key) });
        if (autoAdvance && mod === "library" && libraryView !== "grid" && e.key !== "0") {
          selectRelative(1);
        }
        return;
      }
      if (e.key === "p" || e.key === "P") cullFlag("pick");
      if (e.key === "x" || e.key === "X") cullFlag("reject");
      if (e.key === "u" || e.key === "U") cullFlag("unflagged");
      if (e.key === "b" || e.key === "B") toggleQuickCollection();
      if (e.key === "ArrowRight") selectRelative(1);
      if (e.key === "ArrowLeft") selectRelative(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, selectedId, mod, libraryView, autoAdvance]);

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
    const added = await photosFromFileList(photos, list);
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

  async function onSaveSnapshot() {
    const current = photoRef.current;
    if (!current) return;
    const name = window.prompt("Snapshot name");
    if (!name?.trim()) return;
    const snapshot: RecipeSnapshot = {
      id: crypto.randomUUID(),
      photoId: current.id,
      name: name.trim(),
      recipe: cloneRecipe(current.recipe),
      createdAt: Date.now(),
    };
    await saveSnapshotRow(snapshot);
    setSnapshots((rows) => [...rows.filter((s) => s.id !== snapshot.id), snapshot].sort((a, b) => a.createdAt - b.createdAt));
    setStatus(`Saved snapshot "${snapshot.name}"`);
  }

  function onApplySnapshot(id: string) {
    const snap = snapshots.find((s) => s.id === id);
    if (!snap) return;
    commitRecipe(cloneRecipe(snap.recipe));
    setStatus(`Applied snapshot "${snap.name}"`);
  }

  async function onDeleteSnapshot(id: string) {
    await deleteSnapshotRow(id);
    setSnapshots((rows) => rows.filter((s) => s.id !== id));
  }

  async function onCreateCollection() {
    const name = window.prompt("Collection name");
    if (!name?.trim()) return;
    const collection: Collection = { id: crypto.randomUUID(), name: name.trim(), kind: "manual" };
    await saveCollectionRow(collection);
    setCollections((cols) => [...cols, collection].sort((a, b) => a.name.localeCompare(b.name)));
    setCollectionMembers((m) => ({ ...m, [collection.id]: [] }));
    setCollectionId(collection.id);
    setFolder(null);
  }

  async function onCreateSmartCollection() {
    const name = window.prompt("Smart collection name (uses current library filters as rules)");
    if (!name?.trim()) return;
    const collection: Collection = {
      id: crypto.randomUUID(),
      name: name.trim(),
      kind: "smart",
      rules: { ...libraryFilters },
    };
    await saveCollectionRow(collection);
    setCollections((cols) => [...cols, collection].sort((a, b) => a.name.localeCompare(b.name)));
    setCollectionId(collection.id);
    setFolder(null);
    setQuickFilterActive(false);
    setStatus(`Smart collection "${collection.name}" created from current filters`);
  }

  function toggleStack(stackId: string) {
    setExpandedStacks((prev) => {
      const next = new Set(prev);
      if (next.has(stackId)) next.delete(stackId);
      else next.add(stackId);
      return next;
    });
  }

  async function onAddPhotoToCollection() {
    const current = photoRef.current;
    if (!current || !collectionId) return;
    await addPhotoToCollection(collectionId, current.id);
    setCollectionMembers((m) => ({
      ...m,
      [collectionId]: [...new Set([...(m[collectionId] ?? []), current.id])],
    }));
    setStatus(`Added to ${collections.find((c) => c.id === collectionId)?.name ?? "collection"}`);
  }

  async function onRemovePhotoFromCollection() {
    const current = photoRef.current;
    if (!current || !collectionId) return;
    await removePhotoFromCollection(collectionId, current.id);
    setCollectionMembers((m) => ({
      ...m,
      [collectionId]: (m[collectionId] ?? []).filter((id) => id !== current.id),
    }));
  }

  async function onCreateVirtualCopy() {
    const current = photoRef.current;
    if (!current || current.kind === "sample") return;
    const copy = createVirtualCopy(current, photos);
    await upsertPhoto(copy);
    setPhotos((ps) => [...ps, copy]);
    setSelectedId(copy.id);
    setStatus(`Created ${photoLabel(copy)}`);
  }

  function pasteSettings() {
    if (!clipboard) return;
    commitRecipe(cloneRecipe(clipboard));
  }

  async function onAgent(text: string) {
    const current = photoRef.current;
    if (!current) return;
    setMessages((m) => [
      ...m,
      { role: "user", text },
      { role: "assistant", text: "", status: "streaming", steps: [] },
    ]);
    setBusy(true);
    try {
      const pixels = rendererRef.current?.sourceImageData();
      const sceneSummary = pixels ? summarizeScene(analyzeScene(pixels)) : null;

      let previewImage: Uint8Array | null = null;
      if (settings.sendPreview) {
        try {
          const blob = await rendererRef.current?.visionThumbnail(settings.visionMaxEdge);
          if (blob) previewImage = new Uint8Array(await blob.arrayBuffer());
        } catch {
          previewImage = null;
        }
      }

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
        sceneSummary,
        previewImage,
        onTrace: (steps) => {
          setMessages((msgs) => {
            const next = msgs.slice();
            const last = next[next.length - 1];
            if (last?.role === "assistant" && last.status === "streaming") {
              next[next.length - 1] = { ...last, steps };
            }
            return next;
          });
        },
      });
      setMessages((m) => {
        const next = m.slice();
        const last = next[next.length - 1];
        if (last?.role === "assistant") {
          next[next.length - 1] = {
            role: "assistant",
            text: result.text,
            categories: result.categories,
            steps: result.steps,
            status: "done",
            previewSent: result.previewSent,
          };
        } else {
          next.push({
            role: "assistant",
            text: result.text,
            categories: result.categories,
            steps: result.steps,
            status: "done",
            previewSent: result.previewSent,
          });
        }
        return next;
      });
    } catch (err) {
      setMessages((m) => {
        const next = m.slice();
        const last = next[next.length - 1];
        const message = err instanceof Error ? err.message : "Agent failed";
        if (last?.role === "assistant" && last.status === "streaming") {
          next[next.length - 1] = { role: "error", text: message, status: "error", steps: last.steps };
        } else {
          next.push({ role: "error", text: message, status: "error" });
        }
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  function onSetting(
    field: "apiKey" | "baseURL" | "model" | "sendPreview" | "visionMaxEdge",
    value: string | boolean | number,
  ) {
    const next = { ...settings, [field]: value } as AppSettings;
    setSettings(next);
    saveSettings(next);
  }

  const selectedMaskComp = photo
    ? primaryComponent(photo.recipe.masks.find((m) => m.id === selectedMaskId) ?? { id: "", name: "", mode: "add", components: [], invert: false, feather: 50, density: 100, params: {} })
    : null;
  const brushToolActive = mod === "develop" && selectedMaskComp?.type === "brush";
  const maskOverlayTarget =
    mod === "develop" &&
    !before &&
    !cropToolActive &&
    photo &&
    selectedMaskId &&
    (selectedMaskComp?.type === "radial" || selectedMaskComp?.type === "linear")
      ? { mask: photo.recipe.masks.find((m) => m.id === selectedMaskId)!, comp: selectedMaskComp }
      : null;
  const navSrc = photo ? photoThumbSrc(photo) : undefined;

  if (!desktop) {
    if (auth.loading) {
      return <div className="auth-screen"><p className="auth-lede">Loading session…</p></div>;
    }
    if (!auth.user) {
      return (
        <SignInScreen
          configured={auth.configured}
          busy={authBusy}
          error={authError}
          onSignIn={async (provider) => {
            setAuthBusy(true);
            setAuthError(null);
            try {
              await auth.signInWithOAuth(provider);
            } catch (err) {
              setAuthError(err instanceof Error ? err.message : "Sign-in failed");
              setAuthBusy(false);
            }
          }}
        />
      );
    }
    if (!catalogReady) {
      return (
        <div className="auth-screen">
          <p className="auth-lede">{authError ?? "Loading your catalog…"}</p>
        </div>
      );
    }
  }

  return (
    <div className={`shell${agentOpen ? " with-agent" : ""}`}>
      <header className="modbar">
        <strong className="brand">Field</strong>
        <button type="button" className={mod === "library" ? "on" : ""} onClick={() => setMod("library")}>
          Library
        </button>
        <button type="button" className={mod === "map" ? "on" : ""} onClick={() => setMod("map")}>
          Map
        </button>
        <button type="button" className={mod === "develop" ? "on" : ""} onClick={() => setMod("develop")}>
          Develop
        </button>
        <span className="grow" />
        {!desktop && auth.user ? (
          <AccountChip
            email={auth.user.email}
            onSignOut={() => {
              void auth.signOut();
            }}
          />
        ) : null}
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
        <button type="button" onClick={toggleQuickCollection} disabled={!photo || photo.kind === "sample"}>
          Quick
        </button>
        <button type="button" onClick={onCreateVirtualCopy} disabled={!photo || photo.kind === "sample"}>
          Virtual copy
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
        <FolderList
          folders={folders}
          active={folder}
          onPick={(f) => {
            setFolder(f);
            setCollectionId(null);
          }}
        />
        <h3>Collections</h3>
        <CollectionsList
          collections={collections}
          active={collectionId}
          quickCount={quickCount}
          quickActive={quickFilterActive}
          onPick={(id) => {
            setCollectionId(id);
            setQuickFilterActive(false);
            if (id) setFolder(null);
          }}
          onQuick={() => {
            setQuickFilterActive((v) => !v);
            setCollectionId(null);
            setFolder(null);
          }}
          onCreate={onCreateCollection}
          onCreateSmart={onCreateSmartCollection}
          onAddPhoto={onAddPhotoToCollection}
          onRemovePhoto={onRemovePhotoFromCollection}
          canManagePhoto={!!photo && photo.kind !== "sample"}
        />
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
            <h3>Snapshots</h3>
            <SnapshotsList
              snapshots={snapshots}
              onApply={onApplySnapshot}
              onDelete={onDeleteSnapshot}
              onCreate={onSaveSnapshot}
            />
          </>
        ) : null}
      </aside>

      <main className={`center${mod === "library" || mod === "map" ? " library-mode" : ""}`}>
        <div
          ref={hostRef}
          className={`preview-host${view === "1:1" ? " zoom" : ""}${
            mod === "develop" && selectedMaskId ? " mask-interact" : ""
          }${brushToolActive ? " brush-tool" : ""}${cropToolActive ? " crop-tool" : ""}`}
        >
          <div
            className={`preview-stage${cropToolActive ? " cropping" : ""}`}
            style={{ transform: cropView.transform }}
          >
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
                crop={draftCrop ?? photo.recipe.crop}
                width={previewSize.w}
                height={previewSize.h}
                scale={cropView.scale}
                onLive={patchDraftCrop}
                onCommit={commitDraftCrop}
              />
            ) : null}
            {maskOverlayTarget && previewSize.w > 0 ? (
              <MaskOverlay
                component={maskOverlayTarget.comp}
                width={previewSize.w}
                height={previewSize.h}
                scale={cropView.scale}
                onLive={(next) =>
                  liveMask({
                    ...maskOverlayTarget.mask,
                    components: [next, ...maskOverlayTarget.mask.components.slice(1)],
                  })
                }
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
          <div className="library-shell">
            <LibraryToolbar
              photos={photos}
              filters={libraryFilters}
              sort={librarySort}
              libraryView={libraryView}
              autoAdvance={autoAdvance}
              onFilters={setLibraryFilters}
              onSort={setLibrarySort}
              onView={setLibraryView}
              onAutoAdvance={setAutoAdvance}
            />
            {libraryView === "grid" ? (
              <LibraryGrid
                photos={gridPhotos}
                allPhotos={photos}
                selectedId={selectedId}
                expandedStacks={expandedStacks}
                onSelect={setSelectedId}
                onOpen={(id) => {
                  setSelectedId(id);
                  setMod("develop");
                }}
                onToggleStack={toggleStack}
              />
            ) : null}
            {libraryView === "compare" ? (
              <CompareView
                photos={visible}
                selectedId={selectedId}
                activeSide={compareSide}
                onSelectSide={setCompareSide}
                onSelectPhoto={setSelectedId}
              />
            ) : null}
            {libraryView === "loupe" ? (
              <LoupeView
                photo={photo}
                zoom={loupeZoom}
                onZoom={setLoupeZoom}
                onOpen={() => setMod("develop")}
              />
            ) : null}
            {libraryView === "survey" ? (
              <SurveyView
                photos={visible}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onOpen={(id) => {
                  setSelectedId(id);
                  setMod("develop");
                }}
              />
            ) : null}
          </div>
        ) : null}
        {mod === "map" ? (
          <div className="library-shell">
            <MapView
              photos={visible}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onOpen={(id) => {
                setSelectedId(id);
                setMod("develop");
              }}
            />
          </div>
        ) : null}
      </main>

      <aside className="right">
        <HistogramView stats={hist} />
        {photo && mod === "library" ? (
          <MetaList
            photo={photo}
            onPatch={(patch) => patchPhotoMeta(patch)}
          />
        ) : null}
        {photo && mod === "develop" ? (
          <DevelopPanels
            recipe={photo.recipe}
            crop={draftCrop ?? photo.recipe.crop}
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
            onLiveCrop={cropToolActive ? patchDraftCrop : liveCrop}
            onCommit={commitHistory}
            onCommitCrop={cropToolActive ? commitDraftCrop : commitHistory}
            onToggleCropTool={toggleCropTool}
            onCropAspect={onCropAspect}
            onResetCrop={onResetCrop}
            onSelectMask={setSelectedMaskId}
            onAddRadialMask={addRadialMask}
            onAddLinearMask={addLinearMask}
            onAddBrushMask={addBrushMask}
            onAddLuminanceMask={addLuminanceMask}
            onAddColorMask={addColorMask}
            onAddSubjectMask={() => void addSemanticMask("subject")}
            onAddSkyMask={() => void addSemanticMask("sky")}
            onRemoveMask={removeSelectedMask}
            onLiveMask={liveMask}
            onBrushTool={(next) => setBrushTool((t) => ({ ...t, ...next }))}
            onAutoTone={() => setStatus(applyAutoTone())}
          />
        ) : null}
      </aside>

      {agentOpen ? (
        <AgentChat
          messages={messages}
          busy={busy}
          hasKey={Boolean(settings.apiKey.trim())}
          sendPreview={settings.sendPreview}
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
          sendPreview={settings.sendPreview}
          visionMaxEdge={settings.visionMaxEdge}
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
  const byId = new Map(current.filter((p) => p.kind !== "sample" || added.length === 0).map((p) => [p.id, p]));
  for (const p of added) byId.set(p.id, p);
  return [...byId.values()];
}
