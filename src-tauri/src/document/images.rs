use std::{fs, io, path::Path};
use tauri::Manager;

pub(super) fn image_file_path(path: &Path) -> io::Result<std::path::PathBuf> {
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
pub(crate) fn allow_image_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    // Empty initial scope: authorize only the referenced image, never a whole
    // document directory or a global filesystem glob. Validate symlink targets.
    let image = image_file_path(Path::new(&path)).map_err(|error| error.to_string())?;
    let scope = app.asset_protocol_scope();
    scope
        .allow_file(&image)
        .map_err(|error| error.to_string())?;
    scope.allow_file(&path).map_err(|error| error.to_string())
}
