use crate::{atomic_write, encode_document, FileEncoding};
use serde::{Deserialize, Serialize};
use std::{
    fs, io,
    path::{Path, PathBuf},
};
use tauri::Manager;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snapshot {
    version: u32,
    id: String,
    path: Option<String>,
    content: String,
    saved_content: String,
    encoding: FileEncoding,
    bom: bool,
    disk_version: String,
    source_mode: bool,
    updated_at: u64,
    #[serde(default)]
    view: Option<serde_json::Value>,
}

#[derive(Default, Serialize)]
pub(crate) struct Listing {
    records: Vec<Snapshot>,
    unreadable: usize,
}

fn record_path(directory: &Path, id: &str) -> io::Result<PathBuf> {
    if id.is_empty() || id.len() > 96 || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid recovery ID",
        ));
    }
    Ok(directory.join(format!("{id}.json")))
}

fn write(directory: &Path, snapshot: &Snapshot) -> io::Result<()> {
    if snapshot.version != 1 || snapshot.updated_at > 253_402_300_799_999 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid recovery metadata",
        ));
    }
    let path = record_path(directory, &snapshot.id)?;
    fs::create_dir_all(directory)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700))?;
    }
    if fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "recovery record is a symlink",
        ));
    }
    atomic_write(&path, &serde_json::to_vec(snapshot)?)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

fn list(directory: &Path) -> io::Result<Listing> {
    let mut listing = Listing::default();
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(listing),
        Err(error) => return Err(error),
    };
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        if path.extension().is_none_or(|ext| ext != "json") {
            continue;
        }
        let record = (|| -> io::Result<Snapshot> {
            if !entry.file_type()?.is_file() {
                return Err(io::Error::other("not a regular record"));
            }
            let record: Snapshot = serde_json::from_slice(&fs::read(&path)?)?;
            if record.version != 1
                || record.updated_at > 253_402_300_799_999
                || record_path(directory, &record.id)? != path
            {
                return Err(io::Error::other("invalid recovery record"));
            }
            Ok(record)
        })();
        match record {
            Ok(record) => {
                // A crash may happen after saving the original but before the
                // renderer removes its backup. Exact bytes already on disk
                // make that old backup redundant, including encoding and BOM.
                let already_saved = record
                    .path
                    .as_deref()
                    .and_then(|path| fs::read(path).ok())
                    .is_some_and(|bytes| {
                        bytes == encode_document(&record.content, record.encoding, record.bom)
                    });
                if already_saved && remove(directory, &record.id).is_ok() {
                    continue;
                }
                listing.records.push(record);
            }
            Err(_) => listing.unreadable += 1,
        }
    }
    listing
        .records
        .sort_by_key(|record| std::cmp::Reverse(record.updated_at));
    Ok(listing)
}

fn remove(directory: &Path, id: &str) -> io::Result<()> {
    match fs::remove_file(record_path(directory, id)?) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("recovery-v1"))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn recovery_write(
    app: tauri::AppHandle,
    snapshot: Snapshot,
) -> Result<(), String> {
    let directory = directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || write(&directory, &snapshot))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn recovery_list(app: tauri::AppHandle) -> Result<Listing, String> {
    let directory = directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || list(&directory))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn recovery_remove(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let directory = directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || remove(&directory, &id))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn records_roundtrip_without_touching_originals_and_keep_corrupt_records() {
        let dir = std::env::temp_dir().join(format!("marknext-recovery-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let original = dir.join("original.md");
        fs::write(&original, "disk").unwrap();
        let record = Snapshot {
            version: 1,
            id: "session-1".into(),
            path: Some(original.to_string_lossy().into()),
            content: "恢复 📝".into(),
            saved_content: "disk".into(),
            encoding: FileEncoding::Utf16Le,
            bom: true,
            disk_version: "base".into(),
            source_mode: true,
            updated_at: 12,
            view: None,
        };
        write(&dir, &record).unwrap();
        let mut updated = record.clone();
        updated.content = "latest".into();
        write(&dir, &updated).unwrap();
        fs::write(dir.join("corrupt.json"), "{").unwrap();
        let records = list(&dir).unwrap();
        assert_eq!(records.records.len(), 1);
        assert_eq!(records.records[0].content, "latest");
        assert_eq!(records.unreadable, 1);
        assert_eq!(fs::read_to_string(original).unwrap(), "disk");
        let original_path = updated.path.as_ref().unwrap();
        fs::write(
            original_path,
            encode_document(&updated.content, updated.encoding, updated.bom),
        )
        .unwrap();
        assert!(list(&dir).unwrap().records.is_empty());
        assert!(!dir.join("session-1.json").exists());
        assert!(write(
            &dir,
            &Snapshot {
                id: "../escape".into(),
                ..record
            }
        )
        .is_err());
        assert!(remove(&dir, "../escape").is_err());
        remove(&dir, "session-1").unwrap();
        remove(&dir, "session-1").unwrap();
        assert!(dir.join("corrupt.json").exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
