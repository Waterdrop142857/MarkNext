//! Native PDF output. A disposable WebView renders a frozen document; the
//! document controller and editor histories never participate in PDF writes.
#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
mod options;
mod output;
#[cfg(windows)]
mod windows;

use options::PdfOptions;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    time::Duration,
};
use tauri::{Manager, WebviewUrl, WebviewWindow};

type Completion = Arc<Mutex<Option<mpsc::Sender<Result<(), String>>>>>;
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PdfPayload {
    markdown: String,
    title: String,
    source_path: Option<String>,
    font_family: String,
    code_font_family: String,
    font_size: f64,
    options: PdfOptions,
}

#[derive(Clone)]
struct Job {
    label: String,
    payload: Arc<PdfPayload>,
    temporary_pdf: PathBuf,
    completion: Completion,
    printing: bool,
}

#[derive(Default)]
pub(crate) struct PdfExports(Mutex<Option<Job>>);

pub(crate) fn cancel_for_main(app: &tauri::AppHandle) {
    let job = app
        .state::<PdfExports>()
        .0
        .lock()
        .ok()
        .and_then(|guard| guard.clone());
    if let Some(job) = job {
        complete(
            &job.completion,
            Err("The application window was closed".into()),
        );
        if let Some(view) = app.get_webview_window(&job.label) {
            let _ = view.destroy();
        }
    }
}

fn complete(completion: &Completion, result: Result<(), String>) {
    if let Ok(mut sender) = completion.lock() {
        if let Some(sender) = sender.take() {
            let _ = sender.send(result);
        }
    }
}

struct TemporaryExport(PathBuf);
impl TemporaryExport {
    fn new(label: &str) -> Result<Self, String> {
        let root = std::env::temp_dir().join(format!("marknext-{label}"));
        fs::create_dir(&root).map_err(|error| error.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Err(error) = fs::set_permissions(&root, fs::Permissions::from_mode(0o700)) {
                let _ = fs::remove_dir(&root);
                return Err(error.to_string());
            }
        }
        Ok(Self(root))
    }
}
impl Drop for TemporaryExport {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn main_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != crate::window_instance::MAIN_WINDOW {
        return Err("PDF export must be requested by the main window".into());
    }
    Ok(())
}

fn export_navigation_allowed(app_url: &tauri::Url, url: &tauri::Url) -> bool {
    // Custom app schemes have opaque URL origins. Compare their components,
    // rather than comparing fresh opaque identities that are never equal.
    url.scheme() == app_url.scheme()
        && url.host_str() == app_url.host_str()
        && url.port_or_known_default() == app_url.port_or_known_default()
        && url.path() == "/pdf-export.html"
}

fn export_job(window: &WebviewWindow) -> Result<Job, String> {
    window
        .state::<PdfExports>()
        .0
        .lock()
        .map_err(|_| "PDF export state is unavailable".to_owned())?
        .as_ref()
        .filter(|job| job.label == window.label())
        .cloned()
        .ok_or_else(|| "This window does not own a PDF export".to_owned())
}

#[tauri::command]
pub(crate) fn pdf_export_payload(window: WebviewWindow) -> Result<PdfPayload, String> {
    Ok((*export_job(&window)?.payload).clone())
}

