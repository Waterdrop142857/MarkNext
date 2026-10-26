// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

mod recovery;
static DOCUMENT_IO_LOCK: Mutex<()> = Mutex::new(());

static TEMP_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
enum FileEncoding {
    #[serde(rename = "utf-8")]
    Utf8,
    #[serde(rename = "utf-8-bom")]
    Utf8Bom,
    #[serde(rename = "utf-16le")]
    Utf16Le,
    #[serde(rename = "utf-16be")]
    Utf16Be,
}

#[derive(Debug, serde::Serialize)]
struct ReadDocument {
    content: String,
    encoding: FileEncoding,
    bom: bool,
    version: String,
    stamp: String,
}

#[derive(Debug, serde::Serialize)]
struct FileError {
    code: &'static str,
    message: String,
    version: Option<String>,
}

impl From<io::Error> for FileError {
    fn from(error: io::Error) -> Self {
        Self {
            code: "io",
            message: error.to_string(),
            version: None,
        }
    }
}

fn content_version(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn disk_version(path: &Path) -> io::Result<String> {
    match fs::read(path) {
        Ok(bytes) => Ok(content_version(&bytes)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok("missing".to_owned()),
        Err(error) => Err(error),
    }
}

fn disk_stamp(path: &Path) -> io::Result<String> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok("missing".into()),
        Err(error) => return Err(error),
    };
    if !metadata.is_file() {
        return Err(io::Error::other("target is not a file"));
    }
    let stamp = format!(
        "{:?}|{}|{:?}|{:?}",
        fs::canonicalize(path)?,
        metadata.len(),
        metadata.modified()?,
        metadata.created().ok()
    );
    #[cfg(unix)]
    let stamp = {
        use std::os::unix::fs::MetadataExt;
        format!(
            "{stamp}|{}|{}|{}|{}",
            metadata.dev(),
            metadata.ino(),
            metadata.ctime(),
            metadata.ctime_nsec()
        )
    };
    Ok(stamp)
}

#[tauri::command]
async fn file_status(path: String) -> Result<String, FileError> {
    tauri::async_runtime::spawn_blocking(move || disk_stamp(Path::new(&path)))
        .await
        .map_err(|error| io::Error::other(error.to_string()))?
        .map_err(Into::into)
}

#[tauri::command]
async fn file_version(path: String) -> Result<String, FileError> {
    tauri::async_runtime::spawn_blocking(move || file_version_sync(path))
        .await
        .map_err(|error| io::Error::other(error.to_string()))?
}

fn file_version_sync(path: String) -> Result<String, FileError> {
    let _lock = DOCUMENT_IO_LOCK
        .lock()
        .map_err(|_| io::Error::other("document lock poisoned"))?;
    disk_version(Path::new(&path)).map_err(Into::into)
}

fn decode_document(bytes: &[u8], fallback: FileEncoding) -> io::Result<ReadDocument> {
    let version = content_version(bytes);
    if bytes.starts_with(&[0xff, 0xfe, 0, 0]) || bytes.starts_with(&[0, 0, 0xfe, 0xff]) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "UTF-32 is not supported",
        ));
    }
    let (bytes, encoding, bom) = if let Some(text) = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]) {
        (text, FileEncoding::Utf8Bom, true)
    } else if let Some(text) = bytes.strip_prefix(&[0xff, 0xfe]) {
        (text, FileEncoding::Utf16Le, true)
    } else if let Some(text) = bytes.strip_prefix(&[0xfe, 0xff]) {
        (text, FileEncoding::Utf16Be, true)
    } else {
        (
            bytes,
            if fallback == FileEncoding::Utf8Bom {
                FileEncoding::Utf8
            } else {
                fallback
            },
            false,
        )
    };
    let content = match encoding {
        FileEncoding::Utf8 | FileEncoding::Utf8Bom => std::str::from_utf8(bytes)
            .map(str::to_owned)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?,
        FileEncoding::Utf16Le | FileEncoding::Utf16Be => {
            if bytes.len() % 2 != 0 {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "UTF-16 has an incomplete code unit",
                ));
            }
            let units: Vec<u16> = bytes
                .as_chunks::<2>()
                .0
                .iter()
                .map(|unit| {
                    if encoding == FileEncoding::Utf16Le {
                        u16::from_le_bytes(*unit)
                    } else {
                        u16::from_be_bytes(*unit)
                    }
                })
                .collect();
            String::from_utf16(&units)
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?
        }
    };
    Ok(ReadDocument {
        content,
        encoding,
        bom,
        version,
        stamp: String::new(),
    })
}

