use serde::Serialize;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::SystemTime;
use tauri::{AppHandle, Manager};
use walkdir::WalkDir;

const BITMAP: &[&str] = &["jpg", "jpeg", "png", "webp"];
const RAW: &[&str] = &["cr2", "cr3", "nef", "arw", "dng", "raf", "orf", "rw2", "raw"];

const PREVIEW_MAX: u32 = 2048;

#[derive(Serialize)]
pub struct ScannedFile {
    pub path: String,
    pub mtime: u64,
    pub kind: String,
}

#[derive(Serialize)]
pub struct DecodedRaw {
    pub width: u32,
    pub height: u32,
    pub rgb: Vec<u8>,
    pub wb_temp: Option<f32>,
    pub wb_tint: Option<f32>,
}

fn ext_kind(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    if BITMAP.iter().any(|e| *e == ext) {
        Some("bitmap")
    } else if RAW.iter().any(|e| *e == ext) {
        Some("raw")
    } else {
        None
    }
}

fn mtime_secs(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn ffprobe_size(path: &str) -> Result<(u32, u32), String> {
    let out = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "csv=p=0:s=x",
            path,
        ])
        .output()
        .map_err(|e| format!("ffprobe failed: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).into_owned());
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut parts = text.trim().split('x');
    let w: u32 = parts
        .next()
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| "ffprobe width missing".to_string())?;
    let h: u32 = parts
        .next()
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| "ffprobe height missing".to_string())?;
    Ok((w, h))
}

fn scaled_dims(src_w: u32, src_h: u32) -> (u32, u32) {
    let max_edge = src_w.max(src_h).max(1);
    let scale = (PREVIEW_MAX as f32 / max_edge as f32).min(1.0);
    (
        ((src_w as f32 * scale).round() as u32).max(1),
        ((src_h as f32 * scale).round() as u32).max(1),
    )
}

#[tauri::command]
fn scan_folder(dir: String) -> Result<Vec<ScannedFile>, String> {
    let root = Path::new(&dir);
    if !root.is_dir() {
        return Err("not a folder".into());
    }
    let mut out = Vec::new();
    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if name.starts_with('.') {
                continue;
            }
        }
        if let Some(kind) = ext_kind(path) {
            out.push(ScannedFile {
                path: path.to_string_lossy().into_owned(),
                mtime: mtime_secs(path),
                kind: kind.into(),
            });
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

#[tauri::command]
fn decode_raw(path: String) -> Result<DecodedRaw, String> {
    if !Path::new(&path).is_file() {
        return Err("file not found".into());
    }
    let (src_w, src_h) = ffprobe_size(&path)?;
    let (w, h) = scaled_dims(src_w, src_h);
    let filter = format!("scale={w}:{h}");
    let out = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            &path,
            "-vf",
            &filter,
            "-pix_fmt",
            "rgb24",
            "-f",
            "rawvideo",
            "pipe:1",
        ])
        .output()
        .map_err(|e| format!("ffmpeg failed: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).into_owned());
    }
    let expected = (w as usize) * (h as usize) * 3;
    if out.stdout.len() != expected {
        return Err(format!(
            "unexpected ffmpeg output (got {}, expected {expected})",
            out.stdout.len()
        ));
    }
    Ok(DecodedRaw {
        width: w,
        height: h,
        rgb: out.stdout,
        wb_temp: None,
        wb_tint: None,
    })
}

#[tauri::command]
fn write_thumb(app: AppHandle, id: String, data: Vec<u8>) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("thumbs");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe: String = id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    let path = dir.join(format!("{safe}.jpg"));
    fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn write_file(path: String, data: Vec<u8>) -> Result<(), String> {
    fs::write(&path, data).map_err(|e| e.to_string())
}

#[tauri::command]
fn file_exists(path: String) -> bool {
    Path::new(&path).is_file()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            scan_folder,
            decode_raw,
            write_thumb,
            write_file,
            file_exists
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
