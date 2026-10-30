use crate::{document, recovery, window_instance};
use std::path::Path;
use tauri::Manager;

#[tauri::command]
fn open_devtools(_app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        let window = _app
            .get_webview_window("main")
            .ok_or_else(|| "main webview window not found".to_string())?;
        window.open_devtools();
        Ok(())
    }
    #[cfg(not(debug_assertions))]
    {
        Err("Developer tools are unavailable in release builds".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let instance = window_instance::WindowInstance::default();
    let cwd = std::env::current_dir().unwrap_or_default();
    let initial = window_instance::paths_from_args(
        std::env::args_os().filter_map(|argument| argument.into_string().ok()),
        &cwd,
    );
    if !initial.is_empty() {
        let _ = instance.enqueue(initial);
    }
    let builder = tauri::Builder::default().manage(instance);
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        let paths = window_instance::paths_from_args(args, Path::new(&cwd));
        window_instance::deliver(app, paths);
    }));
    builder
        .on_page_load(|webview, payload| {
            if webview.label() == window_instance::MAIN_WINDOW
                && payload.event() == tauri::webview::PageLoadEvent::Started
            {
                window_instance::begin_startup(webview.app_handle());
            }
        })
        .on_window_event(|window, event| {
            if window.label() == window_instance::MAIN_WINDOW
                && matches!(event, tauri::WindowEvent::CloseRequested { .. })
            {
                window
                    .state::<window_instance::WindowInstance>()
                    .cancel_failed_startup_requests();
            }
            if window.label() == window_instance::MAIN_WINDOW
                && matches!(event, tauri::WindowEvent::Destroyed)
            {
                window_instance::invalidate_startup(window.app_handle());
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            document::read_file,
            document::canonical_document_path,
            document::allow_image_file,
            document::write_file,
            document::file_version,
            document::file_status,
            recovery::recovery_list,
            recovery::recovery_write,
            recovery::recovery_remove,
            window_instance::pending_open_requests,
            window_instance::acknowledge_open_request,
            window_instance::startup_generation,
            window_instance::startup_ready,
            open_devtools
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            match &event {
                tauri::RunEvent::Opened { urls } => {
                    let paths = urls
                        .iter()
                        .filter_map(|url| {
                            url.to_file_path().ok()?.into_os_string().into_string().ok()
                        })
                        .collect();
                    window_instance::deliver(app, paths);
                }
                tauri::RunEvent::Reopen { .. } => window_instance::focus_main(app, true),
                _ => {}
            }
            if let tauri::RunEvent::ExitRequested { code, api, .. } = event {
                if let Some(window) = app
                    .get_webview_window(window_instance::MAIN_WINDOW)
                    .filter(|_| code.is_none() || code == Some(0))
                {
                    // Native application-menu Quit follows the same frontend
                    // confirmation path as the titlebar close button.
                    api.prevent_exit();
                    if code == Some(0) {
                        let _ = window.close();
                    }
                    return;
                }
                // A file-manager launch may arrive while the old WebView is
                // closing. Keep the primary process and deliver to one new main
                // window rather than acknowledging and losing that request.
                if code.is_none() && app.state::<window_instance::WindowInstance>().has_pending() {
                    api.prevent_exit();
                    window_instance::focus_main(app, true);
                }
            }
        });
}