fn encode_document(content: &str, encoding: FileEncoding, bom: bool) -> Vec<u8> {
    let mut bytes = Vec::new();
    match encoding {
        FileEncoding::Utf8 | FileEncoding::Utf8Bom => {
            if bom || encoding == FileEncoding::Utf8Bom {
                bytes.extend_from_slice(&[0xef, 0xbb, 0xbf]);
            }
            bytes.extend_from_slice(content.as_bytes());
        }
        FileEncoding::Utf16Le | FileEncoding::Utf16Be => {
            if bom {
                bytes.extend_from_slice(if encoding == FileEncoding::Utf16Le {
                    &[0xff, 0xfe]
                } else {
                    &[0xfe, 0xff]
                });
            }
            for unit in content.encode_utf16() {
                bytes.extend_from_slice(&if encoding == FileEncoding::Utf16Le {
                    unit.to_le_bytes()
                } else {
                    unit.to_be_bytes()
                });
            }
        }
    }
    bytes
}

#[tauri::command]
async fn read_file(
    path: String,
    default_encoding: Option<FileEncoding>,
) -> Result<ReadDocument, String> {
    tauri::async_runtime::spawn_blocking(move || read_file_sync(path, default_encoding))
        .await
        .map_err(|error| error.to_string())?
}

fn read_file_sync(
    path: String,
    default_encoding: Option<FileEncoding>,
) -> Result<ReadDocument, String> {
    let _lock = DOCUMENT_IO_LOCK
        .lock()
        .map_err(|_| "document lock poisoned".to_owned())?;
    for _ in 0..3 {
        let before = disk_stamp(Path::new(&path)).map_err(|error| error.to_string())?;
        let bytes = fs::read(&path).map_err(|error| error.to_string())?;
        let after = disk_stamp(Path::new(&path)).map_err(|error| error.to_string())?;
        if before != after {
            continue;
        }
        let mut document = decode_document(&bytes, default_encoding.unwrap_or(FileEncoding::Utf8))
            .map_err(|error| error.to_string())?;
        document.stamp = after;
        return Ok(document);
    }
    Err("The file kept changing while being read".into())
}

fn image_file_path(path: &Path) -> io::Result<std::path::PathBuf> {
    let canonical = fs::canonicalize(path)?;
    let extension = canonical
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !canonical.is_file()
        || !matches!(
            extension.as_str(),
            "avif" | "bmp" | "gif" | "ico" | "jpeg" | "jpg" | "png" | "svg" | "webp"
        )
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "not a supported image file",
        ));
    }
    Ok(canonical)
}

#[tauri::command]
fn allow_image_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    // Empty initial scope: authorize only the referenced image, never a whole
    // document directory or a global filesystem glob. Validate symlink targets.
    let image = image_file_path(Path::new(&path)).map_err(|error| error.to_string())?;
    let scope = app.asset_protocol_scope();
    scope
        .allow_file(&image)
        .map_err(|error| error.to_string())?;
    scope.allow_file(&path).map_err(|error| error.to_string())
}

