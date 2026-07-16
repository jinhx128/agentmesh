# Tauri App Updater Implementation Plan

> 状态（2026-07-16）：历史已完成。Updater、签名产物和应用内状态机由 `3db1892` 及 `0.1.11` 发布链交付；下方未勾选项不再作为执行状态。当前唯一事实源为 `2026-07-16-studio-activity-and-v012-release.md`。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add signed in-app update/check/install/relaunch behavior and publishable Tauri updater artifacts.

**Architecture:** Keep updater mechanics in a small browser-safe bridge that dynamically loads official Tauri plugins, render its state in Settings/About, and extend the existing release script to package immutable updater artifacts plus `latest.json`. The repository contains only the updater public key; local release credentials remain external.

**Tech Stack:** Tauri 2, Rust, React 19, TypeScript, Node.js release tooling, minisign-compatible Tauri updater signatures

## Global Constraints

- Stable endpoint is `https://github.com/jinhx128/agentmesh/releases/latest/download/latest.json`.
- Private signing key and password never enter git or command output.
- Release build requires updater credentials and produces both `app` and `dmg` bundles.
- App remains macOS 12+, Apple Silicon-only, and unsigned by Apple under current policy.
- Browser Studio never invokes Tauri APIs.
- Do not bump versions or publish a GitHub/npm release in this plan.

---

### Task 1: Lock The Native Updater Contract

**Files:**
- Modify: `tests-node/studio-desktop-distribution.test.ts`
- Modify: `tests-node/package-structure.test.ts`

**Interfaces:**
- Produces: tests for Cargo/plugin dependencies, Rust initialization, Tauri capabilities, endpoint/public key, app target, and release asset metadata.

- [ ] **Step 1: Write failing distribution assertions**

Assert `tauri-plugin-updater` and `tauri-plugin-process` dependencies, `.plugin(tauri_plugin_updater::Builder::new().build())`, `.plugin(tauri_plugin_process::init())`, updater/process capability permissions, `app` + `dmg` targets, a non-placeholder public key, latest-release endpoint, versioned archive/signature, and `latest.json` release assets.

- [ ] **Step 2: Verify RED**

Run: `npm run build:node && node --test dist-node/tests-node/studio-desktop-distribution.test.js dist-node/tests-node/package-structure.test.js`

Expected: FAIL on every missing native/update release contract.

---

### Task 2: Install And Configure Official Tauri Plugins

**Files:**
- Modify: `apps/studio-desktop/src-tauri/Cargo.toml`
- Modify: `apps/studio-desktop/src-tauri/Cargo.lock`
- Modify: `apps/studio-desktop/src-tauri/src/lib.rs`
- Modify: `apps/studio-desktop/src-tauri/capabilities/default.json`
- Modify: `apps/studio-desktop/src-tauri/tauri.conf.json`
- Modify: `apps/studio-desktop/distribution/macos.json`
- Modify: `apps/studio-web/package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: updater/process plugin APIs available only to the main window.

- [ ] **Step 1: Add official dependencies**

Use Cargo/npm package versions compatible with the repository's current Tauri 2 release. Add `@tauri-apps/plugin-updater` and `@tauri-apps/plugin-process` to Studio Web.

- [ ] **Step 2: Initialize plugins and permissions**

Register both Rust plugins. Grant updater default/check/download-and-install and process relaunch permissions. Add `app` to bundle targets and replace the endpoint.

- [ ] **Step 3: Generate a protected updater key outside the repository**

Generate only when the configured local key path does not exist. Write the private key outside the workspace with `0600`, store/protect its password outside git, and patch only the resulting public key into Tauri config. Never print or stage private material.

- [ ] **Step 4: Verify GREEN for native contracts**

Run: `cargo check --manifest-path apps/studio-desktop/src-tauri/Cargo.toml && npm run build:node && node --test dist-node/tests-node/studio-desktop-distribution.test.js dist-node/tests-node/package-structure.test.js`

Expected: native/plugin assertions pass; release-asset assertions remain RED until Task 4.

- [ ] **Step 5: Commit**

Run: `git add apps/studio-desktop/src-tauri apps/studio-desktop/distribution/macos.json apps/studio-web/package.json package-lock.json tests-node && git commit -m "接入 Tauri App 更新插件"`

---

### Task 3: Build The Browser-Safe Updater UI

**Files:**
- Create: `apps/studio-web/src/api/desktop-updater.ts`
- Modify: `apps/studio-web/src/features/settings/SettingsAboutPanel.tsx`
- Modify: `apps/studio-web/src/features/settings/SettingsView.tsx`
- Modify: `apps/studio-web/src/app/App.tsx`
- Modify: `apps/studio-web/src/app/copy.ts`
- Modify: `tests-node/studio-ui.test.ts`

**Interfaces:**
- Produces: `DesktopUpdaterState` and `checkDesktopAppUpdate()` / `installDesktopAppUpdate(onProgress)` bridge functions.
- Consumes: dynamically imported Tauri updater/process plugins only when `window.__TAURI_INTERNALS__` exists.

- [ ] **Step 1: Write failing state-rendering tests**

Cover browser unavailable, idle/checking/current/update-available/downloading/error states, byte progress, Check Update, Install and Restart, and disabled in-flight controls.

- [ ] **Step 2: Verify RED**

Run: `npm run build:node && node --test --test-name-pattern "desktop app updater" dist-node/tests-node/studio-ui.test.js`

Expected: FAIL because no native updater section exists.

- [ ] **Step 3: Implement the dynamic bridge**

Detect Tauri without importing plugins at module initialization. Retain the returned `Update` object in module state only after a successful check. Forward `Started`, `Progress`, and `Finished` download events to normalized byte progress; after installation call `relaunch()`.

- [ ] **Step 4: Implement the About state machine**

Keep native updater state separate from the existing server release report. Render concise status and error diagnostics with one primary command at a time.

- [ ] **Step 5: Verify GREEN**

Run: `npm run build && node --test --test-name-pattern "desktop app updater|Settings About" dist-node/tests-node/studio-ui.test.js`

Expected: PASS and browser build contains no eager Tauri invocation.

- [ ] **Step 6: Commit**

Run: `git add apps/studio-web tests-node/studio-ui.test.ts && git commit -m "增加桌面应用内更新界面"`

---

### Task 4: Generate And Publish Updater Metadata Assets

**Files:**
- Modify: `scripts/github-release-assets.mjs`
- Modify: `scripts/github-release.mjs`
- Modify: `tests-node/github-release-assets.test.ts`
- Modify: `apps/studio-desktop/src/distribution-smoke.ts`
- Modify: `docs/distribution/github-release.md`
- Modify: `docs/distribution/studio-macos.md`

**Interfaces:**
- Produces: `AgentMesh_<version>_aarch64.app.tar.gz`, matching `.sig`, and `latest.json` with a `darwin-aarch64` platform.

- [ ] **Step 1: Write failing pure metadata tests**

Test deterministic asset names, metadata URL `https://github.com/jinhx128/agentmesh/releases/download/v<version>/<encoded asset>`, exact signature trimming, RFC 3339 date, and rejection of missing/mismatched fields.

