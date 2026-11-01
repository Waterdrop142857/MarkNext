//! Own the GTK file-drop negotiation instead of relying on WebKit's decision
//! that a particular DOM element is a drop target. Other drags still reach WebKit.
use crate::window_instance::{self, MAIN_WINDOW};
use gtk::{gdk, prelude::*};
use std::{cell::RefCell, rc::Rc};
use tauri::Manager;

pub fn configure(config: &mut tauri::utils::config::Config) {
    for window in &mut config.app.windows {
        if window.label == MAIN_WINDOW {
            // Wry's GTK handler finishes a drop before our handler can run.
            // This adapter owns external document drops on Linux, including
            // windows recreated from this same config after startup failure.
            window.drag_drop_enabled = false;
        }
    }
}

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("linux-file-drop")
        .on_webview_ready(|webview| {
            if webview.label() != MAIN_WINDOW {
                return;
            }
            let app = webview.app_handle().clone();
            if let Err(error) = webview.with_webview(move |view| attach(&view.inner(), app)) {
                eprintln!("Unable to register Linux file-drop receiver: {error}");
            }
        })
        .build()
}

#[derive(Default)]
enum Decision {
    #[default]
    Reading,
    Documents(Vec<String>),
    PassThrough,
}

#[derive(Default)]
struct Probe {
    decision: Decision,
    drop_time: Option<u32>,
}

impl Probe {
    fn received(&mut self, paths: Vec<String>) {
        self.decision = if paths.is_empty() {
            Decision::PassThrough
        } else {
            Decision::Documents(paths)
        };
    }

    fn take_drop(&mut self) -> Option<(Vec<String>, u32)> {
        let time = self.drop_time?;
        if matches!(self.decision, Decision::Reading) {
            return None;
        }
        self.drop_time = None;
        let paths = match std::mem::replace(&mut self.decision, Decision::PassThrough) {
            Decision::Documents(paths) => paths,
            _ => Vec::new(),
        };
        Some((paths, time))
    }
}

struct Drag {
    context: gdk::DragContext,
    probe: Probe,
}

fn finish(app: &tauri::AppHandle, context: &gdk::DragContext, paths: Vec<String>, time: u32) {
    let success = !paths.is_empty()
        && window_instance::queue_drop(app, paths).map_or_else(
            |error| {
                eprintln!("Unable to enqueue dropped documents: {error}");
                false
            },
            |_| true,
        );
    // Opening a document never moves/deletes the source file.
    context.drag_finish(success, false, time);
    trace(if success {
        "drop queued"
    } else {
        "drop rejected"
    });
}

fn trace(message: &str) {
    if std::env::var_os("MARKNEXT_DEBUG_FILE_DROP").is_some() {
        eprintln!("[file-drop] {message}");
    }
}

