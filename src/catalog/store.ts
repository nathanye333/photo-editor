import Database from "@tauri-apps/plugin-sql";
import { initHistory, type RecipeHistory } from "../recipe/history";
import { cloneRecipe, defaultRecipe } from "../recipe/defaults";
import { parseCatalogFields, parseRecipe, defaultCatalogFields } from "../recipe/patch";
import { isTauri } from "../native";
import { loadImageBlob } from "./browserBlobs";
import { loadBrowserCatalog, scheduleBrowserCatalogSave } from "./browserPersist";
import {
  folderOf,
  type Collection,
  type CollectionKind,
  type Photo,
  type Preset,
  type RecipeSnapshot,
} from "./types";
import type { LibraryFilters } from "./filter";
import { DEFAULT_LIBRARY_FILTERS } from "./filter";

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
  master_id: string | null;
  copy_name: string | null;
  keywords: string | null;
  color_label: string | null;
  title: string | null;
  caption: string | null;
  copyright: string | null;
  creator: string | null;
  quick_collection: number | null;
  stack_id: string | null;
  stack_index: number | null;
  latitude: number | null;
  longitude: number | null;
};

let db: Database | null = null;
let memoryPhotos: Photo[] = [];
let memoryPresets: Preset[] = [];
let memorySnapshots: RecipeSnapshot[] = [];
let memoryCollections: Collection[] = [];
let memoryCollectionPhotos: Array<{ collectionId: string; photoId: string }> = [];

function browserSnapshot() {
  return {
    photos: memoryPhotos,
    presets: memoryPresets,
    snapshots: memorySnapshots,
    collections: memoryCollections,
    collectionPhotos: memoryCollectionPhotos,
  };
}

function persistBrowserIfNeeded(): void {
  if (db || isTauri()) return;
  scheduleBrowserCatalogSave(browserSnapshot);
}

function loadBrowserIntoMemory(): void {
  const data = loadBrowserCatalog();
  if (!data) return;
  memoryPhotos = data.photos;
  memoryPresets = data.presets;
  memorySnapshots = data.snapshots;
  memoryCollections = data.collections;
  memoryCollectionPhotos = data.collectionPhotos;
}

async function hydrateBrowserPhotoUrls(photos: Photo[]): Promise<Photo[]> {
  const out: Photo[] = [];
  for (const photo of photos) {
    if (photo.blobUrl || photo.kind === "sample") {
      out.push(photo);
      continue;
    }
    const blob = await loadImageBlob(photo.id);
    out.push(blob ? { ...photo, blobUrl: URL.createObjectURL(blob) } : photo);
  }
  return out;
}

function hydrate(row: PhotoRow): Photo {
  const catalog = parseCatalogFields(
    row.rating,
    row.flag,
    row.keywords,
    row.color_label,
    row.title,
    row.caption,
    row.copyright,
    row.creator,
    row.quick_collection,
  );
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
    recipe,
    history,
    folder: row.folder,
    thumbPath: row.thumb_path ?? undefined,
    kind: row.kind === "raw" ? "raw" : row.kind === "sample" ? "sample" : "bitmap",
    masterId: row.master_id ?? undefined,
    copyName: row.copy_name ?? undefined,
    stackId: row.stack_id ?? undefined,
    stackIndex: row.stack_index ?? undefined,
    latitude: row.latitude ?? undefined,
    longitude: row.longitude ?? undefined,
    ...catalog,
  };
}

async function migrateV2(database: Database): Promise<void> {
  const cols = await database.select<{ name: string }[]>("PRAGMA table_info(photos)");
  if (cols.some((c) => c.name === "master_id")) return;

  await database.execute(`
    CREATE TABLE photos_v2 (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
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
      kind TEXT DEFAULT 'bitmap',
      master_id TEXT,
      copy_name TEXT
    );
  `);
  await database.execute(`
    INSERT INTO photos_v2 (id,path,mtime,width,height,exif,rating,flag,recipe,history,folder,thumb_path,kind,master_id,copy_name)
    SELECT id,path,mtime,width,height,exif,rating,flag,recipe,history,folder,thumb_path,kind,NULL,NULL FROM photos;
  `);
  await database.execute(`DROP TABLE photos;`);
  await database.execute(`ALTER TABLE photos_v2 RENAME TO photos;`);
}

