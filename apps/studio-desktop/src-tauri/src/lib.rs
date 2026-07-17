use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};
use tauri::{
    webview::{cookie::SameSite, Cookie},
    AppHandle, Manager, WebviewWindow,
};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

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
        .run(tauri::generate_context!())
        .expect("failed to run AgentMesh desktop shell");
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
                match sidecar_config.current_dir {
                    Some(current_dir) => command.current_dir(current_dir),
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
    current_dir: Option<String>,
}

fn sidecar_launch_config_from_args(
    args: impl IntoIterator<Item = String>,
) -> SidecarLaunchConfig {
    let mut sidecar_args = vec!["--launch-json".to_string()];
    let mut current_dir = None;
    let mut process_args = args.into_iter().skip(1);
    while let Some(arg) = process_args.next() {
        if arg == "--workspace" {
            if let Some(value) = process_args.next() {
                sidecar_args.push("--workspace".to_string());
                sidecar_args.push(value.clone());
                current_dir = Some(value);
            }
        } else if let Some(value) = arg.strip_prefix("--workspace=") {
            if !value.is_empty() {
                sidecar_args.push("--workspace".to_string());
                sidecar_args.push(value.to_string());
                current_dir = Some(value.to_string());
            }
        }
    }
    SidecarLaunchConfig {
        args: sidecar_args,
        current_dir,
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
    fn sidecar_uses_explicit_workspace_as_its_working_directory() {
        let workspace = "/tmp/agentmesh-workspace";
        let config = sidecar_launch_config_from_args([
            "agentmesh-studio-desktop".to_string(),
            "--workspace".to_string(),
            workspace.to_string(),
        ]);

        assert_eq!(config.current_dir.as_deref(), Some(workspace));
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
