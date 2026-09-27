//! Static file server for the bundled audio engine.
//!
//! Monochrome is a web app that must be served from a real HTTP origin — it
//! uses module scripts, a service worker and cross-origin media, none of which
//! work from `file://`. Rather than requiring Node and a Vite dev server on the
//! user's machine, the app ships Monochrome's production build as a resource
//! and serves it from this thread.
//!
//! This is what makes AuralFlow a single application rather than three
//! processes the user has to start.

use std::fs;
use std::io::Cursor;
use std::path::{Component, Path, PathBuf};
use std::thread;

use tiny_http::{Header, Response, Server};

/// Map a file extension to a content type the webview will accept.
///
/// Serving JavaScript as `text/plain` makes module scripts fail silently, so
/// the common web types are all spelled out here.
/// Where downloaded files are served from, and where the listing lives.
const OFFLINE_PREFIX: &str = "/offline/";
const OFFLINE_INDEX: &str = "/offline-index.json";

/// Extensions we will list and serve as music.
const AUDIO_EXTENSIONS: [&str; 8] = ["flac", "mp3", "m4a", "opus", "ogg", "wav", "aac", "aiff"];

/// Send a file with its content type. Shared by the engine build and the
/// offline library so both behave the same.
fn serve_file(request: tiny_http::Request, file: &Path) {
    match fs::read(file) {
        Ok(body) => {
            let mut response = Response::from_data(body);
            if let Ok(header) =
                Header::from_bytes(&b"Content-Type"[..], content_type(file).as_bytes())
            {
                response.add_header(header);
            }
            // The engine is embedded in the app's own window.
            if let Ok(header) = Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]) {
                response.add_header(header);
            }
            let _ = request.respond(response);
        }
        Err(e) => {
            let _ = request.respond(Response::new(
                500.into(),
                vec![],
                Cursor::new(format!("read error: {e}").into_bytes()),
                None,
                None,
            ));
        }
    }
}

/// JSON listing of everything downloaded, for the shell to render.
///
/// Only the parts of a file we can know without decoding it: where it is, what
/// it is called, and how big. Tags are the engine's job once it loads the file.
fn offline_index(dir: &Path) -> String {
    let mut entries: Vec<String> = Vec::new();
    collect_audio(dir, dir, &mut entries, 0);
    entries.sort();

    let items: Vec<String> = entries
        .iter()
        .map(|relative| {
            let path = dir.join(relative);
            let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            let name = Path::new(relative)
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| relative.clone());
            format!(
                r#"{{"path":{},"name":{},"size":{}}}"#,
                json_string(relative),
                json_string(&name),
                size
            )
        })
        .collect();

    format!(r#"{{"tracks":[{}]}}"#, items.join(","))
}

/// Walk the library for audio files, depth-limited so a stray symlink loop
/// cannot spin here forever.
fn collect_audio(root: &Path, dir: &Path, out: &mut Vec<String>, depth: usize) {
    if depth > 6 {
        return;
    }
    let Ok(read) = fs::read_dir(dir) else {
        return;
    };

    for entry in read.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_audio(root, &path, out, depth + 1);
            continue;
        }
        let is_audio = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| AUDIO_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
            .unwrap_or(false);
        if !is_audio {
            continue;
        }
        if let Ok(relative) = path.strip_prefix(root) {
            out.push(relative.to_string_lossy().replace('\\', "/"));
        }
    }
}

/// Minimal JSON string escaping — these are file names, not arbitrary data.
fn json_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for c in value.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Whether a path is asking for a file rather than a client-side route.
///
/// Routes look like `/album/123`; assets carry a recognisable extension. Only
/// the latter should 404 when missing — a route has to reach index.html.
fn is_asset_request(url: &str) -> bool {
    let path = url.split(['?', '#']).next().unwrap_or(url);
    let last = path.rsplit('/').next().unwrap_or("");
    match last.rsplit_once('.') {
        Some((_, ext)) => !ext.is_empty() && ext.len() <= 8 && ext.chars().all(|c| c.is_ascii_alphanumeric()),
        None => false,
    }
}