async function migrateV3(database: Database): Promise<void> {
  const cols = await database.select<{ name: string }[]>("PRAGMA table_info(photos)");
  const has = (name: string) => cols.some((c) => c.name === name);
  if (has("keywords")) return;
  await database.execute(`ALTER TABLE photos ADD COLUMN keywords TEXT DEFAULT '[]'`);
  await database.execute(`ALTER TABLE photos ADD COLUMN color_label TEXT`);
  await database.execute(`ALTER TABLE photos ADD COLUMN title TEXT DEFAULT ''`);
  await database.execute(`ALTER TABLE photos ADD COLUMN caption TEXT DEFAULT ''`);
  await database.execute(`ALTER TABLE photos ADD COLUMN copyright TEXT DEFAULT ''`);
  await database.execute(`ALTER TABLE photos ADD COLUMN creator TEXT DEFAULT ''`);
  await database.execute(`ALTER TABLE photos ADD COLUMN quick_collection INTEGER DEFAULT 0`);
}

async function migrateV4(database: Database): Promise<void> {
  const photoCols = await database.select<{ name: string }[]>("PRAGMA table_info(photos)");
  if (!photoCols.some((c) => c.name === "stack_id")) {
    await database.execute(`ALTER TABLE photos ADD COLUMN stack_id TEXT`);
    await database.execute(`ALTER TABLE photos ADD COLUMN stack_index INTEGER DEFAULT 0`);
    await database.execute(`ALTER TABLE photos ADD COLUMN latitude REAL`);
    await database.execute(`ALTER TABLE photos ADD COLUMN longitude REAL`);
  }
  const colCols = await database.select<{ name: string }[]>("PRAGMA table_info(collections)");
  if (!colCols.some((c) => c.name === "kind")) {
    await database.execute(`ALTER TABLE collections ADD COLUMN kind TEXT DEFAULT 'manual'`);
    await database.execute(`ALTER TABLE collections ADD COLUMN rules TEXT`);
  }
}

