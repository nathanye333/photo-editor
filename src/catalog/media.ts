import { fileUrl, isTauri } from "../native";
import type { Photo } from "./types";

export function photoPreviewSrc(photo: Photo): string | undefined {
  if (photo.blobUrl) return photo.blobUrl;
  if (isTauri() && photo.kind === "bitmap" && !photo.missing) return fileUrl(photo.path);
  return undefined;
}

export function photoThumbSrc(photo: Photo): string | undefined {
  if (photo.blobUrl) return photo.blobUrl;
  if (photo.thumbDataUrl) return photo.thumbDataUrl;
  if (photo.thumbPath && isTauri()) return fileUrl(photo.thumbPath);
  return photoPreviewSrc(photo);
}

/** Best available preview for loupe / survey (full file when possible). */
export function photoDisplaySrc(photo: Photo): string | undefined {
  return photoPreviewSrc(photo) ?? photoThumbSrc(photo);
}