- [ ] **Step 2: Verify RED**

Run: `npm run build:node && node --test dist-node/tests-node/github-release-assets.test.js dist-node/tests-node/studio-desktop-distribution.test.js`

Expected: FAIL because the release asset set contains only DMG/tarball/Skill/checksums.

- [ ] **Step 3: Implement artifact preparation**

Build `app,dmg`, require signing environment, copy versioned updater artifacts into `dist-release`, generate `latest.json`, include all assets in SHA256SUMS, upload them to `v<version>`, and verify remote size/digest.

- [ ] **Step 4: Update distribution smoke and docs**

Validate real public key, app target, latest endpoint, release scripts, and one-time manual migration from `0.1.10`.

- [ ] **Step 5: Verify GREEN**

Run: `npm run build:node && node --test dist-node/tests-node/github-release-assets.test.js dist-node/tests-node/studio-desktop-distribution.test.js dist-node/tests-node/package-structure.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

Run: `git add scripts apps/studio-desktop docs/distribution tests-node && git commit -m "扩展桌面更新发布产物"`

---

### Task 5: Produce A Signed Local Build And Install It

**Files:**
- Generated/verify only: `apps/studio-desktop/src-tauri/target/debug/bundle/`
- Install locally: `/Applications/AgentMesh.app`

**Interfaces:**
- Consumes: external signing credentials and committed public key.
- Produces: signed updater archive/signature, valid DMG, and locally installed updater-enabled app.

- [ ] **Step 1: Run full automated verification**

Run: `npm test && cargo check --manifest-path apps/studio-desktop/src-tauri/Cargo.toml && npm run studio-desktop:package:dev && git diff --check`

Expected: all Node tests, Rust check, package smoke, and diff check pass.

- [ ] **Step 2: Build signed updater artifacts locally**

Load the private key/password into process environment without printing them, then run Tauri debug build for `app,dmg`. Assert non-empty `.app.tar.gz` and `.sig`; run `hdiutil verify` on the DMG.

- [ ] **Step 3: Prepare release assets without upload**

Run the release preparation path with the signed build reused. Validate `latest.json` against the archive/signature and checksum list. Do not publish.

- [ ] **Step 4: Replace and launch the real app**

Quit AgentMesh, mount the fresh DMG, replace `/Applications/AgentMesh.app`, launch it with the repository workspace, and verify version/process/startup. Use Settings/About to confirm updater check returns either current or a clear missing-metadata error for the pre-updater `0.1.10` release.

- [ ] **Step 5: Commit any final documentation corrections**

Run: `git add docs README.md && git commit -m "补充桌面更新迁移说明"` only when tracked docs changed.

## Completion Gate

- Official updater/process plugins compile and have least-privilege capabilities.
- Browser and Tauri updater states render correctly.
- Public key is real; private key remains outside git.
- Signed updater archive/signature and valid `latest.json` are produced locally.
- Full Node tests, Rust check, Desktop smoke, DMG validation, local install/startup, and `git diff --check` pass.
- Publishing is explicitly not performed.
