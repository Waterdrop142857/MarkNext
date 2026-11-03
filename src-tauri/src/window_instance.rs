use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

pub const MAIN_WINDOW: &str = "main";
pub const OPEN_EVENT: &str = "open-files-available";
const STARTUP_FAILURE_SCRIPT: &str = r#"
if (window.__MARKNEXT_STARTUP__) {
    window.__MARKNEXT_STARTUP__.fail();
} else {
    document.documentElement.style.cssText = 'background:#1e1e1e;color:#ddd;font:16px system-ui';
    const body = document.body || document.documentElement.appendChild(document.createElement('body'));
    body.innerHTML = '<main style="padding:32px"><h1>MarkNext</h1><p>Startup failed / 启动失败</p><button onclick="location.reload()">Reload / 重新加载</button></main>';
}
"#;

#[derive(Clone, Debug, serde::Serialize, PartialEq, Eq)]
pub struct OpenRequest {
    id: u64,
    paths: Vec<String>,
}

#[derive(Default)]
struct Queue {
    next_id: u64,
    requests: VecDeque<OpenRequest>,
}

#[derive(Default)]
struct StartupGate {
    generation: u64,
    ready: bool,
    revealed: bool,
    failed: bool,
}

impl StartupGate {
    fn begin(&mut self) -> u64 {
        self.generation += 1;
        self.ready = false;
        self.revealed = false;
        self.failed = false;
        self.generation
    }
    fn ready(&mut self, generation: u64) -> bool {
        if self.generation != generation {
            return false;
        }
        self.ready = true;
        true
    }
    fn can_show(&self) -> bool {
        self.ready || self.revealed
    }
    fn needs_fallback(&self, generation: u64) -> bool {
        self.generation == generation && !self.revealed
    }
}

/// Requests live independently of the WebView. Notifications are only wakeups;
/// opening a window or registering an event listener never consumes a request.
#[derive(Default)]
pub struct WindowInstance {
    queue: Mutex<Queue>,
    startup: Mutex<StartupGate>,
}

impl WindowInstance {
    pub fn cancel_failed_startup_requests(&self) {
        // Closing a startup error page cancels unhandled open requests, not
        // document drafts. Otherwise ExitRequested would keep recreating it.
        if self.startup.lock().map(|gate| gate.failed).unwrap_or(false) {
            if let Ok(mut queue) = self.queue.lock() {
                queue.requests.clear();
            }
        }
    }
    pub fn enqueue(&self, paths: Vec<String>) -> Result<u64, String> {
        let mut queue = self
            .queue
            .lock()
            .map_err(|_| "open request lock poisoned")?;
        queue.next_id += 1;
        let id = queue.next_id;
        queue.requests.push_back(OpenRequest { id, paths });
        Ok(id)
    }

    fn enqueue_drop(&self, paths: Vec<String>) -> Result<bool, String> {
        if paths.is_empty() {
            return Ok(false);
        }
        let mut queue = self
            .queue
            .lock()
            .map_err(|_| "open request lock poisoned")?;
        // A WebView may deliver both native and DOM drops. Pending duplicates
        // share the same request; later intentional drops still activate tabs.
        if queue.requests.iter().any(|request| request.paths == paths) {
            return Ok(false);
        }
        queue.next_id += 1;
        let id = queue.next_id;
        queue.requests.push_back(OpenRequest { id, paths });
        Ok(true)
    }

    fn pending(&self) -> Result<Vec<OpenRequest>, String> {
        self.queue
            .lock()
            .map(|queue| queue.requests.iter().cloned().collect())
            .map_err(|_| "open request lock poisoned".into())
    }

    fn acknowledge(&self, id: u64) -> Result<(), String> {
        let mut queue = self
            .queue
            .lock()
            .map_err(|_| "open request lock poisoned")?;
        queue.requests.retain(|request| request.id != id);
        Ok(())
    }

    pub fn has_pending(&self) -> bool {
        self.queue
            .lock()
            .map(|queue| !queue.requests.is_empty())
            .unwrap_or(true)
    }
}

