import type { SupabaseClient } from "@supabase/supabase-js";
import { initHistory, type RecipeHistory } from "../recipe/history";
import { parseCatalogFields, parseRecipe } from "../recipe/patch";
import { getSupabase } from "../supabase/client";
import type { Collection, CollectionKind, Photo, Preset, RecipeSnapshot } from "./types";
import type { LibraryFilters } from "./filter";
import { DEFAULT_LIBRARY_FILTERS } from "./filter";
import { loadImageBlob, deleteImageBlob } from "./browserBlobs";
import { loadBrowserCatalog, saveBrowserCatalog } from "./browserPersist";

const BUCKET = "photo-images";

export type PhotoRow = {
  id: string;
  user_id: string;
  path: string;
  mtime: number;
  width: number;
  height: number;
  exif: Record<string, string>;
  rating: number;
  flag: string;
  recipe: unknown;
  history: unknown;
  folder: string;
  kind: string;
  master_id: string | null;
  copy_name: string | null;
  keywords: unknown;
  color_label: string | null;
  title: string;
  caption: string;
  copyright: string;
  creator: string;
  quick_collection: boolean;
  stack_id: string | null;
  stack_index: number | null;
  latitude: number | null;
  longitude: number | null;
  storage_path: string | null;
  thumb_storage_path: string | null;
};

function sb(): SupabaseClient {
  return getSupabase();
}

async function requireUserId(): Promise<string> {
  const { data, error } = await sb().auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Not signed in");
  return data.user.id;
}

function parseCollectionRules(raw: unknown): LibraryFilters | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  return { ...DEFAULT_LIBRARY_FILTERS, ...(raw as Partial<LibraryFilters>) };
}

function hydratePhoto(row: PhotoRow, blobUrl?: string, thumbDataUrl?: string): Photo {
  const catalog = parseCatalogFields(
    row.rating,
    row.flag,
    JSON.stringify(row.keywords ?? []),
    row.color_label,
    row.title,
    row.caption,
    row.copyright,
    row.creator,
    row.quick_collection ? 1 : 0,
  );
  const recipe = parseRecipe(row.recipe);
  let history: RecipeHistory;
  try {
    const h = row.history as RecipeHistory;
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
    exif: row.exif ?? {},
    recipe,
    history,
    folder: row.folder,
    kind: row.kind === "raw" ? "raw" : row.kind === "sample" ? "sample" : "bitmap",
    masterId: row.master_id ?? undefined,
    copyName: row.copy_name ?? undefined,
    stackId: row.stack_id ?? undefined,
    stackIndex: row.stack_index ?? undefined,
    latitude: row.latitude ?? undefined,
    longitude: row.longitude ?? undefined,
    blobUrl,
    thumbDataUrl,
    ...catalog,
  };
}

function photoToRow(photo: Photo, userId: string, storagePath: string | null, thumbPath: string | null): PhotoRow {
  return {
    id: photo.id,
    user_id: userId,
    path: photo.path,
    mtime: photo.mtime,
    width: photo.width,
    height: photo.height,
    exif: photo.exif,
    rating: photo.rating,
    flag: photo.flag,
    recipe: photo.recipe,
    history: photo.history,
    folder: photo.folder,
    kind: photo.kind,
    master_id: photo.masterId ?? null,
    copy_name: photo.copyName ?? null,
    keywords: photo.keywords,
    color_label: photo.colorLabel,
    title: photo.title,
    caption: photo.caption,
    copyright: photo.copyright,
    creator: photo.creator,
    quick_collection: photo.quickCollection,
    stack_id: photo.stackId ?? null,
    stack_index: photo.stackIndex ?? null,
    latitude: photo.latitude ?? null,
    longitude: photo.longitude ?? null,
    storage_path: storagePath,
    thumb_storage_path: thumbPath,
  };
}

async function signedUrl(path: string | null | undefined): Promise<string | undefined> {
  if (!path) return undefined;
  const { data, error } = await sb().storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);
  if (error || !data?.signedUrl) return undefined;
  return data.signedUrl;
}

