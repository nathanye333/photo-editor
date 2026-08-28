import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export type ScannedFile = {
  path: string;
  mtime: number;
  kind: "bitmap" | "raw";
};

export type DecodedRaw = {
  width: number;
  height: number;
  rgb: number[];
  wb_temp: number | null;
  wb_tint: number | null;
};

export async function decodeRaw(path: string): Promise<DecodedRaw> {
  return invoke("decode_raw", { path });
}

export async function pickFolder(): Promise<string | null> {
  const dir = await open({ directory: true, multiple: false });
  return typeof dir === "string" ? dir : null;
}

export async function pickSaveJpeg(defaultName: string): Promise<string | null> {
  const path = await save({
    defaultPath: defaultName,
    filters: [{ name: "JPEG", extensions: ["jpg", "jpeg"] }],
  });
  return typeof path === "string" ? path : null;
}

export async function scanFolder(dir: string): Promise<ScannedFile[]> {
  return invoke("scan_folder", { dir });
}

export async function writeThumb(id: string, data: Uint8Array): Promise<string> {
  return invoke("write_thumb", { id, data: Array.from(data) });
}

export async function writeFileBytes(path: string, data: Uint8Array): Promise<void> {
  await invoke("write_file", { path, data: Array.from(data) });
}

export async function fileExists(path: string): Promise<boolean> {
  return invoke("file_exists", { path });
}

export function fileUrl(path: string): string {
  return convertFileSrc(path);
}