/// The first argv item is the executable, not a document. Relative paths are
/// resolved against the sending process's cwd, not the existing instance's.
pub fn paths_from_args(args: impl IntoIterator<Item = String>, cwd: &Path) -> Vec<String> {
    let mut literal = false;
    let mut arguments = args.into_iter().skip(1).peekable();
    let mut paths = Vec::new();
    while let Some(argument) = arguments.next() {
        // `tauri dev` can append Cargo's color option after the document.
        // Its value is launcher metadata, not another path to open.
        if !literal && argument == "--color" {
            if matches!(
                arguments.peek().map(String::as_str),
                Some("auto" | "always" | "never")
            ) {
                arguments.next();
            }
            continue;
        }
        let path = (|| {
            if argument == "--" && !literal {
                literal = true;
                return None;
            }
            if argument.is_empty() || (!literal && argument.starts_with('-')) {
                return None;
            }
            if argument.starts_with("file://") {
                return tauri::Url::parse(&argument)
                    .ok()?
                    .to_file_path()
                    .ok()?
                    .into_os_string()
                    .into_string()
                    .ok();
            }
            // The editor opens local files; URLs must not turn into network reads.
            if argument.contains("://") {
                return None;
            }
            let path = PathBuf::from(argument);
            let absolute = if path.is_absolute() {
                path
            } else {
                cwd.join(path)
            };
            absolute.into_os_string().into_string().ok()
        })();
        if let Some(path) = path {
            paths.push(path);
        }
    }
    paths
}

/// Only completed native document drops become open requests. Tauri removes
/// installer file associations from its generated runtime config, so they
/// cannot be used as the application's document-format policy.
pub fn paths_from_drop(event: &tauri::DragDropEvent) -> Vec<String> {
    let tauri::DragDropEvent::Drop { paths, .. } = event else {
        return Vec::new();
    };
    filter_dropped_paths(paths)
}

fn filter_dropped_paths(paths: &[PathBuf]) -> Vec<String> {
    paths
        .iter()
        .filter(|path| {
            path.is_absolute()
                && !path.is_dir()
                && path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .is_some_and(|ext| {
                        crate::document::DOCUMENT_EXTENSIONS
                            .iter()
                            .any(|supported| supported.eq_ignore_ascii_case(ext))
                    })
        })
        .filter_map(|path| path.to_str().map(str::to_owned))
        .collect()
}

pub(crate) fn paths_from_drop_inputs(inputs: &[String]) -> Vec<String> {
    let paths = inputs
        .iter()
        .filter_map(|value| {
            if value
                .get(..5)
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case("file:"))
            {
                let url = tauri::Url::parse(value).ok()?;
                if url.query().is_some() || url.fragment().is_some() {
                    return None;
                }
                url.to_file_path().ok()
            } else {
                Some(PathBuf::from(value))
            }
        })
        .collect::<Vec<_>>();
    filter_dropped_paths(&paths)
}

pub fn deliver_drop(app: &tauri::AppHandle, event: &tauri::DragDropEvent) {
    let paths = paths_from_drop(event);
    let _ = queue_drop(app, paths);
}

pub(crate) fn queue_drop(app: &tauri::AppHandle, paths: Vec<String>) -> Result<(), String> {
    if app.state::<WindowInstance>().enqueue_drop(paths)? {
        let _ = app.emit_to(MAIN_WINDOW, OPEN_EVENT, ());
        focus_main(app, false);
    }
    Ok(())
}

#[tauri::command]
pub fn queue_dropped_files(
    app: tauri::AppHandle,
    window: tauri::Window,
    paths: Vec<String>,
) -> Result<(), String> {
    if window.label() != MAIN_WINDOW {
        return Err("File drops require the main window".into());
    }
    let paths = paths_from_drop_inputs(&paths);
    queue_drop(&app, paths)
}

pub fn focus_main(app: &tauri::AppHandle, create: bool) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let window = handle.get_webview_window(MAIN_WINDOW).or_else(|| {
            if !create {
                return None;
            }
            let config = handle
                .config()
                .app
                .windows
                .iter()
                .find(|config| config.label == MAIN_WINDOW)?;
            tauri::WebviewWindowBuilder::from_config(&handle, config)
                .ok()?
                .build()
                .ok()
        });
        if let Some(window) = window {
            // A second launch/reopen must not reveal an unpainted WebView.
            if !handle
                .state::<WindowInstance>()
                .startup
                .lock()
                .map(|gate| gate.can_show())
                .unwrap_or(false)
            {
                return;
            }
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    });
}

