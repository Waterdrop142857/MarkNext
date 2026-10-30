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
    args.into_iter()
        .skip(1)
        .filter_map(|argument| {
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
        })
        .collect()
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
    fn configuration_has_one_main_window_and_installer_file_associations() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let windows = config["app"]["windows"].as_array().unwrap();
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0]["label"], MAIN_WINDOW);
        assert_eq!(windows[0]["visible"], false);
        assert_eq!(windows[0]["backgroundColor"], "#1e1e1e");
        let associations = config["bundle"]["fileAssociations"].as_array().unwrap();
        assert!(associations
            .iter()
            .any(|item| item["mimeType"] == "text/markdown"));
        assert!(associations
            .iter()
            .any(|item| item["mimeType"] == "text/plain"));
        assert!(include_str!("../templates/marknext.desktop").contains("Exec={{exec}} %U"));
    }
}
