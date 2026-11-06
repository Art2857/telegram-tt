//! The Proxygram server whose client the app opens (docs/RELEASE.md). It is chosen on the sign-in page,
//! kept between starts and is the only origin that gets the app's native permissions.

use std::collections::HashSet;
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, ipc::CapabilityBuilder};
use url::Url;

use crate::BASE_URL;

const SERVER_FILE: &str = "server.json";
/// The sign-in page explains why the default server opened instead of the saved one
const UNREACHABLE_PARAM: &str = "pxg-server-unreachable";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(4);
const LOCAL_HOSTS: [&str; 3] = ["localhost", "127.0.0.1", "[::1]"];

/// Native permissions of the client; `capabilities/*.json` grant the same to the default server
const PERMISSIONS: &[&str] = &[
  "allow-mark-title-bar-overlay",
  "allow-set-notifications-count",
  "allow-set-window-title",
  "allow-open-new-window-cmd",
  "allow-save-current-url",
  "allow-set-menu-translations",
  "allow-set-server",
  "core:event:default",
  "core:window:allow-is-fullscreen",
  "core:window:allow-start-dragging",
  "deep-link:allow-get-current",
  "process:default",
  "notification:allow-is-permission-granted",
  "notification:allow-notify",
  "notification:allow-request-permission",
  "shell:default",
];

#[cfg(desktop)]
const DESKTOP_PERMISSIONS: &[&str] = &[
  "updater:default",
  "autostart:allow-enable",
  "autostart:allow-disable",
  "autostart:allow-is-enabled",
];

static CURRENT: LazyLock<Mutex<Url>> = LazyLock::new(|| Mutex::new(default_server()));
static GRANTED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

#[derive(Serialize, Deserialize)]
struct SavedServer {
  url: String,
}

pub fn default_server() -> Url {
  Url::parse(BASE_URL).expect("BASE_URL must be a valid URL")
}

/// The origin windows may show: navigation elsewhere is refused
pub fn current() -> Url {
  CURRENT.lock().map(|url| url.clone()).unwrap_or_else(|_| default_server())
}

/// The URL of the first window: the saved server if it answers, otherwise the default one with a note
pub fn init(app: &AppHandle) -> Url {
  let saved = read_saved(app).filter(|url| url.origin() != default_server().origin());
  let server = match saved {
    Some(saved) if is_reachable(&saved) => saved,
    Some(saved) => {
      log::warn!("Saved server {saved} does not answer, opening the default one");
      let mut url = default_server();
      url.query_pairs_mut().append_pair(UNREACHABLE_PARAM, &authority(&saved));
      activate(app, &default_server());
      return url;
    }
    None => default_server(),
  };
  activate(app, &server);
  server
}

/// Called by the sign-in page once the address answered as a Proxygram server
#[tauri::command]
pub fn set_server(window: tauri::WebviewWindow, url: String) -> Result<(), String> {
  let server = parse_origin(&url).ok_or_else(|| format!("Not an allowed server address: {url}"))?;
  let app = window.app_handle();
  save(app, &server)?;
  activate(app, &server);
  window.navigate(server).map_err(|err| err.to_string())
}

/// HTTPS, or plain HTTP on this machine only; credentials and paths are not part of a server address
fn parse_origin(input: &str) -> Option<Url> {
  let url = Url::parse(input).ok()?;
  let is_local = url.host_str().is_some_and(|host| LOCAL_HOSTS.contains(&host));
  let is_allowed = url.scheme() == "https" || (url.scheme() == "http" && is_local);
  if !is_allowed || !url.username().is_empty() || url.password().is_some() {
    return None;
  }
  Url::parse(&url.origin().ascii_serialization()).ok()
}

fn activate(app: &AppHandle, server: &Url) {
  if let Err(err) = grant(app, server) {
    log::error!("Failed to grant permissions to {server}: {err}");
  }
  if let Ok(mut current) = CURRENT.lock() {
    *current = server.clone();
  }
}

/// The capability files name only the default release server; any other one gets the same at runtime
fn grant(app: &AppHandle, server: &Url) -> Result<(), String> {
  let origin = server.origin().ascii_serialization();
  let mut granted = GRANTED.lock().map_err(|err| err.to_string())?;
  if granted.contains(&origin) {
    return Ok(());
  }
  let identifier = format!("server-{}", granted.len());
  let mut capability = CapabilityBuilder::new(identifier)
    .remote(format!("{origin}/*"))
    .window("*")
    .webview("*");
  for permission in PERMISSIONS {
    capability = capability.permission(*permission);
  }
  #[cfg(desktop)]
  for permission in DESKTOP_PERMISSIONS {
    capability = capability.permission(*permission);
  }
  app.add_capability(capability).map_err(|err| err.to_string())?;
  granted.insert(origin);
  Ok(())
}

fn read_saved(app: &AppHandle) -> Option<Url> {
  let path = app.path().app_config_dir().ok()?.join(SERVER_FILE);
  let saved: SavedServer = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
  parse_origin(&saved.url)
}

fn save(app: &AppHandle, server: &Url) -> Result<(), String> {
  let dir = app.path().app_config_dir().map_err(|err| err.to_string())?;
  std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
  let json = serde_json::to_string(&SavedServer { url: server.origin().ascii_serialization() })
    .map_err(|err| err.to_string())?;
  std::fs::write(dir.join(SERVER_FILE), json).map_err(|err| err.to_string())
}

/// A TCP connection is enough to tell a dead address from a live one before the window opens
fn is_reachable(server: &Url) -> bool {
  let Some(host) = server.host_str() else {
    return false;
  };
  let port = server.port_or_known_default().unwrap_or(443);
  let Ok(addresses) = (host, port).to_socket_addrs() else {
    return false;
  };
  addresses
    .into_iter()
    .any(|address| TcpStream::connect_timeout(&address, CONNECT_TIMEOUT).is_ok())
}

fn authority(url: &Url) -> String {
  match (url.host_str(), url.port()) {
    (Some(host), Some(port)) => format!("{host}:{port}"),
    (Some(host), None) => host.to_string(),
    _ => url.to_string(),
  }
}