export async function openCatalog(): Promise<void> {
  if (!isTauri()) {
    loadBrowserIntoMemory();
    return;
  }
  db = await Database.load("sqlite:field.db");
  await db.execute(`
    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
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
      kind TEXT DEFAULT 'bitmap',
      master_id TEXT,
      copy_name TEXT,
      keywords TEXT DEFAULT '[]',
      color_label TEXT,
      title TEXT DEFAULT '',
      caption TEXT DEFAULT '',
      copyright TEXT DEFAULT '',
      creator TEXT DEFAULT '',
      quick_collection INTEGER DEFAULT 0,
      stack_id TEXT,
      stack_index INTEGER DEFAULT 0,
      latitude REAL,
      longitude REAL
    );
  `);
  await migrateV2(db);
  await migrateV3(db);
  await migrateV4(db);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      recipe TEXT NOT NULL
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS recipe_snapshots (
      id TEXT PRIMARY KEY,
      photo_id TEXT NOT NULL,
      name TEXT NOT NULL,
      recipe TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(photo_id, name)
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT DEFAULT 'manual',
      rules TEXT
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS collection_photos (
      collection_id TEXT NOT NULL,
      photo_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (collection_id, photo_id)
    );
  `);
}

export async function loadPhotos(): Promise<Photo[]> {
  if (!db) {
    memoryPhotos = await hydrateBrowserPhotoUrls(memoryPhotos);
    return memoryPhotos;
  }
  const rows = await db.select<PhotoRow[]>("SELECT * FROM photos ORDER BY path, copy_name");
  return rows.map(hydrate);
}

export async function upsertPhoto(photo: Photo): Promise<void> {
  if (!db) {
    const i = memoryPhotos.findIndex((p) => p.id === photo.id);
    if (i >= 0) memoryPhotos[i] = photo;
    else memoryPhotos.push(photo);
    persistBrowserIfNeeded();
    return;
  }
  await db.execute(
    `INSERT INTO photos (id,path,mtime,width,height,exif,rating,flag,recipe,history,folder,thumb_path,kind,master_id,copy_name,keywords,color_label,title,caption,copyright,creator,quick_collection,stack_id,stack_index,latitude,longitude)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
     ON CONFLICT(id) DO UPDATE SET
       path=excluded.path, mtime=excluded.mtime, width=excluded.width, height=excluded.height,
       exif=excluded.exif, rating=excluded.rating, flag=excluded.flag, recipe=excluded.recipe,
       history=excluded.history, folder=excluded.folder, thumb_path=excluded.thumb_path, kind=excluded.kind,
       master_id=excluded.master_id, copy_name=excluded.copy_name, keywords=excluded.keywords,
       color_label=excluded.color_label, title=excluded.title, caption=excluded.caption,
       copyright=excluded.copyright, creator=excluded.creator, quick_collection=excluded.quick_collection,
       stack_id=excluded.stack_id, stack_index=excluded.stack_index,
       latitude=excluded.latitude, longitude=excluded.longitude`,
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
      photo.masterId ?? null,
      photo.copyName ?? null,
      JSON.stringify(photo.keywords),
      photo.colorLabel,
      photo.title,
      photo.caption,
      photo.copyright,
      photo.creator,
      photo.quickCollection ? 1 : 0,
      photo.stackId ?? null,
      photo.stackIndex ?? null,
      photo.latitude ?? null,
      photo.longitude ?? null,
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
    persistBrowserIfNeeded();
    return;
  }
  await db.execute(
    `INSERT INTO presets (id,name,recipe) VALUES ($1,$2,$3)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, recipe=excluded.recipe`,
    [preset.id, preset.name, JSON.stringify(preset.recipe)],
  );
}

export async function loadSnapshots(photoId: string): Promise<RecipeSnapshot[]> {
  if (!db) {
    return memorySnapshots
      .filter((s) => s.photoId === photoId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }
  const rows = await db.select<
    { id: string; photo_id: string; name: string; recipe: string; created_at: number }[]
  >("SELECT * FROM recipe_snapshots WHERE photo_id = $1 ORDER BY created_at", [photoId]);
  return rows.map((r) => ({
    id: r.id,
    photoId: r.photo_id,
    name: r.name,
    recipe: parseRecipe(JSON.parse(r.recipe)),
    createdAt: r.created_at,
  }));
}

export async function saveSnapshotRow(snapshot: RecipeSnapshot): Promise<void> {
  if (!db) {
    memorySnapshots = [...memorySnapshots.filter((s) => s.id !== snapshot.id), snapshot];
    persistBrowserIfNeeded();
    return;
  }
  await db.execute(
    `INSERT INTO recipe_snapshots (id,photo_id,name,recipe,created_at) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, recipe=excluded.recipe`,
    [
      snapshot.id,
      snapshot.photoId,
      snapshot.name,
      JSON.stringify(snapshot.recipe),
      snapshot.createdAt,
    ],
  );
}

export async function deleteSnapshotRow(id: string): Promise<void> {
  if (!db) {
    memorySnapshots = memorySnapshots.filter((s) => s.id !== id);
    persistBrowserIfNeeded();
    return;
  }
  await db.execute(`DELETE FROM recipe_snapshots WHERE id = $1`, [id]);
}

function parseCollectionRules(raw: string | null): LibraryFilters | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<LibraryFilters>;
    return { ...DEFAULT_LIBRARY_FILTERS, ...parsed };
  } catch {
    return undefined;
  }
}

export async function loadCollections(): Promise<Collection[]> {
  if (!db) return memoryCollections;
  const rows = await db.select<{ id: string; name: string; kind: string | null; rules: string | null }[]>(
    "SELECT * FROM collections ORDER BY name",
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: (r.kind === "smart" ? "smart" : "manual") as CollectionKind,
    rules: r.kind === "smart" ? parseCollectionRules(r.rules) : undefined,
  }));
}

export async function saveCollectionRow(collection: Collection): Promise<void> {
  if (!db) {
    memoryCollections = [...memoryCollections.filter((c) => c.id !== collection.id), collection];
    persistBrowserIfNeeded();
    return;
  }
  await db.execute(
    `INSERT INTO collections (id,name,kind,rules) VALUES ($1,$2,$3,$4)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, rules=excluded.rules`,
    [
      collection.id,
      collection.name,
      collection.kind,
      collection.kind === "smart" && collection.rules ? JSON.stringify(collection.rules) : null,
    ],
  );
}

export async function deleteCollectionRow(id: string): Promise<void> {
  if (!db) {
    memoryCollections = memoryCollections.filter((c) => c.id !== id);
    memoryCollectionPhotos = memoryCollectionPhotos.filter((r) => r.collectionId !== id);
    persistBrowserIfNeeded();
    return;
  }
  await db.execute(`DELETE FROM collection_photos WHERE collection_id = $1`, [id]);
  await db.execute(`DELETE FROM collections WHERE id = $1`, [id]);
}

export async function loadCollectionPhotoIds(collectionId: string): Promise<string[]> {
  if (!db) {
    return memoryCollectionPhotos
      .filter((r) => r.collectionId === collectionId)
      .map((r) => r.photoId);
  }
  const rows = await db.select<{ photo_id: string }[]>(
    "SELECT photo_id FROM collection_photos WHERE collection_id = $1 ORDER BY sort_order",
    [collectionId],
  );
  return rows.map((r) => r.photo_id);
}

export async function addPhotoToCollection(collectionId: string, photoId: string): Promise<void> {
  if (!db) {
    if (!memoryCollectionPhotos.some((r) => r.collectionId === collectionId && r.photoId === photoId)) {
      memoryCollectionPhotos.push({ collectionId, photoId });
      persistBrowserIfNeeded();
    }
    return;
  }
  const rows = await db.select<{ n: number }[]>(
    "SELECT COUNT(*) as n FROM collection_photos WHERE collection_id = $1",
    [collectionId],
  );
  const sortOrder = rows[0]?.n ?? 0;
  await db.execute(
    `INSERT INTO collection_photos (collection_id,photo_id,sort_order) VALUES ($1,$2,$3)
     ON CONFLICT(collection_id,photo_id) DO NOTHING`,
    [collectionId, photoId, sortOrder],
  );
}

export async function removePhotoFromCollection(collectionId: string, photoId: string): Promise<void> {
  if (!db) {
    memoryCollectionPhotos = memoryCollectionPhotos.filter(
      (r) => !(r.collectionId === collectionId && r.photoId === photoId),
    );
    persistBrowserIfNeeded();
    return;
  }
  await db.execute(`DELETE FROM collection_photos WHERE collection_id = $1 AND photo_id = $2`, [
    collectionId,
    photoId,
  ]);
}

export function createVirtualCopy(master: Photo, existingCopies: Photo[]): Photo {
  const masterKey = master.masterId ?? master.id;
  const copyCount = existingCopies.filter((p) => (p.masterId ?? p.id) === masterKey || p.id === masterKey).length;
  const recipe = cloneRecipe(master.recipe);
  return emptyPhoto({
    id: crypto.randomUUID(),
    path: master.path,
    masterId: masterKey,
    copyName: `Copy ${copyCount}`,
    mtime: master.mtime,
    width: master.width,
    height: master.height,
    exif: master.exif,
    rating: master.rating,
    flag: master.flag,
    recipe,
    history: initHistory(recipe),
    folder: master.folder,
    thumbPath: master.thumbPath,
    thumbDataUrl: master.thumbDataUrl,
    blobUrl: master.blobUrl,
    kind: master.kind,
    latitude: master.latitude,
    longitude: master.longitude,
  });
}

export function emptyPhoto(partial: Partial<Photo> & Pick<Photo, "id" | "path">): Photo {
  const recipe = partial.recipe ?? defaultRecipe();
  return {
    ...defaultCatalogFields(),
    mtime: 0,
    width: 0,
    height: 0,
    exif: {},
    history: initHistory(recipe),
    folder: folderOf(partial.path),
    kind: "bitmap",
    recipe,
    ...partial,
  };
}
