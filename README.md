# Field

Local photo develop lab. Lightroom-inspired layout, original branding. Photos stay on disk (desktop); browser mode stores catalog + blobs in Supabase per OAuth account. Edits are a non-destructive JSON recipe shared by sliders and the agent.

## Run

```bash
npm install
cp .env.example .env.local   # set VITE_SUPABASE_URL + anon/publishable key for browser mode
npm test
npm run dev          # web UI — sign in with Google/GitHub, import photos
npm run tauri dev    # desktop: folder import, SQLite catalog, export
```

See [supabase/README.md](supabase/README.md) for schema, RLS, storage, and OAuth setup.

Needs a Rust toolchain for the Tauri shell. The Vite app requires Supabase for persistent browser catalogs (sample image still works after sign-in when the catalog is empty).

## v1

- Library grid + filmstrip, stars / pick-reject (`0–5`, `P` / `X` / `U`, arrows)
- Import by reference (JPEG / PNG / WebP). RAW is catalogued without a preview.
- Develop globals (WebGL2): tone, WB, HSL, tone curve, presence
- Histogram, Before (`\`), fit / 1:1, undo, copy/paste, presets, JPEG export
- Docked agent (`apply_develop_patch` and catalog/preset/mask tools). API key in Settings.
- Agent can analyze the scene locally and optionally send a small develop-preview JPEG when **Preview vision** is enabled (default on). Turn it off in Settings to keep pixels on-device.
- Tool / reasoning timeline in the agent chat shows live tool calls.

## v1.5 (masks)

- **Brush** — paint / erase on the preview (size, hardness, opacity)
- **Color range** — click preview to sample; tune hue / chroma / tolerance
- **Luminance range** — select by brightness; click to center the range
- **Radial** — soft oval falloff
- WebGL multi-pass compositing; agent tools for each mask kind
- **Subject / Sky** semantic masks via local segmentation (Transformers.js with heuristic fallback)

See [ROADMAP.md](ROADMAP.md) for linear / semantic masks and later tiers.
