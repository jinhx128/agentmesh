use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};
use tauri::{
    webview::{cookie::SameSite, Cookie},
    AppHandle, Manager, RunEvent, WebviewWindow, WindowEvent,
};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

/// Proxy variables that decide whether the launching environment already configured a proxy.
const PROXY_URL_ENV_KEYS: &[&str] = &["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"];
/// Every proxy variable forwarded to the sidecar, including the bypass list.
const PROXY_ENV_KEYS: &[&str] = &[
    "HTTPS_PROXY",
    "https_proxy",
    "HTTP_PROXY",
    "http_proxy",
    "NO_PROXY",
    "no_proxy",
];

#[derive(Deserialize)]
struct StudioReadyEvent {
    event: String,
    webview_url: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct DesktopPreferences {
    #[serde(default = "default_auto_check_updates")]
    auto_check_updates: bool,
}

impl Default for DesktopPreferences {
    fn default() -> Self {
        Self {
            auto_check_updates: true,
        }
    }
}

fn default_auto_check_updates() -> bool {
    true
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The updater's HTTP client only honours proxies from this process' own environment, and a
    // GUI launch inherits none, so publish the macOS system proxy before any request runs.
    apply_proxy_env_to_current_process();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            get_desktop_preferences,
            set_desktop_preferences,
        ])
        .setup(|app| {
            start_app_server_sidecar(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // macOS 约定：Cmd+W 只隐藏窗口，App 留在 Dock 里；退出走 Cmd+Q。
            if let WindowEvent::CloseRequested { api, .. } = event {
                if cfg!(target_os = "macos") {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build AgentMesh desktop shell")
        .run(|app, event| match event {
            // 没有可见窗口时不退出进程，等 Cmd+Q 或 Dock 菜单退出。
            RunEvent::ExitRequested { api, code, .. } if code.is_none() => {
                api.prevent_exit();
            }
            // 点 Dock 图标重新唤出窗口。
            RunEvent::Reopen { .. } => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            _ => {}
        });
}

#[tauri::command]
fn get_desktop_preferences(app: AppHandle) -> Result<DesktopPreferences, String> {
    read_desktop_preferences(&desktop_preferences_path(&app)?)
}

#[tauri::command]
fn set_desktop_preferences(
    app: AppHandle,
    auto_check_updates: bool,
) -> Result<DesktopPreferences, String> {
    let preferences = DesktopPreferences { auto_check_updates };
    write_desktop_preferences(&desktop_preferences_path(&app)?, &preferences)?;
    Ok(preferences)
}

fn desktop_preferences_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("preferences.json"))
        .map_err(|error| format!("desktop preferences directory is unavailable: {error}"))
}

fn read_desktop_preferences(path: &Path) -> Result<DesktopPreferences, String> {
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return Ok(DesktopPreferences::default())
        }
        Err(error) => return Err(format!("desktop preferences could not be read: {error}")),
    };
    serde_json::from_str(&content)
        .map_err(|error| format!("desktop preferences are invalid: {error}"))
}

fn write_desktop_preferences(
    path: &Path,
    preferences: &DesktopPreferences,
) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "desktop preferences path has no parent directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("desktop preferences directory could not be created: {error}"))?;
    let temporary = path.with_extension("json.tmp");
    let mut content = serde_json::to_string_pretty(preferences)
        .map_err(|error| format!("desktop preferences could not be serialized: {error}"))?;
    content.push('\n');
    fs::write(&temporary, content)
        .map_err(|error| format!("desktop preferences could not be written: {error}"))?;
    fs::rename(&temporary, path)
        .map_err(|error| format!("desktop preferences could not be saved: {error}"))
}

