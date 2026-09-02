import type { Collection, Photo, Preset, RecipeSnapshot } from "./types";

const KEY = "field.catalog.v1";

export type BrowserCatalog = {
  photos: Photo[];
  presets: Preset[];
  snapshots: RecipeSnapshot[];
  collections: Collection[];
  collectionPhotos: Array<{ collectionId: string; photoId: string }>;
};

export function stripSessionUrls(photo: Photo): Photo {
  const { blobUrl: _blobUrl, ...rest } = photo;
  return rest;
}

export function loadBrowserCatalog(): BrowserCatalog | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BrowserCatalog>;
    return {
      photos: Array.isArray(parsed.photos) ? parsed.photos : [],
      presets: Array.isArray(parsed.presets) ? parsed.presets : [],
      snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
      collections: Array.isArray(parsed.collections)
        ? parsed.collections.map((c) => ({ ...c, kind: c.kind ?? "manual" }))
        : [],
      collectionPhotos: Array.isArray(parsed.collectionPhotos) ? parsed.collectionPhotos : [],
    };
  } catch {
    return null;
  }
}

export function saveBrowserCatalog(data: BrowserCatalog): void {
  const payload: BrowserCatalog = {
    photos: data.photos.map(stripSessionUrls),
    presets: data.presets,
    snapshots: data.snapshots,
    collections: data.collections,
    collectionPhotos: data.collectionPhotos,
  };
  localStorage.setItem(KEY, JSON.stringify(payload));
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleBrowserCatalogSave(snapshot: () => BrowserCatalog): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      saveBrowserCatalog(snapshot());
    } catch {
      // localStorage quota — catalog stays in memory for this session
    }
  }, 250);
}
