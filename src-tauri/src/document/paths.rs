use std::{fs, io, path::Path};

pub(super) fn canonical_document_path_sync(path: &Path) -> io::Result<String> {
    let canonical = match fs::metadata(path) {
        Ok(metadata) => {
            if !metadata.is_file() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "Expected a file path",
                ));
            }
            fs::canonicalize(path)?
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            let name = path
                .file_name()
                .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Missing file name"))?;
            let parent = path
                .parent()
                .filter(|parent| !parent.as_os_str().is_empty())
                .unwrap_or_else(|| Path::new("."));
            fs::canonicalize(parent)?.join(name)
        }
        Err(error) => return Err(error),
    };
    canonical
        .into_os_string()
        .into_string()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "Path is not valid Unicode"))
}

pub(super) fn resolved_write_path(path: &Path) -> io::Result<std::path::PathBuf> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => fs::canonicalize(path),
        Ok(_) => Ok(path.to_path_buf()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(path.to_path_buf()),
        Err(error) => Err(error),
    }
}