fn start_app_server_sidecar(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let window = app
        .get_webview_window("main")
        .ok_or("missing main AgentMesh window")?;
    let app_handle = app.handle().clone();
    let launch_token = generate_launch_token().map_err(|error| {
        std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("failed to generate AgentMesh launch token: {error}"),
        )
    })?;
    let sidecar_config = sidecar_launch_config_from_args(std::env::args());

    tauri::async_runtime::spawn(async move {
        let command = match app_handle.shell().sidecar("agentmesh-studio-sidecar") {
            Ok(command) => {
                let command = command.args(sidecar_config.args);
                // Node's global fetch ignores system/env proxies unless NODE_USE_ENV_PROXY is set
                // before the process starts, so pass the macOS system proxy through here.
                match sidecar_proxy_envs() {
                    Some(envs) => command.envs(envs),
                    None => command,
                }
            }
            Err(error) => {
                eprintln!("failed to create AgentMesh sidecar command: {error}");
                return;
            }
        };
        let (mut events, mut child) = match command.spawn() {
            Ok(spawned) => spawned,
            Err(error) => {
                eprintln!("failed to start AgentMesh sidecar: {error}");
                return;
            }
        };
        let handshake = serde_json::json!({
            "schema_version": 1,
            "studio_token": launch_token.as_str(),
        })
        .to_string();
        if let Err(error) = child.write(format!("{handshake}\n").as_bytes()) {
            eprintln!("failed to send AgentMesh launch handshake: {error}");
            return;
        }

        let mut stdout_buffer = String::new();
        let mut navigated = false;
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    handle_stdout_chunk(
                        &mut stdout_buffer,
                        &bytes,
                        &window,
                        &launch_token,
                        &mut navigated,
                    );
                }
                CommandEvent::Stderr(bytes) => {
                    eprintln!("{}", String::from_utf8_lossy(&bytes).trim_end());
                }
                CommandEvent::Terminated(status) => {
                    if !navigated {
                        eprintln!("AgentMesh sidecar exited before readiness: {status:?}");
                    }
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

struct SidecarLaunchConfig {
    args: Vec<String>,
}

/// Publishes the macOS system proxy into this process so the updater's HTTP client can use it.
/// A proxy already present in the launching environment wins.
fn apply_proxy_env_to_current_process() {
    let Some(envs) = mac_system_proxy_env() else {
        return;
    };
    for (key, value) in envs {
        std::env::set_var(key, value);
    }
}

/// Reads the macOS system proxy as environment variables. Returns None when no proxy is
/// configured, or when the launching environment already set one.
fn mac_system_proxy_env() -> Option<HashMap<String, String>> {
    if PROXY_URL_ENV_KEYS
        .iter()
        .any(|key| std::env::var_os(key).is_some_and(|value| !value.is_empty()))
    {
        return None;
    }
    let settings = mac_system_proxy_settings()?;
    let mut envs = HashMap::new();
    if let Some(http_proxy) = mac_proxy_url(&settings, "HTTP") {
        envs.insert("HTTP_PROXY".to_string(), http_proxy.clone());
        envs.insert("http_proxy".to_string(), http_proxy);
    }
    if let Some(https_proxy) = mac_proxy_url(&settings, "HTTPS") {
        envs.insert("HTTPS_PROXY".to_string(), https_proxy.clone());
        envs.insert("https_proxy".to_string(), https_proxy);
    }
    if envs.is_empty() {
        return None;
    }
    if let Some(exceptions) = settings.get("__exceptions__") {
        envs.insert("NO_PROXY".to_string(), exceptions.clone());
        envs.insert("no_proxy".to_string(), exceptions.clone());
    }
    Some(envs)
}

/// Forwards this process' proxy settings to the sidecar. Node's global fetch ignores them
/// unless NODE_USE_ENV_PROXY is set before the process starts, so it is added here.
fn sidecar_proxy_envs() -> Option<HashMap<String, String>> {
    let mut envs: HashMap<String, String> = PROXY_ENV_KEYS
        .iter()
        .filter_map(|key| {
            let value = std::env::var(key).ok()?;
            (!value.is_empty()).then(|| ((*key).to_string(), value))
        })
        .collect();
    if envs.is_empty() {
        return None;
    }
    envs.insert("NODE_USE_ENV_PROXY".to_string(), "1".to_string());
    Some(envs)
}

#[cfg(target_os = "macos")]
fn mac_system_proxy_settings() -> Option<HashMap<String, String>> {
    let output = std::process::Command::new("scutil").arg("--proxy").output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(parse_mac_system_proxy(&String::from_utf8_lossy(&output.stdout)))
}

#[cfg(not(target_os = "macos"))]
fn mac_system_proxy_settings() -> Option<HashMap<String, String>> {
    None
}

/// Parses `scutil --proxy` output; exception hosts are collected under `__exceptions__`.
fn parse_mac_system_proxy(output: &str) -> HashMap<String, String> {
    let mut settings = HashMap::new();
    let mut exceptions: Vec<String> = Vec::new();
    let mut in_exceptions = false;
    for line in output.lines() {
        let trimmed = line.trim();
        if in_exceptions {
            if trimmed.starts_with('}') {
                in_exceptions = false;
            } else if let Some((_, host)) = trimmed.split_once(" : ") {
                let host = host.trim();
                if !host.is_empty() {
                    exceptions.push(host.to_string());
                }
            }
            continue;
        }
        if trimmed.starts_with("ExceptionsList") {
            in_exceptions = true;
            continue;
        }
        if let Some((key, value)) = trimmed.split_once(" : ") {
            settings.insert(key.trim().to_string(), value.trim().to_string());
        }
    }
    if !exceptions.is_empty() {
        settings.insert("__exceptions__".to_string(), exceptions.join(","));
    }
    settings
}

/// SOCKS is skipped on purpose: Node's env proxy support only understands HTTP proxies.
fn mac_proxy_url(settings: &HashMap<String, String>, scheme: &str) -> Option<String> {
    if settings.get(&format!("{scheme}Enable")).map(String::as_str) != Some("1") {
        return None;
    }
    let host = settings.get(&format!("{scheme}Proxy"))?.trim();
    let port = settings.get(&format!("{scheme}Port"))?.trim();
    if host.is_empty() || port.is_empty() {
        return None;
    }
    Some(format!("http://{host}:{port}"))
}

fn sidecar_launch_config_from_args(
    args: impl IntoIterator<Item = String>,
) -> SidecarLaunchConfig {
    let mut sidecar_args = vec!["--launch-json".to_string()];
    let mut process_args = args.into_iter().skip(1);
    while let Some(arg) = process_args.next() {
        if arg == "--workspace" {
            if let Some(value) = process_args.next() {
                sidecar_args.push("--workspace".to_string());
                sidecar_args.push(value.clone());
            }
        } else if let Some(value) = arg.strip_prefix("--workspace=") {
            if !value.is_empty() {
                sidecar_args.push("--workspace".to_string());
                sidecar_args.push(value.to_string());
            }
        }
    }
    SidecarLaunchConfig {
        args: sidecar_args,
    }
}

fn handle_stdout_chunk(
    buffer: &mut String,
    bytes: &[u8],
    window: &WebviewWindow,
    launch_token: &str,
    navigated: &mut bool,
) {
    buffer.push_str(&String::from_utf8_lossy(bytes));
    while let Some(newline) = buffer.find('\n') {
        let line = buffer[..newline].trim().to_string();
        buffer.drain(..=newline);
        try_navigate_ready_line(&line, window, launch_token, navigated);
    }
}

fn try_navigate_ready_line(
    line: &str,
    window: &WebviewWindow,
    launch_token: &str,
    navigated: &mut bool,
) {
    if *navigated || line.is_empty() {
        return;
    }
    let Ok(event) = serde_json::from_str::<StudioReadyEvent>(line) else {
        return;
    };
    if event.event != "agentmesh_studio_ready" {
        return;
    }
    let Ok(url) = url::Url::parse(&event.webview_url) else {
        eprintln!("AgentMesh sidecar reported an invalid launch URL");
        return;
    };
    if let Err(error) = set_studio_auth_cookie(window, &url, launch_token) {
            eprintln!("failed to prepare AgentMesh auth cookie, using launch URL token fallback: {error}");
    }
    let mut navigate_url = url;
    navigate_url
        .query_pairs_mut()
        .append_pair("token", launch_token);
    if let Err(error) = window.navigate(navigate_url) {
        eprintln!("failed to navigate AgentMesh window: {error}");
        return;
    }
    *navigated = true;
}

fn set_studio_auth_cookie(
    window: &WebviewWindow,
    url: &url::Url,
    launch_token: &str,
) -> Result<(), String> {
    if !is_expected_studio_url(url) {
        return Err("sidecar launch URL must be http://127.0.0.1:<port>/ without a query".into());
    }
    let cookie = Cookie::build(("agentmesh_studio_token", launch_token.to_string()))
        .domain("127.0.0.1")
        .path("/")
        .http_only(true)
        .same_site(SameSite::Strict)
        .build();
    window.set_cookie(cookie).map_err(|error| error.to_string())
}

fn is_expected_studio_url(url: &url::Url) -> bool {
    url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port().is_some()
        && url.path() == "/"
        && url.query().is_none()
        && url.fragment().is_none()
}

fn generate_launch_token() -> Result<String, getrandom::Error> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes)?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::{
        read_desktop_preferences,
        sidecar_launch_config_from_args,
        write_desktop_preferences,
        DesktopPreferences,
    };
    use std::{
        fs::{create_dir_all, remove_dir_all, write},
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn sidecar_keeps_explicit_workspace_as_an_argument_without_changing_cwd() {
        let workspace = "/tmp/agentmesh-workspace";
        let config = sidecar_launch_config_from_args([
            "agentmesh-studio-desktop".to_string(),
            "--workspace".to_string(),
            workspace.to_string(),
        ]);

        assert_eq!(
            config.args,
            vec![
                "--launch-json".to_string(),
                "--workspace".to_string(),
                workspace.to_string(),
            ],
        );
    }

    #[test]
    fn desktop_preferences_default_to_auto_update_enabled() {
        let dir = test_dir("default");
        let path = dir.join("preferences.json");

        assert_eq!(
            read_desktop_preferences(&path).expect("missing preferences should use defaults"),
            DesktopPreferences {
                auto_check_updates: true,
            },
        );
        let _ = remove_dir_all(dir);
    }

    #[test]
    fn desktop_preferences_read_and_write_native_json() {
        let dir = test_dir("roundtrip");
        create_dir_all(&dir).expect("create preference test directory");
        let path = dir.join("preferences.json");
        write(&path, r#"{"auto_check_updates":false}"#)
            .expect("seed desktop preferences");
        assert_eq!(
            read_desktop_preferences(&path).expect("read disabled preference"),
            DesktopPreferences {
                auto_check_updates: false,
            },
        );

        write_desktop_preferences(
            &path,
            &DesktopPreferences {
                auto_check_updates: true,
            },
        )
        .expect("persist enabled preference");
        assert_eq!(
            read_desktop_preferences(&path).expect("read persisted preference"),
            DesktopPreferences {
                auto_check_updates: true,
            },
        );
        let _ = remove_dir_all(dir);
    }

    #[test]
    fn corrupt_desktop_preferences_return_an_actionable_error() {
        let dir = test_dir("corrupt");
        create_dir_all(&dir).expect("create preference test directory");
        let path = dir.join("preferences.json");
        write(&path, "not-json").expect("seed corrupt desktop preferences");

        let error = read_desktop_preferences(&path)
            .expect_err("corrupt preferences must not be accepted");
        assert!(error.contains("desktop preferences are invalid"), "{error}");
        let _ = remove_dir_all(dir);
    }

    fn test_dir(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "agentmesh-desktop-preferences-{label}-{}-{nonce}",
            std::process::id(),
        ))
    }
}
