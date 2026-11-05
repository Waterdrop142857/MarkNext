mod app;
mod document;
mod document_export;
#[cfg(target_os = "linux")]
mod linux_file_drop;
mod recovery;
mod window_instance;

pub use app::run;
