use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::Deserialize;
use tauri::{
    webview::{cookie::SameSite, Cookie},
    Manager, WebviewWindow,
};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

#[derive(Deserialize)]
struct StudioReadyEvent {
    event: String,
    webview_url: String,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            start_app_server_sidecar(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run AgentMesh Studio desktop shell");
}

fn start_app_server_sidecar(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let window = app
        .get_webview_window("main")
        .ok_or("missing main AgentMesh Studio window")?;
    let app_handle = app.handle().clone();
    let launch_token = generate_launch_token().map_err(|error| {
        std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("failed to generate AgentMesh Studio launch token: {error}"),
        )
    })?;
    let sidecar_args = sidecar_launch_args();

    tauri::async_runtime::spawn(async move {
        let command = match app_handle.shell().sidecar("agentmesh-studio-sidecar") {
            Ok(command) => command.args(sidecar_args),
            Err(error) => {
                eprintln!("failed to create AgentMesh Studio sidecar command: {error}");
                return;
            }
        };
        let (mut events, mut child) = match command.spawn() {
            Ok(spawned) => spawned,
            Err(error) => {
                eprintln!("failed to start AgentMesh Studio sidecar: {error}");
                return;
            }
        };
        let handshake = serde_json::json!({
            "schema_version": 1,
            "studio_token": launch_token.as_str(),
        })
        .to_string();
        if let Err(error) = child.write(format!("{handshake}\n").as_bytes()) {
            eprintln!("failed to send AgentMesh Studio launch handshake: {error}");
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
                        eprintln!("AgentMesh Studio sidecar exited before readiness: {status:?}");
                    }
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

fn sidecar_launch_args() -> Vec<String> {
    let mut sidecar_args = vec!["--launch-json".to_string()];
    let mut process_args = std::env::args().skip(1);
    while let Some(arg) = process_args.next() {
        if arg == "--workspace" {
            if let Some(value) = process_args.next() {
                sidecar_args.push("--workspace".to_string());
                sidecar_args.push(value);
            }
        } else if let Some(value) = arg.strip_prefix("--workspace=") {
            if !value.is_empty() {
                sidecar_args.push("--workspace".to_string());
                sidecar_args.push(value.to_string());
            }
        }
    }
    sidecar_args
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
        eprintln!("AgentMesh Studio sidecar reported an invalid launch URL");
        return;
    };
    if let Err(error) = set_studio_auth_cookie(window, &url, launch_token) {
        eprintln!("failed to prepare AgentMesh Studio auth cookie, using launch URL token fallback: {error}");
    }
    let mut navigate_url = url;
    navigate_url
        .query_pairs_mut()
        .append_pair("token", launch_token);
    if let Err(error) = window.navigate(navigate_url) {
        eprintln!("failed to navigate AgentMesh Studio window: {error}");
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
