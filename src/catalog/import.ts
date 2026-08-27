import { bitmapFromBlob, thumbnailFromBitmap } from "../render/preview";
import { fileExists, fileUrl, isTauri, writeThumb, type ScannedFile } from "../native";
import { emptyPhoto, upsertPhoto } from "./store";
import { fileName, folderOf, photoId, type Photo } from "./types";

function meta(photo: Photo): Photo {
  return {
    ...photo,
    exif: {
      file: fileName(photo.path),
      width: String(photo.width || ""),
      height: String(photo.height || ""),
      mtime: photo.mtime ? new Date(photo.mtime * 1000).toISOString() : "",
    },
  };
}

async function ingestBitmap(photo: Photo, blob: Blob): Promise<Photo> {
  const bmp = await bitmapFromBlob(blob);
  photo.width = bmp.width;
  photo.height = bmp.height;
  try {
    const thumb = await thumbnailFromBitmap(bmp);
    if (isTauri()) {
      photo.thumbPath = await writeThumb(photo.id, new Uint8Array(await thumb.arrayBuffer()));
    }
  } finally {
    bmp.close();
  }
  return meta(photo);
}

export async function photosFromScanned(existing: Photo[], files: ScannedFile[]): Promise<Photo[]> {
  const have = new Set(existing.map((p) => p.path));
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
      const row = meta(photo);
      added.push(row);
      await upsertPhoto(row);
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
  return added;
}

export async function photosFromFileList(list: FileList): Promise<Photo[]> {
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
      blobUrl: URL.createObjectURL(file),
    });
    try {
      added.push(await ingestBitmap(photo, file));
    } catch {
      photo.missing = true;
      added.push(meta(photo));
    }
  }
  return added;
}