#[tauri::command]
async fn write_file(
    path: String,
    content: String,
    encoding: Option<FileEncoding>,
    bom: Option<bool>,
    expected_version: String,
) -> Result<String, FileError> {
    tauri::async_runtime::spawn_blocking(move || {
        write_file_sync(path, content, encoding, bom, expected_version)
    })
    .await
    .map_err(|error| io::Error::other(error.to_string()))?
}

fn write_file_sync(
    path: String,
    content: String,
    encoding: Option<FileEncoding>,
    bom: Option<bool>,
    expected_version: String,
) -> Result<String, FileError> {
    let _lock = DOCUMENT_IO_LOCK
        .lock()
        .map_err(|_| io::Error::other("document lock poisoned"))?;
    let encoding = encoding.unwrap_or(FileEncoding::Utf8);
    let bytes = encode_document(
        &content,
        encoding,
        bom.unwrap_or(encoding != FileEncoding::Utf8),
    );
    let path = Path::new(&path);
    let target = resolved_write_path(path)?;
    let check = || {
        let version = disk_version(path)?;
        if version != expected_version || resolved_write_path(path)? != target {
            return Err(FileError {
                code: "conflict",
                message: "The file changed outside MarkNext".to_owned(),
                version: Some(version),
            });
        }
        Ok(())
    };
    checked_atomic_write(path, &bytes, check)?;
    Ok(content_version(&bytes))
}

fn resolved_write_path(path: &Path) -> io::Result<std::path::PathBuf> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => fs::canonicalize(path),
        Ok(_) => Ok(path.to_path_buf()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(path.to_path_buf()),
        Err(error) => Err(error),
    }
}

fn atomic_write(path: &Path, content: &[u8]) -> io::Result<()> {
    checked_atomic_write(path, content, || Ok(())).map_err(|error| io::Error::other(error.message))
}