async function uploadBlob(userId: string, photoId: string, name: "original" | "thumb", blob: Blob): Promise<string> {
  const path = `${userId}/${photoId}/${name}`;
  const { error } = await sb().storage.from(BUCKET).upload(path, blob, {
    upsert: true,
    contentType: blob.type || (name === "thumb" ? "image/jpeg" : "application/octet-stream"),
  });
  if (error) throw error;
  return path;
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

/** Hydrate signed URLs for develop + thumbs. */
export async function hydrateSupabasePhotoUrls(photos: Photo[], rows: PhotoRow[]): Promise<Photo[]> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: Photo[] = [];
  for (const photo of photos) {
    const row = byId.get(photo.id);
    if (!row) {
      out.push(photo);
      continue;
    }
    const [blobUrl, thumbUrl] = await Promise.all([
      signedUrl(row.storage_path),
      signedUrl(row.thumb_storage_path),
    ]);
    out.push({
      ...photo,
      blobUrl: blobUrl ?? photo.blobUrl,
      thumbDataUrl: thumbUrl ?? photo.thumbDataUrl,
    });
  }
  return out;
}

export async function supabaseLoadPhotos(): Promise<Photo[]> {
  const userId = await requireUserId();
  const { data, error } = await sb()
    .from("photos")
    .select("*")
    .eq("user_id", userId)
    .order("path")
    .order("copy_name", { ascending: true, nullsFirst: true });
  if (error) throw error;
  const rows = (data ?? []) as PhotoRow[];
  const photos = rows.map((r) => hydratePhoto(r));
  return hydrateSupabasePhotoUrls(photos, rows);
}

export async function supabaseUpsertPhoto(photo: Photo): Promise<Photo> {
  const userId = await requireUserId();

  const { data: existing } = await sb()
    .from("photos")
    .select("storage_path, thumb_storage_path")
    .eq("user_id", userId)
    .eq("id", photo.id)
    .maybeSingle();

  let storagePath = (existing?.storage_path as string | null) ?? null;
  let thumbPath = (existing?.thumb_storage_path as string | null) ?? null;

  // Prefer an in-session blob URL (fresh import); otherwise keep existing storage.
  if (photo.blobUrl?.startsWith("blob:")) {
    const blob = await fetch(photo.blobUrl).then((r) => r.blob());
    storagePath = await uploadBlob(userId, photo.id, "original", blob);
  }
  if (photo.thumbDataUrl?.startsWith("data:")) {
    const thumb = await dataUrlToBlob(photo.thumbDataUrl);
    thumbPath = await uploadBlob(userId, photo.id, "thumb", thumb);
  } else if (photo.thumbDataUrl?.startsWith("blob:")) {
    const thumb = await fetch(photo.thumbDataUrl).then((r) => r.blob());
    thumbPath = await uploadBlob(userId, photo.id, "thumb", thumb);
  }

  const row = photoToRow(photo, userId, storagePath, thumbPath);
  const { error } = await sb().from("photos").upsert(row, { onConflict: "user_id,id" });
  if (error) throw error;

  const [blobUrl, thumbUrl] = await Promise.all([signedUrl(storagePath), signedUrl(thumbPath)]);
  return {
    ...photo,
    blobUrl: blobUrl ?? photo.blobUrl,
    thumbDataUrl: thumbUrl ?? (photo.thumbDataUrl?.startsWith("data:") ? undefined : photo.thumbDataUrl),
  };
}

export async function supabaseLoadPresets(): Promise<Preset[]> {
  const userId = await requireUserId();
  const { data, error } = await sb().from("presets").select("*").eq("user_id", userId).order("name");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    recipe: parseRecipe(r.recipe),
  }));
}

export async function supabaseSavePreset(preset: Preset): Promise<void> {
  const userId = await requireUserId();
  const { error } = await sb()
    .from("presets")
    .upsert(
      { id: preset.id, user_id: userId, name: preset.name, recipe: preset.recipe, updated_at: new Date().toISOString() },
      { onConflict: "user_id,id" },
    );
  if (error) throw error;
}

export async function supabaseLoadSnapshots(photoId: string): Promise<RecipeSnapshot[]> {
  const userId = await requireUserId();
  const { data, error } = await sb()
    .from("recipe_snapshots")
    .select("*")
    .eq("user_id", userId)
    .eq("photo_id", photoId)
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    photoId: r.photo_id as string,
    name: r.name as string,
    recipe: parseRecipe(r.recipe),
    createdAt: r.created_at as number,
  }));
}

