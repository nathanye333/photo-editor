# Lightroom Parity Plan

Lightroom-inspired develop lab on disk. This document tracks progress toward feature parity with Adobe Lightroom Classic / Lightroom, organized by release tier.

**Goal:** A local-first photo workflow where photos stay on disk, edits are non-destructive JSON recipes, and the AI agent shares the same recipe as the UI.

**Status key:** `[x]` shipped · `[~]` partial / stubbed · `[ ]` not started

---

## v1 — Shipped

Core develop globals, minimal library, and the agent.

### Library & catalog

- [x] Library grid + filmstrip navigation
- [x] Folder sidebar with "All photographs" filter
- [x] Import by reference (JPEG, PNG, WebP)
- [x] RAW import with ffmpeg decode + thumbnails (desktop)
- [x] Star ratings (0–5)
- [x] Pick / reject / unflagged flags
- [x] Keyboard shortcuts (`0–5`, `P` / `X` / `U`, arrows, `\` before/after, undo/redo)
- [x] Basic metadata panel (file name, dimensions, flag)
- [x] Missing file detection (desktop)

### Develop

- [x] Basic panel (exposure, contrast, highlights, shadows, whites, blacks, temp, tint, vibrance, saturation)
- [x] Parametric tone curve (highlights, lights, darks, shadows)
- [x] HSL (8 channels: red → magenta)
- [x] Detail (sharpening, noise reduction, clarity, dehaze)
- [x] Histogram with clipping stats
- [x] Before/after toggle
- [x] Fit / 1:1 view modes
- [x] Solo panel mode (Alt-click)
- [x] Undo / redo history stack
- [x] Copy / paste settings between photos
- [x] Named presets (SQLite)
- [x] JPEG export (WebGL → save dialog / download)

### Agent

- [x] Docked chat panel with keyword-based tool routing
- [x] Tools: `apply_develop_patch`, `apply_catalog_patch`, `apply_preset`, `copy_settings`, `reset_recipe`
- [x] Privacy model: recipe, histogram, and EXIF only — no photo pixels uploaded
- [x] Eval suite (`evals/develop-v1.jsonl`)

### Stubs (typed or UI present, not functional)

- [~] Color Grading panel — stub in UI
- [~] Optics — `lensCorrection` on recipe, unused in renderer, no profile library
- [~] Geometry — crop, straighten, aspect presets shipped in v1.6; perspective deferred
- [x] Masks — radial MVP shipped in v1.5; other mask types still deferred

---

## v1.5 — Local adjustments

Highest-impact develop gap. Schema is ready in `src/recipe/types.ts`.

- [x] Mask UI (create, invert, feather, density; rename/reorder deferred)
- [x] Radial gradient mask
- [x] Linear gradient mask
- [x] Brush mask (paint add/erase on preview; size, hardness, opacity)
- [x] Luminance range mask (click preview to center range)
- [x] Color range mask (click preview to sample color)
- [x] Per-mask develop params (partial `Globals` override — exposure/tone subset in UI)
- [x] WebGL mask compositing in preview renderer
- [x] Agent tool support for mask patches (`upsert_mask` / `upsert_brush_mask` / `upsert_luminance_mask` / `upsert_color_mask` / `remove_mask`)
- [ ] Semantic mask component (typed; model integration TBD)

**Exit criteria:** Apply a radial gradient exposure boost to a subject; see it in preview, undo, export, and via agent. **Met.** Brush / color / luma selection also shipped.

**Still deferred:** semantic/subject AI; rename/reorder UI; full per-mask Basic panel; mask overlay visualization.

---

## v1.6 — RAW & geometry

Unlock serious workflows: editable RAW and basic framing.

### RAW

- [x] Native RAW decode (ffmpeg via Tauri desktop)
- [x] RAW preview in Library grid and Develop
- [x] RAW-aware thumbnail generation
- [ ] White balance from RAW metadata as starting point

### Crop & transform

- [x] Interactive crop tool with handles
- [x] Aspect ratio presets (original, 1:1, 4:5, 16:9, custom)
- [x] Straighten overlay (drag handle + slider)
- [ ] Upright / auto perspective correction
- [ ] Guided upright (draw lines)
- [ ] Manual vertical / horizontal / rotate / aspect / scale transforms
- [x] Crop stored on recipe and applied in renderer + export

**Exit criteria:** Open a CR3 or NEF, crop to 4:5, straighten, export JPEG with crop applied. **Met** (desktop/Tauri; requires ffmpeg).

---

## v1.7 — Develop depth

Fill out panels that exist as stubs or single sliders.

### Color grading

- [ ] Global shadow / midtone / highlight wheels
- [ ] Blending and balance controls
- [ ] Renderer support for grading LUT or equivalent

### Optics

- [ ] Lens profile library (built-in or Adobe-compatible)
- [ ] Auto profile matching from EXIF (camera + lens)
- [ ] Chromatic aberration removal
- [ ] Profile vignette correction
- [ ] Manual vignette
- [ ] Defringe (purple / green)

### Detail (split controls)

- [ ] Sharpening: amount, radius, detail, masking
- [ ] Luminance noise reduction
- [ ] Color noise reduction
- [ ] Moiré reduction

### Tone curve

- [ ] Point curve UI (click/drag control points)
- [ ] Channel curves (RGB, Red, Green, Blue)
- [ ] Parametric ↔ point curve sync where applicable

### Other develop

- [ ] Calibration panel / camera color profiles (Adobe Color, Portrait, B&W, etc.)
- [ ] Grain
- [ ] Texture (separate from clarity)
- [ ] Auto tone / one-click enhance
- [x] Edit history panel with named snapshots

**Exit criteria:** Full develop panel set comparable to Lightroom's global + optics + detail; no stub messages in Develop UI.

---

## v2.0 — Library & culling

Lightroom's Library module is much richer than grid + filmstrip.

### Organization

- [x] Manual collections
- [ ] Smart collections (rule-based: rating, flag, date, camera, etc.)
- [x] Quick Collection
- [x] Virtual copies (same file, multiple recipes)
- [ ] Photo stacks (burst / bracket grouping)
- [x] Color labels (red, yellow, green, blue, purple)

### Metadata & search

- [x] Keywords / tags
- [x] Editable metadata (title, caption, copyright, creator)
- [x] Advanced filtering (rating, flag, camera, lens, color label, keyword search)
- [x] Sort options (capture date, import date, rating, file name)
- [x] Search by keyword or metadata text

### Culling views

- [x] Loupe view with quick zoom
- [x] Compare view (two-up)
- [x] Survey view (multi-image grid cull)
- [x] Auto-advance on pick / reject during cull

### Map

- [ ] Read GPS from EXIF
- [ ] Map module for location-based browsing
- [ ] Write location metadata

**Exit criteria:** Organize a shoot into collections, keyword favorites, cull with compare view and auto-advance, filter by camera/lens.

---

## v2.x — Import, portability & export

### Import & file workflow

- [ ] XMP sidecar read (import existing Lightroom edits where compatible)
- [ ] XMP sidecar write (portable edits alongside files)
- [ ] Watched folders / auto-import
- [ ] Duplicate detection on import
- [ ] Rename on import (date, counter, custom template)
- [ ] Relink missing files UI

### Export

- [ ] Export presets (format, size, quality, sharpening, naming)
- [ ] Batch export
- [ ] TIFF export (8- / 16-bit)
- [ ] PNG export
- [ ] Resize (long edge, dimensions, megapixels)
- [ ] Output sharpening (screen, standard, high)
- [ ] Watermark (text and graphic)
- [ ] Metadata embedding on export (EXIF / IPTC)
- [ ] DNG export / conversion with embedded recipe or baked edits

**Exit criteria:** Round-trip edits via XMP sidecar; batch export 50 photos to resized JPEG with watermark preset.

---

## v3+ — Advanced & pro workflows

Lower priority unless targeting power users. Some items may stay out of scope by design.

### Retouching & merge

- [ ] Spot removal / healing brush
- [ ] Red eye correction
- [ ] HDR merge
- [ ] Panorama merge
- [ ] Focus stack merge

### Capture & proofing

- [ ] Tethered shooting
- [ ] Soft proofing (simulate print / paper profile)
- [ ] Secondary display support

### Output modules

- [ ] Print module (layout, margins, cell spacing)
- [ ] Slideshow module
- [ ] Publish services (export plugins)

### AI & search (beyond edit agent)

- [ ] Semantic search ("photos with mountains")
- [ ] Face detection / people grouping
- [ ] Auto keyword suggestions

**Out of scope (by design):** Cloud sync across devices — Field is local-first; photos and recipes stay on disk.

---

## Differentiators (maintain, don't parity-match)

Features where Field intentionally diverges from Lightroom:

| Feature | Notes |
|---|---|
| **Privacy-first agent** | Edits recipe locally; no pixel upload. Lightroom AI features are cloud-dependent. |
| **Reference-based import** | No vault lock-in; photos remain where they are on disk. |
| **Unified recipe model** | One JSON recipe shared by sliders, WebGL preview, and agent tools. |
| **Original branding** | Lightroom-inspired layout, not a clone. |

---

## Suggested sequencing

```
v1    ✅  Globals, library basics, agent, JPEG export
v1.5  ~   Masks (brush, color, luma, radial shipped; linear/semantic next)
v1.6  ✅  RAW decode + crop / transform
v1.7  →   Color grading, lens profiles, full detail, point curve
v2.0  ~   Culling views shipped; smart collections + map next
v2.x  →   XMP sidecars, batch export, export presets
v3+   →   Spot heal, merge tools, tethering, print
```

---

## References

| Resource | Location |
|---|---|
| Recipe schema (incl. v1.5 mask types) | `src/recipe/types.ts` |
| Develop panel stubs | `src/ui/develop.tsx` |
| Agent capabilities & limits | `src/agent/tools.ts` |
| Agent eval cases | `evals/develop-v1.jsonl` |
| Current shipped features | `README.md` |
