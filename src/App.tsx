import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runAgentTurn } from "./agent/run";
import type { AgentActions } from "./agent/tools";
import { photosFromFileList, photosFromScanned } from "./catalog/import";
import { photoThumbSrc } from "./catalog/media";
import { emptyPhoto, loadPhotos, loadPresets, openCatalog, savePresetRow, upsertPhoto } from "./catalog/store";
import { fileName, type Photo, type Preset } from "./catalog/types";
import { fileExists, fileUrl, isTauri, pickFolder, pickSaveJpeg, scanFolder, writeFileBytes } from "./native";
import { cloneRecipe, defaultRecipe } from "./recipe/defaults";
import { pushHistory, redo, undo } from "./recipe/history";
import { applyCatalogPatch, applyPatch } from "./recipe/patch";
import type { CatalogPatch, EditRecipe, Flag, GlobalsPatch } from "./recipe/types";
import { bitmapFromBlob, PreviewRenderer, thumbnailFromBitmap, type HistogramStats, type ViewMode } from "./render/preview";
import { createSampleBitmap } from "./render/sampleImage";
import { loadSettings, saveSettings, type AppSettings } from "./settings";
import { AgentChat, SettingsModal, type ChatMsg } from "./ui/agentChat";
import { HistogramView, Stars } from "./ui/controls";
import { DevelopPanels } from "./ui/develop";
import { Filmstrip, FolderList, LibraryGrid, MetaList } from "./ui/library";
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
  });
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
    rendererRef.current?.setRecipe(photo?.recipe ?? defaultRecipe());
  }, [photo?.recipe]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    let cancelled = false;
    (async () => {
      if (!photo || photo.missing || photo.kind === "raw") {
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
    if (!host || !renderer) return;
    renderer.layout(view, host.clientWidth, host.clientHeight);
  }, [view]);

  useEffect(() => {
    layoutPreview();
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(layoutPreview);
    ro.observe(host);
    return () => ro.disconnect();
  }, [layoutPreview, photo?.id]);

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
    commitRecipe(applyPatch(defaultRecipe(), { globals: preset.recipe.globals }, "absolute"));
    return `Applied ${preset.name}`;
  }

  const agentActions: AgentActions = {
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
    commitRecipe(applyPatch(defaultRecipe(), { globals: clipboard.globals }, "absolute"));
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
        {navSrc && photo?.kind !== "raw" && !photo?.missing ? (
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
        <div ref={hostRef} className={`preview-host${view === "1:1" ? " zoom" : ""}`}>
          <canvas ref={canvasRef} className="preview" />
          {photo?.kind === "raw" ? (
            <p className="overlay">RAW files are catalogued; preview needs a native decoder.</p>
          ) : null}
          {photo?.missing ? <p className="overlay">File missing on disk.</p> : null}
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
            onToggle={(id, alt) => {
              if (alt) {
                setSolo((s) => (s === id ? null : id));
                return;
              }
              setOpen((o) => ({ ...o, [id]: !(o[id] ?? true) }));
            }}
            onLive={livePatch}
            onCommit={commitHistory}
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
