# Field

Local photo develop lab. Lightroom-inspired layout, original branding. Photos stay on disk; edits are a non-destructive JSON recipe shared by sliders and the agent.

## Run

```bash
npm install
npm test
npm run dev          # web UI (sample image, browser file import)
npm run tauri dev    # desktop: folder import, SQLite catalog, export
```

Needs a Rust toolchain for the Tauri shell. The Vite app works alone for Develop globals on the built-in sample.

## v1

- Library grid + filmstrip, stars / pick-reject (`0–5`, `P` / `X` / `U`, arrows)
- Import by reference (JPEG / PNG / WebP). RAW is catalogued without a preview.
- Develop globals (WebGL2): tone, WB, HSL, tone curve, presence
- Histogram, Before (`\`), fit / 1:1, undo, copy/paste, presets, JPEG export
- Docked agent (`apply_develop_patch` and catalog/preset tools). API key in Settings. No photo pixels are uploaded.

## v1.5 (radial masks)

- Masks panel: add/delete radial, invert / feather / density, geometry sliders, local exposure/tone
- WebGL multi-pass compositing (empty-mask path unchanged)
- Agent: `upsert_mask` / `remove_mask`

See [ROADMAP.md](ROADMAP.md) for remaining mask types and later tiers.