export async function supabaseSaveSnapshot(snapshot: RecipeSnapshot): Promise<void> {
  const userId = await requireUserId();
  const { error } = await sb()
    .from("recipe_snapshots")
    .upsert(
      {
        id: snapshot.id,
        user_id: userId,
        photo_id: snapshot.photoId,
        name: snapshot.name,
        recipe: snapshot.recipe,
        created_at: snapshot.createdAt,
      },
      { onConflict: "user_id,id" },
    );
  if (error) throw error;
}

export async function supabaseDeleteSnapshot(id: string): Promise<void> {
  const userId = await requireUserId();
  const { error } = await sb().from("recipe_snapshots").delete().eq("user_id", userId).eq("id", id);
  if (error) throw error;
}

export async function supabaseLoadCollections(): Promise<Collection[]> {
  const userId = await requireUserId();
  const { data, error } = await sb().from("collections").select("*").eq("user_id", userId).order("name");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    kind: (r.kind === "smart" ? "smart" : "manual") as CollectionKind,
    rules: r.kind === "smart" ? parseCollectionRules(r.rules) : undefined,
  }));
}

export async function supabaseSaveCollection(collection: Collection): Promise<void> {
  const userId = await requireUserId();
  const { error } = await sb()
    .from("collections")
    .upsert(
      {
        id: collection.id,
        user_id: userId,
        name: collection.name,
        kind: collection.kind,
        rules: collection.kind === "smart" ? collection.rules ?? null : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,id" },
    );
  if (error) throw error;
}

export async function supabaseLoadCollectionPhotoIds(collectionId: string): Promise<string[]> {
  const userId = await requireUserId();
  const { data, error } = await sb()
    .from("collection_photos")
    .select("photo_id")
    .eq("user_id", userId)
    .eq("collection_id", collectionId)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []).map((r) => r.photo_id as string);
}

export async function supabaseAddPhotoToCollection(collectionId: string, photoId: string): Promise<void> {
  const userId = await requireUserId();
  const { count } = await sb()
    .from("collection_photos")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("collection_id", collectionId);
  const { error } = await sb().from("collection_photos").upsert(
    {
      user_id: userId,
      collection_id: collectionId,
      photo_id: photoId,
      sort_order: count ?? 0,
    },
    { onConflict: "user_id,collection_id,photo_id" },
  );
  if (error) throw error;
}

export async function supabaseRemovePhotoFromCollection(collectionId: string, photoId: string): Promise<void> {
  const userId = await requireUserId();
  const { error } = await sb()
    .from("collection_photos")
    .delete()
    .eq("user_id", userId)
    .eq("collection_id", collectionId)
    .eq("photo_id", photoId);
  if (error) throw error;
}

/**
 * One-shot migrate of legacy browser localStorage + IndexedDB catalog into Supabase,
 * then clear local browser stores so state lives on the account.
 */
export async function migrateBrowserCatalogToSupabase(): Promise<number> {
  const local = loadBrowserCatalog();
  if (!local || (!local.photos.length && !local.presets.length && !local.collections.length)) {
    return 0;
  }
  let migrated = 0;
  for (const photo of local.photos) {
    if (photo.kind === "sample") continue;
    const blob = await loadImageBlob(photo.id);
    const withBlob: Photo = blob
      ? { ...photo, blobUrl: URL.createObjectURL(blob) }
      : photo;
    await supabaseUpsertPhoto(withBlob);
    if (blob) {
      URL.revokeObjectURL(withBlob.blobUrl!);
      await deleteImageBlob(photo.id);
    }
    migrated += 1;
  }
  for (const preset of local.presets) {
    await supabaseSavePreset(preset);
  }
  for (const snap of local.snapshots) {
    await supabaseSaveSnapshot(snap);
  }
  for (const col of local.collections) {
    await supabaseSaveCollection(col);
  }
  for (const link of local.collectionPhotos) {
    await supabaseAddPhotoToCollection(link.collectionId, link.photoId);
  }
  saveBrowserCatalog({
    photos: [],
    presets: [],
    snapshots: [],
    collections: [],
    collectionPhotos: [],
  });
  try {
    localStorage.removeItem("field.catalog.v1");
  } catch {
    /* ignore */
  }
  return migrated;
}
