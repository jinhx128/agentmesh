# Tauri App Updater Design

## Goal

Add a signed, in-app macOS update flow to AgentMesh Desktop and extend the release pipeline to publish the artifacts consumed by Tauri updater.

## Current Facts

- `createUpdaterArtifacts: true` and updater endpoints exist in `tauri.conf.json`.
- The updater public key is a placeholder, `tauri-plugin-updater` is not initialized, and updater permissions are absent.
- Release builds request only a DMG and publish no updater archive, signature, or `latest.json`.
- Installed `0.1.10` contains no working updater, so it cannot bootstrap itself into the first updater-enabled release.

## Approved Behavior

### Desktop update experience

Settings / About gains a native App Update section that is only active inside Tauri. It shows the installed app version and one of: idle, checking, current, update available, downloading, ready to restart, or error. Users can check explicitly. When an update is available, one command downloads it while displaying byte progress, validates its updater signature, installs it, and relaunches the app.

Browser Studio keeps the existing release-information view and does not attempt to call native updater APIs. Native API detection and dynamic imports prevent browser/test builds from requiring a Tauri runtime.

### Native integration

Use official Tauri v2 plugins `tauri-plugin-updater` and `tauri-plugin-process`. Initialize both in the Rust builder and grant only updater check/download/install and process relaunch permissions to the main window capability.

The stable endpoint is:

`https://github.com/jinhx128/agentmesh/releases/latest/download/latest.json`

The updater public key is committed in `tauri.conf.json`. The matching private key never enters git. It lives in the local release environment with mode `0600`; its password is stored outside the repository. Tauri receives both only through `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` during a release build.

### Release artifacts

Release builds include both `app` and `dmg` targets and require updater signing credentials. The release preparation step copies/renames the generated updater archive and signature to:

- `AgentMesh_<version>_aarch64.app.tar.gz`
- `AgentMesh_<version>_aarch64.app.tar.gz.sig`

It also generates `latest.json` with `version`, release notes, RFC 3339 `pub_date`, and a `darwin-aarch64` platform entry whose URL points at the immutable `v<version>` GitHub Release asset and whose signature is the exact `.sig` content. All three files enter checksums, GitHub upload, and remote verification.

Release preparation fails before upload when the public key is a placeholder, credentials are absent, the archive/signature is absent, or metadata references the wrong version/URL/signature.

## Migration

The first updater-enabled version must still be installed manually from its DMG by users currently on `0.1.10`. Every updater-enabled version after that can update in-app. Release notes and active installation docs must state this one-time transition.

The app remains Apple Silicon-only and may remain without Apple notarization under the current distribution policy. Tauri updater signing is mandatory and independent of Apple code signing.

## Testing

- Node contract tests validate plugin dependencies, Rust initialization, capability permissions, endpoint, real public key, `app` target, release asset names, metadata contents, and checksum coverage.
- Frontend rendering tests validate native-only controls and all updater states using an injected updater bridge.
- Rust compilation and Tauri dev packaging validate plugin integration.
- A signed local `app` + `dmg` build validates archive and signature generation without publishing.
- The installed app is smoke-tested for startup and updater check behavior; an end-to-end upgrade requires two published versions and is not claimed in this change.

## Non-Goals

- Do not add beta-channel selection.
- Do not build Intel or Windows updater artifacts.
- Do not upload or publish a release unless separately requested.
- Do not commit private signing material or passwords.