fn checked_atomic_write(
    path: &Path,
    content: &[u8],
    mut check: impl FnMut() -> Result<(), FileError>,
) -> Result<(), FileError> {
    check()?;
    // Keep an existing symlink intact and replace the file it points to.
    let resolved_path = resolved_write_path(path)?;
    let path = resolved_path.as_path();
    let parent = path
        .parent()
        .filter(|dir| !dir.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let name = path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid file path"))?;
    let existing_permissions = match fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => {
            let permissions = metadata.permissions();
            if permissions.readonly() {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "target file is read-only",
                )
                .into());
            }
            Some(permissions)
        }
        Ok(_) => {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "target is not a file").into())
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.into()),
    };
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let mut temporary = None;
    for _ in 0..32 {
        let sequence = TEMP_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let temp_name = format!(
            ".{}.{}.{}.{}.tmp",
            name.to_string_lossy(),
            std::process::id(),
            stamp,
            sequence
        );
        let temp_path = parent.join(temp_name);
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
        {
            Ok(file) => {
                temporary = Some((temp_path, file));
                break;
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
    let (temp_path, mut temp_file) = temporary.ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::AlreadyExists,
            "could not create a unique temporary file",
        )
    })?;

    let result = (|| {
        temp_file.write_all(content)?;
        if let Some(permissions) = existing_permissions {
            temp_file.set_permissions(permissions)?;
        }
        temp_file.sync_all()?;
        drop(temp_file);
        // Recheck after writing/syncing the temporary file, immediately before
        // replacement. External writers are not locked by this application.
        check()?;
        fs::rename(&temp_path, path)?;
        #[cfg(unix)]
        fs::File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result
}

#[tauri::command]
fn open_devtools(_app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        let window = _app
            .get_webview_window("main")
            .ok_or_else(|| "main webview window not found".to_string())?;
        window.open_devtools();
        Ok(())
    }
    #[cfg(not(debug_assertions))]
    {
        Err("Developer tools are unavailable in release builds".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_file,
            allow_image_file,
            write_file,
            file_version,
            file_status,
            recovery::recovery_list,
            recovery::recovery_write,
            recovery::recovery_remove,
            open_devtools
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{atomic_write, decode_document, encode_document, FileEncoding};
    use std::fs;

    #[test]
    fn encoding_writes_known_bytes_and_bom() {
        assert_eq!(
            encode_document("A中", FileEncoding::Utf8, false),
            "A中".as_bytes()
        );
        assert_eq!(
            encode_document("A中", FileEncoding::Utf8Bom, true),
            [0xef, 0xbb, 0xbf, 0x41, 0xe4, 0xb8, 0xad]
        );
        assert_eq!(
            encode_document("A中", FileEncoding::Utf16Le, true),
            [0xff, 0xfe, 0x41, 0, 0x2d, 0x4e]
        );
        assert_eq!(
            encode_document("A中", FileEncoding::Utf16Be, true),
            [0xfe, 0xff, 0, 0x41, 0x4e, 0x2d]
        );
    }

    #[test]
    fn bom_detection_overrides_default_encoding_and_roundtrips_unicode() {
        for encoding in [
            FileEncoding::Utf8Bom,
            FileEncoding::Utf16Le,
            FileEncoding::Utf16Be,
        ] {
            for content in ["", "# 你好 📝\r\n\n$$\nx²\n$$", "\u{feff}literal BOM"] {
                let bytes = encode_document(content, encoding, true);
                let result = decode_document(&bytes, FileEncoding::Utf8).unwrap();
                assert_eq!(result.content, content);
                assert_eq!(result.encoding, encoding);
                assert!(result.bom);
                assert_eq!(
                    encode_document(&result.content, result.encoding, result.bom),
                    bytes
                );
            }
        }
    }

    #[test]
    fn bomless_documents_use_default_and_keep_bom_absent() {
        for encoding in [
            FileEncoding::Utf8,
            FileEncoding::Utf16Le,
            FileEncoding::Utf16Be,
        ] {
            let bytes = encode_document("中文 📝", encoding, false);
            let result = decode_document(&bytes, encoding).unwrap();
            assert_eq!(result.content, "中文 📝");
            assert_eq!(result.encoding, encoding);
            assert!(!result.bom);
            assert_eq!(
                encode_document(&result.content, result.encoding, result.bom),
                bytes
            );
        }
        let result = decode_document(b"plain", FileEncoding::Utf8Bom).unwrap();
        assert_eq!(result.encoding, FileEncoding::Utf8);
        assert!(!result.bom);
    }

    #[test]
    fn invalid_encoding_fails_without_silent_replacement_characters() {
        for (bytes, fallback) in [
            (vec![0xff], FileEncoding::Utf8),
            (vec![0xff, 0xfe, 0x41], FileEncoding::Utf8),
            (vec![0xfe, 0xff, 0xd8, 0], FileEncoding::Utf8),
            (vec![0, 0xd8], FileEncoding::Utf16Le),
            (vec![0xff, 0xfe, 0, 0, 0x41, 0, 0, 0], FileEncoding::Utf8),
        ] {
            assert!(decode_document(&bytes, fallback).is_err());
        }
    }

    #[test]
    fn native_commands_write_real_encoded_files_and_preserve_bytes_on_roundtrip() {
        let directory =
            std::env::temp_dir().join(format!("marknext-encoding-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        for encoding in [
            FileEncoding::Utf8,
            FileEncoding::Utf8Bom,
            FileEncoding::Utf16Le,
            FileEncoding::Utf16Be,
        ] {
            let file = directory.join(format!("{encoding:?}.md"));
            let path = file.to_str().unwrap().to_owned();
            super::write_file_sync(
                path.clone(),
                "中文 📝".to_owned(),
                Some(encoding),
                None,
                "missing".into(),
            )
            .unwrap();
            let expected = encode_document("中文 📝", encoding, encoding != FileEncoding::Utf8);
            assert_eq!(fs::read(&file).unwrap(), expected);
            let document = super::read_file_sync(path.clone(), None).unwrap();
            assert_eq!(document.content, "中文 📝");
            super::write_file_sync(
                path,
                document.content,
                Some(document.encoding),
                Some(document.bom),
                document.version,
            )
            .unwrap();
            assert_eq!(fs::read(&file).unwrap(), expected);
        }
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn image_authorization_accepts_only_existing_image_files() {
        let directory =
            std::env::temp_dir().join(format!("marknext-image-scope-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let image = directory.join("图片 (1).SVG");
        let text = directory.join("note.md");
        fs::write(&image, "<svg xmlns=\"http://www.w3.org/2000/svg\"/>").unwrap();
        fs::write(&text, "not an image").unwrap();
        assert_eq!(
            super::image_file_path(&image).unwrap(),
            fs::canonicalize(&image).unwrap()
        );
        assert!(super::image_file_path(&text).is_err());
        assert!(super::image_file_path(&directory).is_err());
        assert!(super::image_file_path(&directory.join("missing.png")).is_err());
        #[cfg(unix)]
        {
            let link = directory.join("disguised.png");
            std::os::unix::fs::symlink(&text, &link).unwrap();
            assert!(super::image_file_path(&link).is_err());
        }
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn atomic_write_replaces_content_and_preserves_previous_file_on_error() {
        let directory = std::env::temp_dir().join(format!(
            "marknext-atomic-write-{}-{}",
            std::process::id(),
            super::TEMP_FILE_SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir(&directory).unwrap();
        let file = directory.join("document.md");
        fs::write(&file, "before").unwrap();

        atomic_write(&file, b"after").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "after");

        let original_permissions = fs::metadata(&file).unwrap().permissions();
        let mut permissions = original_permissions.clone();
        permissions.set_readonly(true);
        fs::set_permissions(&file, permissions).unwrap();
        assert!(atomic_write(&file, b"lost").is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), "after");
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);

        fs::set_permissions(&file, original_permissions).unwrap();
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn guarded_saves_reject_changed_deleted_and_newly_created_targets() {
        let dir = std::env::temp_dir().join(format!("marknext-conflict-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("note.md");
        let path = file.to_string_lossy().to_string();
        fs::write(&file, "base").unwrap();
        let baseline = super::file_version_sync(path.clone()).unwrap();
        fs::write(&file, "external").unwrap();
        let error =
            super::write_file_sync(path.clone(), "mine".into(), None, None, baseline.clone())
                .unwrap_err();
        assert_eq!(error.code, "conflict");
        assert_eq!(fs::read_to_string(&file).unwrap(), "external");
        assert!(
            super::write_file_sync(path.clone(), "mine".into(), None, None, "missing".into())
                .is_err()
        );
        fs::remove_file(&file).unwrap();
        assert_eq!(
            super::write_file_sync(path.clone(), "mine".into(), None, None, baseline)
                .unwrap_err()
                .version
                .as_deref(),
            Some("missing")
        );
        let version =
            super::write_file_sync(path.clone(), "mine".into(), None, None, "missing".into())
                .unwrap();
        assert_eq!(version, super::file_version_sync(path).unwrap());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn save_rechecks_after_temporary_write_and_cleans_up_on_conflict() {
        let dir =
            std::env::temp_dir().join(format!("marknext-late-conflict-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("note.md");
        fs::write(&file, "base").unwrap();
        let mut checks = 0;
        let error = super::checked_atomic_write(&file, b"mine", || {
            checks += 1;
            if checks == 2 {
                fs::write(&file, "late external edit")?;
                return Err(super::FileError {
                    code: "conflict",
                    message: "changed".into(),
                    version: None,
                });
            }
            Ok(())
        })
        .unwrap_err();
        assert_eq!(error.code, "conflict");
        assert_eq!(fs::read_to_string(file).unwrap(), "late external edit");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir_all(dir).unwrap();
    }
}