/// Arm a generation-specific watchdog for every navigation, including recreated
/// main windows. A failed module load must not leave an invisible process.
pub fn begin_startup(app: &tauri::AppHandle) {
    let generation = match app.state::<WindowInstance>().startup.lock() {
        Ok(mut gate) => gate.begin(),
        Err(_) => return,
    };
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.hide();
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(8));
        let app = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            let state = app.state::<WindowInstance>();
            let mut gate = match state.startup.lock() {
                Ok(gate) => gate,
                Err(_) => return,
            };
            if !gate.needs_fallback(generation) {
                return;
            }
            if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
                if !gate.ready {
                    gate.failed = true;
                    let _ = window.eval(STARTUP_FAILURE_SCRIPT);
                }
                if window.show().is_ok() {
                    gate.revealed = true;
                }
            }
        });
    });
}

pub fn invalidate_startup(app: &tauri::AppHandle) {
    if let Ok(mut gate) = app.state::<WindowInstance>().startup.lock() {
        gate.begin();
    }
}

#[tauri::command]
pub fn startup_generation(state: tauri::State<'_, WindowInstance>) -> Result<u64, String> {
    state
        .startup
        .lock()
        .map(|gate| gate.generation)
        .map_err(|_| "startup lock poisoned".into())
}

#[tauri::command]
pub fn startup_ready(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, WindowInstance>,
    generation: u64,
    dark: bool,
    failed: bool,
) -> Result<(), String> {
    if window.label() != MAIN_WINDOW {
        return Err("Unexpected startup window".into());
    }
    {
        let mut gate = state.startup.lock().map_err(|_| "startup lock poisoned")?;
        if !gate.ready(generation) {
            return Err("Stale startup generation".into());
        }
        gate.failed = failed;
    }
    let background = if dark {
        tauri::utils::config::Color(30, 30, 30, 255)
    } else {
        tauri::utils::config::Color(245, 245, 245, 255)
    };
    let _ = window.set_background_color(Some(background));
    window.show().map_err(|error| error.to_string())?;
    let _ = window.unminimize();
    let _ = window.set_focus();
    let mut gate = state.startup.lock().map_err(|_| "startup lock poisoned")?;
    if gate.generation == generation {
        gate.revealed = true;
    }
    Ok(())
}

pub fn deliver(app: &tauri::AppHandle, paths: Vec<String>) {
    if app.state::<WindowInstance>().enqueue(paths).is_ok() {
        let _ = app.emit_to(MAIN_WINDOW, OPEN_EVENT, ());
    }
    focus_main(app, false);
}

#[tauri::command]
pub fn pending_open_requests(
    state: tauri::State<'_, WindowInstance>,
) -> Result<Vec<OpenRequest>, String> {
    state.pending()
}

