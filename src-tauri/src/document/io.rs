use super::{
    content_version, decode_document, encode_document, resolved_write_path, FileEncoding,
    ReadDocument,
};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

static DOCUMENT_IO_LOCK: Mutex<()> = Mutex::new(());

pub(super) static TEMP_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, serde::Serialize)]
pub(crate) struct FileError {
    pub(super) code: &'static str,
    pub(super) message: String,
    pub(super) version: Option<String>,
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

fn disk_version(path: &Path) -> io::Result<String> {
    match fs::read(path) {
        Ok(bytes) => Ok(content_version(&bytes)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok("missing".to_owned()),
        Err(error) => Err(error),
    }
}

pub(super) fn disk_stamp(path: &Path) -> io::Result<String> {
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

pub(super) fn file_version_sync(path: String) -> Result<String, FileError> {
    let _lock = DOCUMENT_IO_LOCK
        .lock()
        .map_err(|_| io::Error::other("document lock poisoned"))?;
    disk_version(Path::new(&path)).map_err(Into::into)
}

pub(super) fn read_file_sync(
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

pub(super) fn write_file_sync(
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

pub(crate) fn atomic_write(path: &Path, content: &[u8]) -> io::Result<()> {
    checked_atomic_write(path, content, || Ok(())).map_err(|error| io::Error::other(error.message))
}

pub(super) fn checked_atomic_write(
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
