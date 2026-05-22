# P3 Tauri Shell Wiring Review - 2026-05-17

## Scope

Reviewed P3.1: wiring the Tauri shell to the app-bundled AgentMesh App Server
without moving AgentMesh behavior into the desktop shell.

Implemented shape:

- Tauri opens a bundled local bootstrap page from `apps/studio-desktop/shell`.
- The Rust shell initializes `tauri-plugin-shell`.
- The Rust shell starts the configured `main` sidecar with `--launch-json`.
- The Node sidecar starts the tokenized App Server with built React assets.
- The sidecar emits a single `agentmesh_studio_ready` JSON event containing the
  dynamic `127.0.0.1` WebView URL.
- The Rust shell parses that event and navigates the main window to the
  tokenized App Server URL.

## Verification

- Red targeted tests:
  - `npm run build:node && node --test dist-node/tests-node/studio-desktop-options.test.js`
  - Result: failed as expected before implementation because
    `serializeStudioDesktopLaunchEvent` and asset-dir parsing did not exist.
- Green targeted tests:
  - `npm run build && node --test dist-node/tests-node/studio-desktop-options.test.js dist-node/tests-node/studio-desktop-distribution.test.js`
  - Result: pass, 13/13.
- Sidecar launch smoke:
  - Spawned `node dist-node/apps/studio-desktop/src/main.js --launch-json`.
  - Parsed `agentmesh_studio_ready`.
  - Fetched the redacted dynamic WebView URL and confirmed the response loads
    built React assets under `/assets/index-*.js`.
- Development distribution smoke:
  - `npm run studio-desktop:package:dev`
  - Result: pass. Summary now reports `frontendDist="../shell"` and
    `bootstrapPage="index.html"`.
- Desktop shell source scan:
  - `rg -n "packages/runtime|@agentmesh/runtime|status\\.json|events\\.jsonl|artifacts\\.toml|\\.agentmesh|workflow|packet" apps/studio-desktop/src-tauri/src apps/studio-desktop/shell`
  - Result: no matches.
- `git diff --check`
  - Result: pass.

Not run locally:

- Real Tauri WKWebView app launch.
- Rust compilation of `apps/studio-desktop/src-tauri`.

The local host still lacks Rust/Cargo and a Tauri CLI. The implemented source
path is ready for that packaging-host smoke, but this review does not claim a
real WKWebView launch happened on this machine.

## Review

Must Fix findings: 0 for P3.1.

Accepted findings:

- The Tauri shell remains lifecycle-only. It starts the sidecar, consumes the
  sidecar readiness event, and navigates the window.
- The React UI remains served by the App Server and talks through App Server
  APIs only.
- Desktop mode now defaults to the built Vite React asset directory instead of
  falling back to embedded legacy Studio assets.
- The machine-readable sidecar launch event carries the tokenized WebView URL
  for the shell, but does not add a separate `token` field.
- Distribution smoke now guards the bundled bootstrap page and Tauri shell
  frontend directory.

Deferred findings:

- Real WKWebView behavior must be verified on a Tauri-capable packaging host.
- Packaged executable wrapper behavior still belongs to P3.2.
- Unsigned DMG installation remains P3.4.

## Verdict

Ready for P3.2. P3.1 wires the source-level Tauri shell path to the dynamic,
tokenized App Server and keeps AgentMesh behavior out of the desktop shell.