#[tauri::command]
pub fn acknowledge_open_request(
    id: u64,
    state: tauri::State<'_, WindowInstance>,
) -> Result<(), String> {
    state.acknowledge(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_gate_blocks_early_focus_and_rejects_old_windows_and_watchdogs() {
        let mut gate = StartupGate::default();
        let first = gate.begin();
        assert!(!gate.can_show());
        assert!(gate.needs_fallback(first));
        assert!(gate.ready(first));
        assert!(gate.can_show());
        gate.revealed = true;
        assert!(!gate.needs_fallback(first));
        let next = gate.begin();
        assert!(!gate.ready(first));
        assert!(!gate.needs_fallback(first));
        assert!(!gate.can_show());
        assert!(gate.needs_fallback(next));
        gate.revealed = true; // A watchdog error surface remains focusable.
        assert!(gate.can_show());
    }

    #[test]
    fn closing_a_failed_startup_cancels_pending_opens_without_affecting_healthy_delivery() {
        let instance = WindowInstance::default();
        instance.enqueue(vec!["/pending.md".into()]).unwrap();
        instance.cancel_failed_startup_requests();
        assert!(instance.has_pending());
        instance.startup.lock().unwrap().failed = true;
        instance.cancel_failed_startup_requests();
        assert!(!instance.has_pending());
        instance.startup.lock().unwrap().begin();
        instance.enqueue(vec!["/next.md".into()]).unwrap();
        instance.cancel_failed_startup_requests();
        assert!(instance.has_pending());
    }

    #[test]
    fn requests_survive_frontend_startup_and_only_exact_acknowledgements_remove_them() {
        let instance = WindowInstance::default();
        let first = instance.enqueue(vec!["/first.md".into()]).unwrap();
        let second = instance.enqueue(vec!["/second.md".into()]).unwrap();
        assert_eq!(instance.pending().unwrap().len(), 2);
        assert_eq!(instance.pending().unwrap().len(), 2);
        instance.acknowledge(first).unwrap();
        assert_eq!(instance.pending().unwrap()[0].id, second);
        instance.acknowledge(first).unwrap();
        assert!(instance.has_pending());
        instance.acknowledge(second).unwrap();
        assert!(!instance.has_pending());
    }

    #[test]
    fn parses_relative_paths_spaces_unicode_flags_and_literal_dash_names() {
        let cwd = std::env::temp_dir();
        let args = vec![
            "marknext",
            "--unknown",
            "draft with spaces.md",
            "中文.md",
            "--",
            "-literal.md",
        ];
        let paths = paths_from_args(args.into_iter().map(String::from), &cwd);
        assert_eq!(
            paths,
            ["draft with spaces.md", "中文.md", "-literal.md"].map(|name| cwd
                .join(name)
                .to_str()
                .unwrap()
                .to_owned())
        );
    }

    #[test]
    fn parses_file_urls_without_losing_hashes_or_spaces_and_ignores_web_urls() {
        let file = std::env::temp_dir().join("文档 # 1.md");
        let uri = tauri::Url::from_file_path(&file).unwrap();
        let paths = paths_from_args(
            vec![
                "marknext".into(),
                uri.to_string(),
                "https://example.com/test.md".into(),
            ],
            Path::new("."),
        );
        assert_eq!(paths, vec![file.to_str().unwrap().to_owned()]);
    }

    #[test]
    fn dev_launcher_color_values_do_not_become_phantom_files() {
        let cwd = std::env::temp_dir();
        let document = cwd.join("MARKTEXT_WYSIWYG_CORE.md");
        for color in ["always", "auto", "never"] {
            let paths = paths_from_args(
                [
                    "target/debug/marknext".to_owned(),
                    document.to_str().unwrap().to_owned(),
                    "--no-default-features".to_owned(),
                    "--color".to_owned(),
                    color.to_owned(),
                    "--".to_owned(),
                ],
                &cwd,
            );
            assert_eq!(paths, vec![document.to_str().unwrap().to_owned()]);
        }
    }

    #[test]
    fn color_option_does_not_consume_documents_or_literal_names() {
        let cwd = std::env::temp_dir();
        let paths = paths_from_args(
            ["marknext", "--color", "notes.md", "--", "--color", "always"].map(String::from),
            &cwd,
        );
        assert_eq!(
            paths,
            ["notes.md", "--color", "always"].map(|name| cwd
                .join(name)
                .to_str()
                .unwrap()
                .to_owned())
        );
    }

    #[test]
    fn document_drop_works_with_the_actual_generated_tauri_context() {
        let context: tauri::Context<tauri::Wry> = tauri::generate_context!();
        // This is intentionally the generated context, not tauri.conf.json:
        // Tauri strips installer metadata while producing this runtime value.
        assert!(context.config().bundle.file_associations.is_none());
        let file = std::env::temp_dir().join("generated-context.MD");
        let event = tauri::DragDropEvent::Drop {
            paths: vec![file.clone()],
            position: tauri::PhysicalPosition::new(0.0, 0.0),
        };
        assert_eq!(
            paths_from_drop(&event),
            vec![file.to_str().unwrap().to_owned()]
        );
        assert_eq!(
            paths_from_drop_inputs(&[tauri::Url::from_file_path(&file).unwrap().to_string()]),
            vec![file.to_str().unwrap().to_owned()]
        );
    }

    #[test]
    fn native_document_drop_uses_supported_formats_and_preserves_paths() {
        let cwd = std::env::temp_dir();
        let documents = ["文档 # 1.MD", "second.MarkDown", "third.TXT"].map(|name| cwd.join(name));
        let event = tauri::DragDropEvent::Drop {
            paths: documents
                .iter()
                .cloned()
                .chain([
                    cwd.join("image.png"),
                    cwd.join("archive.md.zip"),
                    cwd.join("no-extension"),
                    PathBuf::from("relative.md"),
                ])
                .collect(),
            position: tauri::PhysicalPosition::new(10.0, 20.0),
        };
        let paths = paths_from_drop(&event);
        assert_eq!(
            paths,
            documents.map(|path| path.to_str().unwrap().to_owned())
        );
        let instance = WindowInstance::default();
        let id = instance.enqueue(paths.clone()).unwrap();
        assert_eq!(instance.pending().unwrap(), vec![OpenRequest { id, paths }]);
        instance.acknowledge(id).unwrap();
        assert!(!instance.has_pending());
    }

    #[test]
    fn native_hover_cancel_and_unsupported_drops_do_not_open_documents() {
        let position = tauri::PhysicalPosition::new(0.0, 0.0);
        let paths = vec![std::env::temp_dir().join("hover.md")];
        for event in [
            tauri::DragDropEvent::Enter { paths, position },
            tauri::DragDropEvent::Over { position },
            tauri::DragDropEvent::Leave,
            tauri::DragDropEvent::Drop {
                paths: Vec::new(),
                position,
            },
            tauri::DragDropEvent::Drop {
                paths: vec![std::env::temp_dir().join("image.png")],
                position,
            },
        ] {
            assert!(paths_from_drop(&event).is_empty());
        }
    }

    #[test]
    fn a_dropped_directory_with_a_document_extension_is_ignored() {
        let directory = std::env::temp_dir().join(format!(
            "marknext-drop-{}-{}.md",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&directory).unwrap();
        let result = paths_from_drop(&tauri::DragDropEvent::Drop {
            paths: vec![directory.clone()],
            position: tauri::PhysicalPosition::new(0.0, 0.0),
        });
        std::fs::remove_dir(directory).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn dom_drop_uris_preserve_encoded_names_and_reject_urls_and_relative_names() {
        let file = std::env::temp_dir().join("文档 # 100%.MD");
        let uri = tauri::Url::from_file_path(&file).unwrap().to_string();
        let paths = paths_from_drop_inputs(&[
            uri.clone(),
            "https://example.com/file.md".into(),
            "relative.md".into(),
            format!("{uri}#fragment"),
            format!("{uri}?query"),
            tauri::Url::from_file_path(std::env::temp_dir().join("image.png"))
                .unwrap()
                .to_string(),
        ]);
        assert_eq!(paths, vec![file.to_str().unwrap().to_owned()]);
    }

    #[test]
    fn duplicate_native_and_dom_drops_share_pending_requests_but_can_reopen_after_ack() {
        let instance = WindowInstance::default();
        let paths = vec!["/same.md".to_owned()];
        assert!(instance.enqueue_drop(paths.clone()).unwrap());
        assert!(!instance.enqueue_drop(paths.clone()).unwrap());
        assert!(!instance.enqueue_drop(Vec::new()).unwrap());
        let requests = instance.pending().unwrap();
        assert_eq!(requests.len(), 1);
        instance.acknowledge(requests[0].id).unwrap();
        assert!(instance.enqueue_drop(paths).unwrap());
    }

    #[test]
    fn configuration_has_one_main_window_and_installer_file_associations() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let windows = config["app"]["windows"].as_array().unwrap();
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0]["label"], MAIN_WINDOW);
        assert_eq!(windows[0]["visible"], false);
        assert_eq!(windows[0]["dragDropEnabled"], true);
        assert_eq!(windows[0]["backgroundColor"], "#1e1e1e");
        let associations = config["bundle"]["fileAssociations"].as_array().unwrap();
        let declared: std::collections::BTreeSet<_> = associations
            .iter()
            .flat_map(|item| item["ext"].as_array().unwrap())
            .map(|extension| extension.as_str().unwrap())
            .collect();
        assert_eq!(
            declared,
            crate::document::DOCUMENT_EXTENSIONS
                .iter()
                .copied()
                .collect()
        );
        assert!(associations
            .iter()
            .any(|item| item["mimeType"] == "text/markdown"));
        assert!(associations
            .iter()
            .any(|item| item["mimeType"] == "text/plain"));
        assert!(include_str!("../templates/marknext.desktop").contains("Exec={{exec}} %U"));
    }
}
