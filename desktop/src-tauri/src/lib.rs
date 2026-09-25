//! AuralFlow native shell.
//!
//! Owns the window, the tray, and — on desktop — the two background services
//! the player needs: the Monochrome audio engine and the FastAPI
//! recommendation backend. Both are started when the app launches and killed
//! when it exits, so there is nothing for the user to start by hand.

use tauri::Manager;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod engine_server;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod services;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_shell::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // Someone launched a second copy — surface the window we already have.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));

    builder
        .setup(|app| {
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                services::spawn_all(app.handle());
                build_main_window(app.handle())?;
                tray::install(app.handle())?;
            }
            let _ = app;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window shuts the app down; the services go with it.
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                #[cfg(not(any(target_os = "android", target_os = "ios")))]
                services::shutdown_all();
                let _ = window;
            }
        })
        .build(tauri::generate_context!())
        .expect("error while starting AuralFlow")
        // The catch-all: whatever route the app took out — window close, tray
        // quit, a platform shutdown request — the services go with it.
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                #[cfg(not(any(target_os = "android", target_os = "ios")))]
                services::shutdown_all();
            }
        });
}

/* ------------------------------------------------------------------ */
/* Window                                                             */
/* ------------------------------------------------------------------ */

/// Build the main window from its configuration.
///
/// The window is marked `"create": false` in `tauri.conf.json` and built here
/// instead, because the download hook can only be attached while the webview
/// is being constructed. Everything else about it still comes from the config.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn build_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    use tauri::webview::{DownloadEvent, WebviewWindowBuilder};

    let Some(config) = app.config().app.windows.first().cloned() else {
        return Ok(());
    };

    WebviewWindowBuilder::from_config(app, &config)?
        .on_download(|webview, event| {
            match event {
                // The audio engine hands the webview a finished file. Without
                // somewhere to put it the download is silently dropped, so
                // send it to the music library like any other player would.
                DownloadEvent::Requested { destination, .. } => {
                    if let Some(dir) = downloads_dir(webview.app_handle()) {
                        let name = destination
                            .file_name()
                            .map(std::ffi::OsString::from)
                            .unwrap_or_else(|| "auralflow-download".into());
                        if std::fs::create_dir_all(&dir).is_ok() {
                            *destination = dir.join(name);
                        }
                    }
                }
                DownloadEvent::Finished { path, success, .. } => {
                    match (success, path) {
                        (true, Some(path)) => {
                            eprintln!("[auralflow] saved {}", path.display())
                        }
                        (true, None) => eprintln!("[auralflow] download finished"),
                        (false, _) => eprintln!("[auralflow] a download did not complete"),
                    }
                }
                _ => {}
            }
            true
        })
        .build()?;

    Ok(())
}

/// Where downloaded tracks are written: the user's music folder, under an
/// AuralFlow directory so the app's files stay together.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn downloads_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<std::path::PathBuf> {
    use tauri::Manager;
    let base = app
        .path()
        .audio_dir()
        .or_else(|_| app.path().download_dir())
        .or_else(|_| app.path().home_dir())
        .ok()?;
    Some(base.join("AuralFlow"))
}
/* ------------------------------------------------------------------ */
/* Tray                                                               */
/* ------------------------------------------------------------------ */

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod tray {
    use tauri::{
        menu::{Menu, MenuItem, PredefinedMenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
        AppHandle, Manager, Runtime,
    };

    /// Ask the webview to run a transport command. The frontend listens for
    /// `auralflow://transport` and forwards it to the audio engine.
    fn transport<R: Runtime>(app: &AppHandle<R>, action: &str) {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.eval(&format!(
                "window.dispatchEvent(new CustomEvent('auralflow://transport',{{detail:'{action}'}}))"
            ));
        }
    }

    fn toggle_window<R: Runtime>(app: &AppHandle<R>) {
        if let Some(window) = app.get_webview_window("main") {
            match window.is_visible() {
                Ok(true) => {
                    let _ = window.hide();
                }
                _ => {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        }
    }

    pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
        // Without an embedded icon there is nothing to put in the tray.
        let Some(icon) = app.default_window_icon().cloned() else {
            return Ok(());
        };

        let play = MenuItem::with_id(app, "play", "Play / Pause", true, None::<&str>)?;
        let next = MenuItem::with_id(app, "next", "Next Track", true, None::<&str>)?;
        let prev = MenuItem::with_id(app, "prev", "Previous Track", true, None::<&str>)?;
        let show = MenuItem::with_id(app, "show", "Show / Hide AuralFlow", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", "Quit AuralFlow", true, None::<&str>)?;
        let sep = PredefinedMenuItem::separator(app)?;

        let menu = Menu::with_items(app, &[&play, &prev, &next, &sep, &show, &sep, &quit])?;

        TrayIconBuilder::with_id("auralflow-tray")
            .icon(icon)
            .tooltip("AuralFlow")
            .menu(&menu)
            .on_menu_event(|app, event| match event.id.as_ref() {
                "play" => transport(app, "toggle"),
                "next" => transport(app, "next"),
                "prev" => transport(app, "prev"),
                "show" => toggle_window(app),
                "quit" => {
                    super::services::shutdown_all();
                    app.exit(0);
                }
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    toggle_window(tray.app_handle());
                }
            })
            .build(app)?;

        Ok(())
    }
}
