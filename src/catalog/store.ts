import Database from "@tauri-apps/plugin-sql";
import { initHistory, type RecipeHistory } from "../recipe/history";
import { defaultRecipe } from "../recipe/defaults";
import { parseCatalogFields, parseRecipe } from "../recipe/patch";
import { isTauri } from "../native";
import { folderOf, type Photo, type Preset } from "./types";

type PhotoRow = {
  id: string;
  path: string;
  mtime: number;
  width: number;
  height: number;
  exif: string;
  rating: number;
  flag: string;
  recipe: string;
  history: string;
  folder: string;
  thumb_path: string | null;
  kind: string;
};

let db: Database | null = null;
let memoryPhotos: Photo[] = [];
let memoryPresets: Preset[] = [];

function hydrate(row: PhotoRow): Photo {
  const catalog = parseCatalogFields(row.rating, row.flag);
  const recipe = parseRecipe(JSON.parse(row.recipe));
  let history: RecipeHistory;
  try {
    const h = JSON.parse(row.history) as RecipeHistory;
    history = h?.present ? h : initHistory(recipe);
  } catch {
    history = initHistory(recipe);
  }
  return {
    id: row.id,
    path: row.path,
    mtime: row.mtime,
    width: row.width,
    height: row.height,
    exif: JSON.parse(row.exif || "{}"),
    rating: catalog.rating,
    flag: catalog.flag,
    recipe,
    history,
    folder: row.folder,
    thumbPath: row.thumb_path ?? undefined,
    kind: row.kind === "raw" ? "raw" : row.kind === "sample" ? "sample" : "bitmap",
  };
}

export async function openCatalog(): Promise<void> {
  if (!isTauri()) return;
  db = await Database.load("sqlite:field.db");
  await db.execute(`
    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      path TEXT UNIQUE NOT NULL,
      mtime INTEGER,
      width INTEGER,
      height INTEGER,
      exif TEXT,
      rating INTEGER DEFAULT 0,
      flag TEXT DEFAULT 'unflagged',
      recipe TEXT NOT NULL,
      history TEXT NOT NULL,
      folder TEXT,
      thumb_path TEXT,
      kind TEXT DEFAULT 'bitmap'
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      recipe TEXT NOT NULL
    );
  `);
}

export async function loadPhotos(): Promise<Photo[]> {
  if (!db) return memoryPhotos;
  const rows = await db.select<PhotoRow[]>("SELECT * FROM photos ORDER BY path");
  return rows.map(hydrate);
}

export async function upsertPhoto(photo: Photo): Promise<void> {
  if (!db) {
    const i = memoryPhotos.findIndex((p) => p.id === photo.id);
    if (i >= 0) memoryPhotos[i] = photo;
    else memoryPhotos.push(photo);
    return;
  }
  await db.execute(
    `INSERT INTO photos (id,path,mtime,width,height,exif,rating,flag,recipe,history,folder,thumb_path,kind)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT(id) DO UPDATE SET
       path=excluded.path, mtime=excluded.mtime, width=excluded.width, height=excluded.height,
       exif=excluded.exif, rating=excluded.rating, flag=excluded.flag, recipe=excluded.recipe,
       history=excluded.history, folder=excluded.folder, thumb_path=excluded.thumb_path, kind=excluded.kind`,
    [
      photo.id,
      photo.path,
      photo.mtime,
      photo.width,
      photo.height,
      JSON.stringify(photo.exif),
      photo.rating,
      photo.flag,
      JSON.stringify(photo.recipe),
      JSON.stringify(photo.history),
      photo.folder || folderOf(photo.path),
      photo.thumbPath ?? null,
      photo.kind,
    ],
  );
}

export async function loadPresets(): Promise<Preset[]> {
  if (!db) return memoryPresets;
  const rows = await db.select<{ id: string; name: string; recipe: string }[]>(
    "SELECT * FROM presets ORDER BY name",
  );
  return rows.map((r) => ({ id: r.id, name: r.name, recipe: parseRecipe(JSON.parse(r.recipe)) }));
}

export async function savePresetRow(preset: Preset): Promise<void> {
  if (!db) {
    memoryPresets = [...memoryPresets.filter((p) => p.id !== preset.id), preset];
    return;
  }
  await db.execute(
    `INSERT INTO presets (id,name,recipe) VALUES ($1,$2,$3)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, recipe=excluded.recipe`,
    [preset.id, preset.name, JSON.stringify(preset.recipe)],
  );
}

export function emptyPhoto(partial: Partial<Photo> & Pick<Photo, "id" | "path">): Photo {
  const recipe = partial.recipe ?? defaultRecipe();
  return {
    mtime: 0,
    width: 0,
    height: 0,
    exif: {},
    rating: 0,
    flag: "unflagged",
    history: initHistory(recipe),
    folder: folderOf(partial.path),
    kind: "bitmap",
    recipe,
    ...partial,
  };
}
