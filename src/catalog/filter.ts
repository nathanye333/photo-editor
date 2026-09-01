import type { Flag } from "../recipe/types";
import { fileName, photoLabel, type ColorLabel, type Photo } from "./types";

export type LibraryFilters = {
  text: string;
  minRating: number;
  flag: Flag | "any";
  camera: string;
  lens: string;
  quickOnly: boolean;
  colorLabel: ColorLabel | "any";
};

export const DEFAULT_LIBRARY_FILTERS: LibraryFilters = {
  text: "",
  minRating: 0,
  flag: "any",
  camera: "",
  lens: "",
  quickOnly: false,
  colorLabel: "any",
};

export type LibrarySort = "filename" | "rating" | "capture" | "mtime";

export function captureTime(photo: Photo): number {
  const raw = photo.exif.DateTimeOriginal ?? photo.exif.CreateDate ?? "";
  const normalized = raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
  const t = Date.parse(normalized);
  return Number.isFinite(t) ? t : photo.mtime * 1000;
}

export function filterPhotos(photos: Photo[], filters: LibraryFilters): Photo[] {
  const q = filters.text.trim().toLowerCase();
  return photos.filter((p) => {
    if (filters.quickOnly && !p.quickCollection) return false;
    if (filters.minRating > 0 && p.rating < filters.minRating) return false;
    if (filters.flag !== "any" && p.flag !== filters.flag) return false;
    if (filters.camera && !(p.exif.Model ?? "").toLowerCase().includes(filters.camera.toLowerCase())) {
      return false;
    }
    if (filters.lens && !(p.exif.LensModel ?? "").toLowerCase().includes(filters.lens.toLowerCase())) {
      return false;
    }
    if (filters.colorLabel !== "any" && p.colorLabel !== filters.colorLabel) return false;
    if (!q) return true;
    const hay = [
      photoLabel(p),
      p.title,
      p.caption,
      p.creator,
      p.copyright,
      ...p.keywords,
      p.exif.Model,
      p.exif.LensModel,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

export function sortPhotos(photos: Photo[], sort: LibrarySort): Photo[] {
  const list = [...photos];
  list.sort((a, b) => {
    switch (sort) {
      case "rating":
        return b.rating - a.rating || fileName(a.path).localeCompare(fileName(b.path));
      case "capture":
        return captureTime(b) - captureTime(a);
      case "mtime":
        return b.mtime - a.mtime;
      default:
        return fileName(a.path).localeCompare(fileName(b.path));
    }
  });
  return list;
}

export function uniqueCameras(photos: Photo[]): string[] {
  return [...new Set(photos.map((p) => p.exif.Model).filter(Boolean) as string[])].sort();
}

export function uniqueLenses(photos: Photo[]): string[] {
  return [...new Set(photos.map((p) => p.exif.LensModel).filter(Boolean) as string[])].sort();
}
