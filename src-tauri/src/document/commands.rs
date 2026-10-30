use super::{
    canonical_document_path_sync, disk_stamp, file_version_sync, read_file_sync, write_file_sync,
    FileEncoding, FileError, ReadDocument,
};
use std::{io, path::Path};

#[tauri::command]
pub(crate) async fn file_status(path: String) -> Result<String, FileError> {
    tauri::async_runtime::spawn_blocking(move || disk_stamp(Path::new(&path)))
        .await
        .map_err(|error| io::Error::other(error.to_string()))?
        .map_err(Into::into)
}

#[tauri::command]
pub(crate) async fn file_version(path: String) -> Result<String, FileError> {
    tauri::async_runtime::spawn_blocking(move || file_version_sync(path))
        .await
        .map_err(|error| io::Error::other(error.to_string()))?
}

#[tauri::command]
pub(crate) async fn read_file(
    path: String,
    default_encoding: Option<FileEncoding>,
) -> Result<ReadDocument, String> {
    tauri::async_runtime::spawn_blocking(move || read_file_sync(path, default_encoding))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn canonical_document_path(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        canonical_document_path_sync(Path::new(&path)).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn write_file(
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
