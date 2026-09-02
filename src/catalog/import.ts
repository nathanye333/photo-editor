import { analyzePixels, autoWhiteBalance, whiteBalanceFromNeutral } from "../recipe/auto";
import { applyPatch } from "../recipe/patch";
import { bitmapFromBlob, bitmapFromRgb, thumbnailFromBitmap } from "../render/preview";
import { matchLensProfile } from "../render/lensProfiles";
import { decodeRaw, fileExists, fileUrl, isTauri, writeThumb, type ScannedFile } from "../native";
import { parseExif, type ExifData } from "./exif";
import { assignBurstStacks } from "./stacks";
import { storeImageBlob } from "./browserBlobs";
import { emptyPhoto, upsertPhoto } from "./store";
import { fileName, folderOf, photoId, type Photo } from "./types";

function meta(photo: Photo, exif: ExifData = { tags: {} }, tags: Record<string, string> = {}): Photo {
  const merged = {
    file: fileName(photo.path),
    width: String(photo.width || ""),
    height: String(photo.height || ""),
    mtime: photo.mtime ? new Date(photo.mtime * 1000).toISOString() : "",
    ...exif.tags,
    ...tags,
  };
  const profile = matchLensProfile(merged);
  return {
    ...photo,
    exif: merged,
    latitude: exif.latitude ?? photo.latitude,
    longitude: exif.longitude ?? photo.longitude,
    recipe: profile
      ? applyPatch(photo.recipe, { globals: { optics: { profileId: profile.id } } })
      : photo.recipe,
  };
}

/**
 * Raw files carry no baked-in white balance, so seed it: the decoder's own
 * estimate first, then the DNG as-shot neutral, then a grey-world guess from
 * the decoded preview.
 */
function rawWhiteBalance(
  decoded: { rgb: number[] | Uint8Array; wb_temp?: number | null; wb_tint?: number | null },
  exif: ExifData,
): { temp: number; tint: number } | null {
  if (decoded.wb_temp != null || decoded.wb_tint != null) {
    return { temp: decoded.wb_temp ?? 0, tint: decoded.wb_tint ?? 0 };
  }
  if (exif.asShotNeutral) return whiteBalanceFromNeutral(exif.asShotNeutral);
  if (decoded.rgb.length >= 3) return autoWhiteBalance(analyzePixels(decoded.rgb, 3));
  return null;
}

/** EXIF lives in the first few KB; reading the whole raw file would be wasteful. */
const EXIF_HEAD_BYTES = 256 * 1024;

async function readExifTags(blob: Blob): Promise<ExifData> {
  try {
    const head = await blob.slice(0, EXIF_HEAD_BYTES).arrayBuffer();
    return parseExif(new Uint8Array(head));
  } catch {
    return { tags: {} };
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

async function ingestBitmap(photo: Photo, blob: Blob): Promise<Photo> {
  if (!isTauri()) {
    await storeImageBlob(photo.id, blob);
  }
  const bmp = await bitmapFromBlob(blob);
  photo.width = bmp.width;
  photo.height = bmp.height;
  try {
    const thumb = await thumbnailFromBitmap(bmp);
    if (isTauri()) {
      photo.thumbPath = await writeThumb(photo.id, new Uint8Array(await thumb.arrayBuffer()));
    } else {
      photo.thumbDataUrl = await blobToDataUrl(thumb);
      photo.blobUrl = URL.createObjectURL(blob);
    }
  } finally {
    bmp.close();
  }
  const exif = await readExifTags(blob);
  return meta(photo, exif);
}

async function ingestRaw(photo: Photo, path: string): Promise<Photo> {
  if (!isTauri()) return meta(photo);
  const exif = await fetch(fileUrl(path))
    .then((r) => r.blob())
    .then(readExifTags)
    .catch(() => ({ tags: {} }) as ExifData);
  const decoded = await decodeRaw(path);
  photo.width = decoded.width;
  photo.height = decoded.height;
  const bmp = await bitmapFromRgb(decoded.width, decoded.height, new Uint8Array(decoded.rgb));
  try {
    const thumb = await thumbnailFromBitmap(bmp);
    photo.thumbPath = await writeThumb(photo.id, new Uint8Array(await thumb.arrayBuffer()));
    const wb = rawWhiteBalance(decoded, exif);
    if (wb) photo.recipe = applyPatch(photo.recipe, { globals: wb });
  } finally {
    bmp.close();
  }
  return meta(photo, exif);
}

export async function photosFromScanned(existing: Photo[], files: ScannedFile[]): Promise<Photo[]> {
  const have = new Set(existing.filter((p) => !p.masterId).map((p) => p.path));
  const added: Photo[] = [];
  for (const f of files) {
    if (have.has(f.path)) continue;
    const photo = emptyPhoto({
      id: photoId(f.path),
      path: f.path,
      mtime: f.mtime,
      kind: f.kind,
      folder: folderOf(f.path),
    });
    if (f.kind === "raw") {
      try {
        const row = await ingestRaw(photo, f.path);
        added.push(row);
        await upsertPhoto(row);
      } catch {
        const row = meta(photo);
        added.push(row);
        await upsertPhoto(row);
      }
      continue;
    }
    const exists = isTauri() ? await fileExists(f.path) : true;
    if (!exists) {
      photo.missing = true;
      const row = meta(photo);
      added.push(row);
      await upsertPhoto(row);
      continue;
    }
    try {
      const blob = await fetch(fileUrl(f.path)).then((r) => r.blob());
      const row = await ingestBitmap(photo, blob);
      added.push(row);
      await upsertPhoto(row);
    } catch {
      photo.missing = true;
      const row = meta(photo);
      added.push(row);
      await upsertPhoto(row);
    }
  }
  const stackUpdates = assignBurstStacks(existing, added);
  for (const row of stackUpdates) {
    if (!added.some((p) => p.id === row.id)) added.push(row);
    await upsertPhoto(row);
  }
  return added;
}

export async function photosFromFileList(existing: Photo[], list: FileList): Promise<Photo[]> {
  const added: Photo[] = [];
  for (const file of Array.from(list)) {
    if (!/\.(jpe?g|png|webp)$/i.test(file.name)) continue;
    const path = file.webkitRelativePath || file.name;
    const photo = emptyPhoto({
      id: photoId(`${file.name}:${file.size}:${file.lastModified}`),
      path,
      mtime: Math.floor(file.lastModified / 1000),
      kind: "bitmap",
      folder: folderOf(path) || "Import",
    });
    try {
      const row = await ingestBitmap(photo, file);
      added.push(row);
      await upsertPhoto(row);
    } catch {
      photo.missing = true;
      const row = meta(photo);
      added.push(row);
      await upsertPhoto(row);
    }
  }
  const stackUpdates = assignBurstStacks(existing, added);
  for (const row of stackUpdates) {
    if (!added.some((p) => p.id === row.id)) added.push(row);
    await upsertPhoto(row);
  }
  return added;
}

export async function loadRawPreview(path: string) {
  const decoded = await decodeRaw(path);
  return {
    bitmap: await bitmapFromRgb(decoded.width, decoded.height, new Uint8Array(decoded.rgb)),
    width: decoded.width,
    height: decoded.height,
    wbTemp: decoded.wb_temp,
    wbTint: decoded.wb_tint,
  };
}
