//! What the app starts for itself.
//!
//! AuralFlow is a single application: opening it brings up everything it needs.
//!
//! * The **audio engine** is Monochrome's production build, shipped inside the
//!   app and served from an in-process HTTP thread. No Node.js at runtime.
//! * The **recommendation backend** is optional. When a Python environment is
//!   present the app starts it and the AI DJ ranks tracks; without one the app
//!   runs perfectly well and simply reports the DJ as offline.
//!
//! Anything already listening on a port is adopted rather than duplicated, so
//! running the dev launcher alongside the app does not start two copies.

use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager, Runtime};

const MONOCHROME_PORT: u16 = 5173;
const BACKEND_PORT: u16 = 8000;

/// A service we started, kept so we can kill it on exit and reap it if it
/// dies on its own.
struct Service {
    label: &'static str,
    child: Child,
}

static CHILDREN: Mutex<Vec<Service>> = Mutex::new(Vec::new());
static REAPER_STARTED: Mutex<bool> = Mutex::new(false);

/// True when something already answers on the port.
fn port_in_use(port: u16) -> bool {
    TcpStream::connect_timeout(
        &([127, 0, 0, 1], port).into(),
        Duration::from_millis(250),
    )
    .is_ok()
}

/// Locate the AuralFlow checkout.
///
/// `AURALFLOW_ROOT` wins when set (packaged installs should set it). Otherwise
/// walk up from the executable and from the current directory looking for the
/// backend sources.
fn project_root<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let is_root = |p: &Path| p.join("backend/app/main.py").is_file();

    if let Ok(env_root) = std::env::var("AURALFLOW_ROOT") {
        let p = PathBuf::from(env_root);
        if is_root(&p) {
            return Some(p);
        }
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        candidates.push(exe);
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd);
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir);
    }

    for start in candidates {
        let mut dir = start.as_path();
        // 8 levels clears target/debug, bundle layouts and dev checkouts alike.
        for _ in 0..8 {
            if is_root(dir) {
                return Some(dir.to_path_buf());
            }
            match dir.parent() {
                Some(parent) => dir = parent,
                None => break,
            }
        }
    }

    None
}

/// Where the engine's built files live.
///
/// In an installed app they are a bundled resource; in a checkout they are
/// `monochrome_app/dist` after a build. Falls back to the raw sources so a
/// developer who has not built yet still gets a useful message.
fn engine_dir<R: Runtime>(app: &AppHandle<R>, root: &Path) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join("monochrome"));
        candidates.push(resources.join("_up_/monochrome_app/dist"));
    }
    candidates.push(root.join("monochrome_app/dist"));

    candidates.into_iter().find(|c| c.join("index.html").is_file())
}

/// Where the recommendation backend's sources live.
///
/// Installed builds carry them as a bundled resource; a checkout has them at
/// `backend/`. Returning None means the AI DJ is simply unavailable — the
/// player still works without it.
fn backend_dir<R: Runtime>(app: &AppHandle<R>, root: &Path) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join("backend"));
        candidates.push(resources.join("_up_/backend"));
    }
    candidates.push(root.join("backend"));

    candidates.into_iter().find(|c| c.join("app/main.py").is_file())
}

/// First interpreter that exists, preferring the backend's own virtualenv.
fn python_bin(backend: &Path) -> Option<PathBuf> {
    let candidates = [
        backend.join("venv/bin/python"),
        backend.join("venv/Scripts/python.exe"),
        backend.join(".venv/bin/python"),
        backend.join(".venv/Scripts/python.exe"),
    ];
    for c in candidates {
        if c.is_file() {
            return Some(c);
        }
    }
    // Fall back to whatever is on PATH.
    for name in ["python3", "python"] {
        if Command::new(name)
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            return Some(PathBuf::from(name));
        }
    }
    None
}

/// Tie a child's lifetime to ours at the kernel level.
///
/// `shutdown_all` handles the graceful exits, but it cannot run if the app is
/// killed outright — a logout, a `kill`, a crash. Linux will deliver a signal
/// to the child itself when its parent dies, which covers every one of those
/// cases; without it a `uvicorn` carrying a loaded PyTorch model is left
/// orphaned on port 8000 until the machine reboots.
#[cfg(target_os = "linux")]
fn die_with_parent(cmd: &mut Command) {
    use std::io;
    use std::os::unix::process::CommandExt;

    // Safety: only async-signal-safe calls between fork and exec.
    unsafe {
        cmd.pre_exec(|| {
            if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM) != 0 {
                return Err(io::Error::last_os_error());
            }
            // The parent may already have died in the window between fork and
            // the call above, in which case the signal will never arrive and
            // this child would outlive it anyway. Leave now instead.
            if libc::getppid() == 1 {
                libc::_exit(0);
            }
            Ok(())
        });
    }
}

#[cfg(not(target_os = "linux"))]
fn die_with_parent(_cmd: &mut Command) {}

fn spawn(label: &'static str, mut cmd: Command) {
    cmd.stdout(Stdio::null()).stderr(Stdio::null());
    die_with_parent(&mut cmd);

    match cmd.spawn() {
        Ok(child) => {
            eprintln!("[auralflow] started {label} (pid {})", child.id());
            if let Ok(mut guard) = CHILDREN.lock() {
                guard.push(Service { label, child });
            }
            start_reaper();
        }
        Err(e) => eprintln!("[auralflow] could not start {label}: {e}"),
    }
}

