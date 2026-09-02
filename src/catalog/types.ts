import type { EditRecipe, Flag } from "../recipe/types";
import type { RecipeHistory } from "../recipe/history";

export type PhotoKind = "bitmap" | "raw" | "sample";

export type ColorLabel = "red" | "yellow" | "green" | "blue" | "purple";

export type Photo = {
  id: string;
  path: string;
  mtime: number;
  width: number;
  height: number;
  exif: Record<string, string>;
  rating: number;
  flag: Flag;
  recipe: EditRecipe;
  history: RecipeHistory;
  folder: string;
  thumbPath?: string;
  /** Persisted JPEG thumb for browser reload (data URL). */
  thumbDataUrl?: string;
  blobUrl?: string;
  kind: PhotoKind;
  missing?: boolean;
  /** Set on virtual copies; points at the master photo id. */
  masterId?: string;
  /** Display suffix for virtual copies, e.g. "Copy 1". */
  copyName?: string;
  keywords: string[];
  colorLabel: ColorLabel | null;
  title: string;
  caption: string;
  copyright: string;
  creator: string;
  quickCollection: boolean;
  /** Burst/bracket stack id; masters in the same stack share this. */
  stackId?: string;
  /** Position within stack (0 = cover). */
  stackIndex?: number;
  latitude?: number;
  longitude?: number;
};

export type CatalogFields = Pick<
  Photo,
  "rating" | "flag" | "keywords" | "colorLabel" | "title" | "caption" | "copyright" | "creator" | "quickCollection"
>;

export type Preset = {
  id: string;
  name: string;
  recipe: EditRecipe;
};

export type RecipeSnapshot = {
  id: string;
  photoId: string;
  name: string;
  recipe: EditRecipe;
  createdAt: number;
};

export type CollectionKind = "manual" | "smart";

export type Collection = {
  id: string;
  name: string;
  kind: CollectionKind;
  /** Rule filters for smart collections. */
  rules?: import("./filter").LibraryFilters;
};

export function photoId(path: string): string {
  let h = 2166136261;
  for (let i = 0; i < path.length; i++) {
    h ^= path.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `p_${(h >>> 0).toString(16)}`;
}

export function folderOf(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut >= 0 ? path.slice(0, cut) : path;
}

export function fileName(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut >= 0 ? path.slice(cut + 1) : path;
}

export function photoLabel(photo: Photo): string {
  const base = fileName(photo.path);
  return photo.copyName ? `${base} · ${photo.copyName}` : base;
}

export function isMasterPhoto(photo: Photo): boolean {
  return !photo.masterId;
}