fn attach(view: &impl IsA<gtk::Widget>, app: tauri::AppHandle) {
    let view = view.as_ref();
    let uri = gdk::Atom::intern("text/uri-list");
    // Preserve WebKit's text/image targets and numeric IDs. Inspect the target
    // atom in callbacks, never its private numeric URI-list ID.
    if view.drag_dest_get_target_list().is_none() {
        view.drag_dest_set(gtk::DestDefaults::empty(), &[], gdk::DragAction::COPY);
    }
    if let Some(targets) = view.drag_dest_get_target_list() {
        if targets.find(&uri).is_none() {
            targets.add(&uri, gtk::TargetFlags::OTHER_APP.bits(), 0);
        }
    }
    trace(&format!(
        "GTK receiver ready ({})",
        view.display().type_().name()
    ));
    let state: Rc<RefCell<Option<Drag>>> = Rc::new(RefCell::new(None));
    let motion_state = state.clone();
    view.connect_drag_motion(move |widget, context, _, _, time| {
        if context.drag_get_source_widget().is_some()
            || !context.actions().contains(gdk::DragAction::COPY)
            || !context.list_targets().contains(&uri)
        {
            return false;
        }
        let request = {
            let mut state = motion_state.borrow_mut();
            if state.as_ref().is_none_or(|drag| drag.context != *context) {
                *state = Some(Drag {
                    context: context.clone(),
                    probe: Probe::default(),
                });
                true
            } else {
                false
            }
        };
        if request {
            trace("external URI drag entered; requesting paths");
            // GTK may reply synchronously: don't hold a RefCell borrow here.
            widget.drag_get_data(context, &uri, time);
        }
        let state = motion_state.borrow();
        let Some(drag) = state.as_ref().filter(|drag| drag.context == *context) else {
            return false;
        };
        match drag.probe.decision {
            Decision::PassThrough => false,
            Decision::Reading | Decision::Documents(_) => {
                let action = if matches!(drag.probe.decision, Decision::Documents(_)) {
                    gdk::DragAction::COPY
                } else {
                    gdk::DragAction::empty()
                };
                context.drag_status(action, time);
                true // Stop WebKit's subsequent DOM-dependent negotiation.
            }
        }
    });
    let data_state = state.clone();
    let data_app = app.clone();
    view.connect_drag_data_received(move |widget, context, _, _, data, _, time| {
        let mut state = data_state.borrow_mut();
        let Some(drag) = state.as_mut().filter(|drag| drag.context == *context) else {
            return;
        };
        if data.target() != uri || !matches!(drag.probe.decision, Decision::Reading) {
            return;
        }
        let inputs = data
            .uris()
            .iter()
            .map(|uri| uri.to_string())
            .collect::<Vec<_>>();
        let paths = window_instance::paths_from_drop_inputs(
            &inputs,
            data_app
                .config()
                .bundle
                .file_associations
                .as_deref()
                .unwrap_or_default(),
        );
        drag.probe.received(paths);
        let documents = matches!(drag.probe.decision, Decision::Documents(_));
        trace(if documents {
            "document URI received; accepting copy"
        } else {
            "no document URI; returning drag to WebKit"
        });
        let completed = drag.probe.take_drop();
        drop(state);
        // This response belongs to our probe, not a WebKit data request.
        widget.stop_signal_emission_by_name("drag-data-received");
        context.drag_status(
            if documents {
                gdk::DragAction::COPY
            } else {
                gdk::DragAction::empty()
            },
            time,
        );
        if let Some((paths, time)) = completed {
            finish(&data_app, context, paths, time);
        }
    });
    let drop_state = state.clone();
    view.connect_drag_drop(move |_, context, _, _, time| {
        let mut state = drop_state.borrow_mut();
        let Some(drag) = state.as_mut().filter(|drag| drag.context == *context) else {
            return false;
        };
        if matches!(drag.probe.decision, Decision::PassThrough) {
            return false;
        }
        drag.probe.drop_time = Some(time);
        let completed = drag.probe.take_drop();
        drop(state);
        if let Some((paths, time)) = completed {
            finish(&app, context, paths, time);
        }
        true
    });
    view.connect_drag_leave(move |_, context, _| {
        let state = state.clone();
        let context = context.clone();
        // GTK sends leave immediately before drop. Clear only after drop got
        // its chance; retain an in-flight URI response for a fast drop.
        gtk::glib::idle_add_local_once(move || {
            let mut state = state.borrow_mut();
            if state
                .as_ref()
                .is_some_and(|drag| drag.context == context && drag.probe.drop_time.is_none())
            {
                *state = None;
            }
        });
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_before_drop_only_delivers_once_after_release() {
        let mut probe = Probe::default();
        probe.received(vec!["/tmp/document.md".into()]);
        assert!(probe.take_drop().is_none());
        probe.drop_time = Some(42);
        assert_eq!(
            probe.take_drop(),
            Some((vec!["/tmp/document.md".into()], 42))
        );
        assert!(probe.take_drop().is_none());
    }

    #[test]
    fn fast_drop_waits_for_data_and_retains_drop_timestamp() {
        let mut probe = Probe {
            drop_time: Some(17),
            ..Probe::default()
        };
        assert!(probe.take_drop().is_none());
        probe.received(vec!["/tmp/中文 #.MD".into()]);
        assert_eq!(probe.take_drop(), Some((vec!["/tmp/中文 #.MD".into()], 17)));
    }

    #[test]
    fn non_document_probe_returns_to_webkit() {
        let mut probe = Probe::default();
        probe.received(Vec::new());
        assert!(matches!(probe.decision, Decision::PassThrough));
        assert!(probe.take_drop().is_none());
    }

    #[test]
    fn only_linux_main_window_disables_wry_receiver() {
        let mut config = tauri::utils::config::Config::default();
        config.app.windows = vec![
            tauri::utils::config::WindowConfig {
                label: MAIN_WINDOW.into(),
                ..Default::default()
            },
            tauri::utils::config::WindowConfig {
                label: "other".into(),
                ..Default::default()
            },
        ];
        configure(&mut config);
        assert!(!config.app.windows[0].drag_drop_enabled);
        assert!(config.app.windows[1].drag_drop_enabled);
    }
}
