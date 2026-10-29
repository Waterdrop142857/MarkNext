use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

pub const MAIN_WINDOW: &str = "main";
pub const OPEN_EVENT: &str = "open-files-available";

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

/// Requests live independently of the WebView. Notifications are only wakeups;
/// opening a window or registering an event listener never consumes a request.
#[derive(Default)]
pub struct WindowInstance {
    queue: Mutex<Queue>,
}

impl WindowInstance {
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
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    });
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
