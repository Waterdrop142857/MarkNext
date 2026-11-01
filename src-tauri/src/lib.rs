mod app;
mod document;
#[cfg(target_os = "linux")]
mod linux_file_drop;
mod recovery;
mod window_instance;

pub use app::run;
