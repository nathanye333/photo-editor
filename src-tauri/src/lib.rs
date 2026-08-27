use serde::Serialize;
use std::fs;
use std::path::Path;
use std::time::SystemTime;
use tauri::{AppHandle, Manager};
use walkdir::WalkDir;

const BITMAP: &[&str] = &["jpg", "jpeg", "png", "webp"];
const RAW: &[&str] = &["cr2", "cr3", "nef", "arw", "dng", "raf", "orf", "rw2", "raw"];

#[derive(Serialize)]
pub struct ScannedFile {
    pub path: String,
    pub mtime: u64,
    pub kind: String,
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
fn write_thumb(app: AppHandle, id: String, data: Vec<u8>) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("thumbs");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe: String = id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').collect();
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
            write_thumb,
            write_file,
            file_exists
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