/// Reap services that exit on their own.
///
/// Without this a service that dies immediately — a missing `uvicorn`, a port
/// clash — stays a zombie for the lifetime of the app and says nothing about
/// why it failed. The reaper collects the exit status and reports it, so the
/// failure is visible instead of silent.
fn start_reaper() {
    {
        let Ok(mut started) = REAPER_STARTED.lock() else {
            return;
        };
        if *started {
            return;
        }
        *started = true;
    }

    thread::spawn(|| loop {
        thread::sleep(Duration::from_secs(2));

        let Ok(mut guard) = CHILDREN.lock() else {
            return;
        };
        if guard.is_empty() {
            return; // nothing left to watch
        }

        guard.retain_mut(|service| match service.child.try_wait() {
            Ok(Some(status)) => {
                eprintln!(
                    "[auralflow] {} exited ({}) — that feature is unavailable this session",
                    service.label, status
                );
                false
            }
            Ok(None) => true,
            Err(e) => {
                eprintln!("[auralflow] lost track of {}: {e}", service.label);
                false
            }
        });
    });
}

/// Warn when the webview cannot actually produce sound.
///
/// On Linux the webview decodes media through GStreamer. If the plugin that
/// provides its audio sink is missing, playback reports itself as running,
/// advances nothing, and raises no error — it looks exactly like the app
/// hanging. The check is cheap and the failure is otherwise almost impossible
/// to attribute, so say it out loud at startup.
#[cfg(target_os = "linux")]
fn check_audio_plugins() {
    thread::spawn(|| {
        // Elements the webview needs, and the package that carries each.
        const REQUIRED: [(&str, &str); 2] =
            [("autoaudiosink", "gst-plugins-good"), ("flacdec", "gst-plugins-good")];

        let mut missing: Vec<&str> = Vec::new();
        for (element, _) in REQUIRED {
            // `gst-inspect-1.0` exits non-zero and reports on stderr when the
            // element is not installed, so the status is enough. A missing
            // `gst-inspect` itself is treated as "cannot tell" rather than
            // "missing", since plenty of systems have the plugins without the
            // developer tools.
            let found = Command::new("gst-inspect-1.0")
                .arg(element)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|status| status.success())
                .unwrap_or(true);
            if !found {
                missing.push(element);
            }
        }

        if missing.is_empty() {
            return;
        }

        let packages: Vec<&str> = REQUIRED
            .iter()
            .filter(|(element, _)| missing.contains(element))
            .map(|(_, package)| *package)
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect();

        eprintln!(
            "[auralflow] the webview is missing GStreamer elements ({}) — audio will not play. \
             Install: {} (plus gst-plugins-base)",
            missing.join(", "),
            packages.join(" ")
        );
    });
}

#[cfg(not(target_os = "linux"))]
fn check_audio_plugins() {}

/// The folder downloaded tracks land in, if it exists yet.
///
/// Served alongside the engine so downloaded files can be played back through
/// the same pipeline as anything streamed — the webview has no filesystem
/// access of its own, so a local HTTP URL is how it reaches them.
fn downloads_library() -> Option<PathBuf> {
    let base = dirs_audio().or_else(dirs_home)?;
    let dir = base.join("AuralFlow");
    dir.is_dir().then_some(dir)
}

fn dirs_audio() -> Option<PathBuf> {
    std::env::var_os("XDG_MUSIC_DIR")
        .map(PathBuf::from)
        .or_else(|| dirs_home().map(|h| h.join("Music")))
        .filter(|p| p.is_dir())
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// Start whichever services are not already running.
pub fn spawn_all<R: Runtime>(app: &AppHandle<R>) {
    check_audio_plugins();

    /* An installed app has no checkout: everything it needs is bundled, so a
       missing project root is normal rather than fatal. */
    let root = project_root(app).unwrap_or_else(|| PathBuf::from("."));
    eprintln!("[auralflow] project root: {}", root.display());

    /* ---- Audio engine: served in-process from the bundled build ---- */
    if port_in_use(MONOCHROME_PORT) {
        eprintln!("[auralflow] audio engine already listening on :{MONOCHROME_PORT}");
    } else {
        match engine_dir(app, &root) {
            Some(dir) => {
                crate::engine_server::serve(dir, downloads_library(), MONOCHROME_PORT);
            }
            None => eprintln!(
                "[auralflow] no audio engine build found — run `npm run build` in monochrome_app"
            ),
        }
    }

    /* ---- FastAPI recommendation backend ---- */
    if port_in_use(BACKEND_PORT) {
        eprintln!("[auralflow] backend already listening on :{BACKEND_PORT}");
    } else {
        match backend_dir(app, &root).and_then(|dir| python_bin(&dir).map(|py| (dir, py))) {
            Some((dir, python)) => {
                let mut cmd = Command::new(python);
                cmd.args([
                    "-m",
                    "uvicorn",
                    "app.main:app",
                    "--host",
                    crate::engine_server::bind_host(),
                    "--port",
                    &BACKEND_PORT.to_string(),
                ])
                .current_dir(&dir);
                spawn("backend", cmd);
            }
            None => eprintln!(
                "[auralflow] no Python environment for the backend — \
                 running without the AI DJ (playback and browsing are unaffected)"
            ),
        }
    }
}

/// Kill every service we started. Safe to call more than once.
pub fn shutdown_all() {
    let Ok(mut guard) = CHILDREN.lock() else {
        return;
    };
    for mut service in guard.drain(..) {
        let _ = service.child.kill();
        let _ = service.child.wait();
    }
}