#[tauri::command]
pub(crate) fn pdf_export_ready(window: WebviewWindow, error: Option<String>) -> Result<(), String> {
    let job = {
        let state = window.state::<PdfExports>();
        let mut guard = state
            .0
            .lock()
            .map_err(|_| "PDF export state is unavailable")?;
        let job = guard
            .as_mut()
            .filter(|job| job.label == window.label())
            .ok_or("This window does not own a PDF export")?;
        if let Some(error) = error {
            complete(&job.completion, Err(error));
            return Ok(());
        }
        if job.printing {
            return Err("PDF printing has already started".into());
        }
        job.printing = true;
        job.clone()
    };
    let completion = job.completion.clone();
    let result = window.with_webview(move |view| {
        #[cfg(target_os = "linux")]
        linux::print(view, job);
        #[cfg(target_os = "macos")]
        macos::print(view, job);
        #[cfg(windows)]
        windows::print(view, job);
        #[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
        complete(
            &job.completion,
            Err("PDF export is unavailable on this platform".into()),
        );
    });
    if let Err(error) = result {
        complete(&completion, Err(error.to_string()));
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn export_pdf(
    window: WebviewWindow,
    path: String,
    payload: PdfPayload,
) -> Result<(), String> {
    main_window(&window)?;
    let app_url = window.url().map_err(|error| error.to_string())?;
    payload.options.validate()?;
    if !payload.font_size.is_finite()
        || !(8.0..=96.0).contains(&payload.font_size)
        || payload.font_family.len() > 2048
        || payload.code_font_family.len() > 2048
    {
        return Err("Invalid PDF font settings".into());
    }
    let target = Path::new(&path);
    if !target.is_absolute()
        || !target
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
    {
        return Err("Choose an absolute PDF file path".into());
    }
    let output_path = PathBuf::from(&path);
    let source = payload.source_path.clone();
    let output = tauri::async_runtime::spawn_blocking(move || {
        output::OutputTarget::new(output_path, source.as_deref())
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())?;
    let label = format!(
        "pdf-export-{}-{}-{}",
        std::process::id(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_nanos()
    );
    let temporary = TemporaryExport::new(&label)?;
    let temporary_pdf = temporary.0.join("document.pdf");
    let (sender, receiver) = mpsc::channel();
    let completion = Arc::new(Mutex::new(Some(sender)));
    let job = Job {
        label: label.clone(),
        payload: Arc::new(payload),
        temporary_pdf: temporary_pdf.clone(),
        completion: completion.clone(),
        printing: false,
    };
    {
        let state = window.state::<PdfExports>();
        let mut guard = state
            .0
            .lock()
            .map_err(|_| "PDF export state is unavailable")?;
        if guard.is_some() {
            return Err("A PDF export is already running".into());
        }
        *guard = Some(job);
    }
    let builder = tauri::WebviewWindowBuilder::new(
        window.app_handle(),
        &label,
        WebviewUrl::App("pdf-export.html".into()),
    )
    .title("MarkNext PDF export")
    .inner_size(1100.0, 800.0)
    .visible(false)
    .focused(false)
    .skip_taskbar(true)
    .disable_drag_drop_handler()
    .on_navigation(move |url| export_navigation_allowed(&app_url, url));
    let view = builder.build();
    let result = match &view {
        Err(error) => Err(error.to_string()),
        Ok(view) => {
            let destroyed = completion.clone();
            view.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::Destroyed) {
                    complete(&destroyed, Err("PDF export window was closed".into()));
                }
            });
            tauri::async_runtime::spawn_blocking(move || {
                receiver
                    .recv_timeout(Duration::from_secs(120))
                    .map_err(|_| "PDF export timed out".to_owned())?
            })
            .await
            .map_err(|error| error.to_string())
            .and_then(|result| result)
        }
    };
    // Discard any late completion before releasing the job and temporary files.
    complete(&completion, Err("PDF export ended".into()));
    if let Ok(view) = view {
        let _ = view.destroy();
    }
    let written = if result.is_ok() {
        tauri::async_runtime::spawn_blocking(move || {
            let bytes = fs::read(&temporary_pdf).map_err(|error| error.to_string())?;
            if !bytes.starts_with(b"%PDF-") {
                return Err("The print engine did not produce a PDF".into());
            }
            output.write(&bytes).map_err(|error| error.to_string())
        })
        .await
        .map_err(|error| error.to_string())
        .and_then(|result| result)
    } else {
        result
    };
    if let Ok(mut guard) = window.state::<PdfExports>().0.lock() {
        if guard.as_ref().is_some_and(|job| job.label == label) {
            *guard = None;
        }
    }
    drop(temporary);
    written
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pdf_export_navigation_accepts_the_local_shell_in_dev_and_packaged_apps() {
        for base in [
            "http://localhost:1420/",
            "http://tauri.localhost/",
            "tauri://localhost/",
        ] {
            let base = tauri::Url::parse(base).unwrap();
            assert!(export_navigation_allowed(
                &base,
                &base.join("pdf-export.html").unwrap()
            ));
            assert!(!export_navigation_allowed(
                &base,
                &base.join("index.html").unwrap()
            ));
            assert!(!export_navigation_allowed(
                &base,
                &tauri::Url::parse("https://example.test/pdf-export.html").unwrap()
            ));
        }
    }
}