fn content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "wasm" => "application/wasm",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "m4a" | "mp4" => "audio/mp4",
        "webmanifest" => "application/manifest+json",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// Resolve a request path inside `root`, refusing anything that escapes it.
fn resolve(root: &Path, url_path: &str) -> Option<PathBuf> {
    let trimmed = url_path.split('?').next().unwrap_or("").trim_start_matches('/');
    let decoded = percent_decode(trimmed);

    let mut out = root.to_path_buf();
    for component in Path::new(&decoded).components() {
        match component {
            Component::Normal(part) => out.push(part),
            // Reject traversal outright rather than trying to normalise it.
            Component::ParentDir => return None,
            Component::CurDir => {}
            _ => return None,
        }
    }
    Some(out)
}

/// Minimal percent-decoding — enough for asset paths with spaces or unicode.
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(byte) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Which interface the local servers listen on.
///
/// Loopback by default: this serves the listener's own library and an engine
/// with their account in it, and nothing on the network has any business
/// reaching that. Setting `AURALFLOW_LAN=1` opens it to the local network,
/// which is what the documented phone setup needs - a phone cannot run the
/// engine itself and has to reach the machine that does.
pub fn bind_host() -> &'static str {
    match std::env::var("AURALFLOW_LAN").ok().as_deref() {
        Some("1") | Some("true") | Some("yes") => "0.0.0.0",
        _ => "127.0.0.1",
    }
}

/// Start serving `root` on `port` in a background thread.
///
/// Returns false when the directory is missing, so the caller can report that
/// the engine is unavailable instead of leaving the user with a blank frame.
pub fn serve(root: PathBuf, library: Option<PathBuf>, port: u16) -> bool {
    if !root.join("index.html").is_file() {
        eprintln!(
            "[auralflow] audio engine build not found at {} — playback UI will be unavailable",
            root.display()
        );
        return false;
    }

    let server = match Server::http((bind_host(), port)) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[auralflow] could not bind audio engine port {port}: {e}");
            return false;
        }
    };

    eprintln!("[auralflow] serving audio engine from {}", root.display());
    if bind_host() != "127.0.0.1" {
        eprintln!("[auralflow] AURALFLOW_LAN is set — the engine is reachable from the local network on port {port}");
    }

    if let Some(dir) = library.as_ref() {
        eprintln!("[auralflow] offline library at {}", dir.display());
    }

    thread::spawn(move || {
        for request in server.incoming_requests() {
            let url = request.url().to_string();

            // Downloaded files are served from the music folder rather than
            // the engine build, so the player can reach them with an ordinary
            // URL and play them through the same pipeline as anything else —
            // equaliser, analyser and all.
            if let Some(dir) = library.as_ref() {
                if url.starts_with(OFFLINE_INDEX) {
                    let body = offline_index(dir);
                    let mut response = Response::from_string(body);
                    if let Ok(header) =
                        Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
                    {
                        response.add_header(header);
                    }
                    if let Ok(header) =
                        Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..])
                    {
                        response.add_header(header);
                    }
                    let _ = request.respond(response);
                    continue;
                }

                if let Some(rest) = url.strip_prefix(OFFLINE_PREFIX) {
                    match resolve(dir, rest) {
                        Some(path) if path.is_file() => {
                            serve_file(request, &path);
                        }
                        _ => {
                            let _ = request
                                .respond(Response::from_string("not found").with_status_code(404));
                        }
                    }
                    continue;
                }
            }

            let target = match resolve(&root, &url) {
                Some(p) => p,
                None => {
                    let _ = request.respond(Response::from_string("forbidden").with_status_code(403));
                    continue;
                }
            };

            // Unknown routes fall back to index.html so the engine's
            // client-side routing keeps working. An asset request is different:
            // answering a missing script with HTML makes the browser reject it
            // on MIME grounds and report a parse error rather than a 404, which
            // hides the real problem. Let those 404 honestly.
            let file = if target.is_file() {
                target
            } else if target.is_dir() && target.join("index.html").is_file() {
                target.join("index.html")
            } else if is_asset_request(&url) {
                let _ = request.respond(Response::from_string("not found").with_status_code(404));
                continue;
            } else {
                root.join("index.html")
            };

            serve_file(request, &file);
        }
    });

    true
}
