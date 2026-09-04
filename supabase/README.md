# Field Supabase setup

Browser mode stores photo state (recipes, metadata, blobs) per OAuth account in Supabase.
Desktop (Tauri) still uses the local SQLite catalog.

## 1. Create a project

Create a Supabase project, then copy the project URL and anon/publishable key into `.env.local`:

```bash
cp .env.example .env.local
```

## 2. Apply the migration

In the Supabase SQL editor, run:

`supabase/migrations/20260904224353_photo_catalog_oauth.sql`

Or with the CLI linked to your project:

```bash
npx supabase db push
```

This creates `photos`, `presets`, `recipe_snapshots`, `collections`, `collection_photos` with RLS, plus the private `photo-images` storage bucket.

## 3. Enable OAuth providers

In Authentication → Providers, enable **Google** and/or **GitHub**.

Add your app origin (e.g. `http://localhost:1420`) to Redirect URLs.

## 4. Run

```bash
npm run dev
```

Sign in, import photos — catalog + image blobs sync to your account. A one-time migration copies any legacy `localStorage` / IndexedDB catalog into Supabase, then clears browser storage.
