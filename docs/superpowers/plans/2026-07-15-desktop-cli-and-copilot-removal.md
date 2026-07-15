# Desktop CLI Management And Copilot Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Desktop's wrapper writer with public npm CLI detection/install/update and remove Copilot from all active AgentMesh product surfaces.

**Architecture:** Reuse the runtime's desktop-aware executable resolver, add bounded version and npm operations in the app-server integration boundary, and keep the React panel as a state renderer. Delete Copilot at the canonical Skill type/parser first so compiler and test failures identify every active consumer.

**Tech Stack:** TypeScript, Node.js child processes and fetch, React 19, Mantine, `node:test`

## Global Constraints

- Manage only `@jinhx128/agentmesh@latest` from the public npm registry.
- Do not accept a bin directory or overwrite confirmation from the UI/API.
- Do not invoke a shell, edit shell profiles, request elevation, or write app wrappers.
- Execute absolute resolved paths with bounded timeouts and bounded diagnostics.
- Do not delete existing Copilot Skill files from user disks.
- Preserve historical changelog, archive, and review records.
- Do not bump versions or publish npm/GitHub artifacts in this plan.

---

### Task 1: Remove Copilot From Canonical Skill Contracts

**Files:**
- Modify: `packages/skills/src/verify.ts`
- Modify: `packages/cli/src/commands/skill.ts`
- Modify: `packages/skills/agentmesh-skill/SKILL.md`
- Modify: `tests-node/readiness.test.ts`
- Modify: `tests-node/cli-surface.test.ts`

**Interfaces:**
- Produces: `SkillTarget = "codex" | "claude" | "cursor" | "antigravity" | "opencode"`.

- [ ] **Step 1: Write failing parser and canonical Skill assertions**

Add assertions that `agentmesh skill install --target copilot` fails with `unsupported target`, no expected Copilot file is returned, and canonical Skill markdown contains no case-insensitive `copilot`.

- [ ] **Step 2: Verify RED**

Run: `npm run build:node && node --test dist-node/tests-node/readiness.test.js dist-node/tests-node/cli-surface.test.js`

Expected: FAIL because `copilot` remains accepted and documented.

- [ ] **Step 3: Remove the target and its canonical instructions**

Delete the union member, target guard entry, CLI parser entry, canonical install example, and target description. Update shared-target tests to the five supported targets without deleting any fixture/user file.

- [ ] **Step 4: Verify GREEN**

Run: `npm run build:node && node --test dist-node/tests-node/readiness.test.js dist-node/tests-node/cli-surface.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add packages/skills packages/cli tests-node/readiness.test.ts tests-node/cli-surface.test.ts && git commit -m "移除 Copilot Skill 目标"`

---

### Task 2: Model And Detect The Public npm CLI

**Files:**
- Modify: `packages/app-server/src/integrations.ts`
- Modify: `packages/app-server/src/server.ts`
- Modify: `apps/studio-desktop/src/host.ts`
- Modify: `tests-node/studio-desktop-options.test.ts`

**Interfaces:**
- Produces: asynchronous `readStudioIntegrations(...)` and `StudioCommandLineToolReport` with `package_name`, `installed`, `path`, `source`, `installed_version`, `latest_version`, `status`, and `diagnostics`.
- Consumes: `resolveProviderTool(agent, { enabled: true, workspace })` and an injectable registry fetch.

- [ ] **Step 1: Write failing discovery tests**

Create executable fixtures that emit `agentmesh 0.1.9`, inject registry JSON `{ "version": "0.1.10" }`, and assert `status: "update_available"`, the absolute executable path, and parsed versions. Add registry-failure and malformed-version cases.

- [ ] **Step 2: Verify RED**

Run: `npm run build:node && node --test --test-name-pattern "public npm CLI" dist-node/tests-node/studio-desktop-options.test.js`

Expected: FAIL because the report still exposes wrapper fields and never executes external commands.

- [ ] **Step 3: Implement minimal detection**

Use an `AgentConfig` for command `agentmesh`, resolve it with the shared resolver, execute `["--version"]` directly with a 5,000 ms timeout, extract the first `x.y.z` token, and fetch the encoded npm latest endpoint. Compare numeric semantic-version triplets; unsupported output yields `unknown` without guessing.

- [ ] **Step 4: Make server reads asynchronous**

Await the integrations report in GET and after Skill installation. Remove the app-wrapper source from Desktop host because bundled CLI resources are no longer an install source.

- [ ] **Step 5: Verify GREEN**

Run: `npm run build:node && node --test --test-name-pattern "public npm CLI|desktop integrations" dist-node/tests-node/studio-desktop-options.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

Run: `git add packages/app-server apps/studio-desktop/src tests-node/studio-desktop-options.test.ts && git commit -m "重构 Desktop npm CLI 检测"`

---

### Task 3: Install And Update Through npm

**Files:**
- Modify: `packages/app-server/src/integrations.ts`
- Modify: `packages/app-server/src/server.ts`
- Modify: `tests-node/studio-desktop-options.test.ts`

**Interfaces:**
- Produces: `installStudioCommandLineTool({}, options): Promise<InstallCommandLineToolResult>`.
- Operation command: `<resolved npm> install --global @jinhx128/agentmesh@latest --no-audit --no-fund`.

- [ ] **Step 1: Write failing npm operation tests**

Use a fake absolute npm executable to capture argv and install a fake `agentmesh`; assert exact arguments, refreshed version, missing-npm error, non-zero permission/network diagnostics, and HTTP 409 when the post-install resolved command remains stale.

- [ ] **Step 2: Verify RED**

Run: `npm run build:node && node --test --test-name-pattern "install or update public npm CLI" dist-node/tests-node/studio-desktop-options.test.js`

Expected: FAIL because the endpoint writes a wrapper and accepts path fields.

- [ ] **Step 3: Implement npm execution and error mapping**

Resolve `npm` with the shared resolver, use `execFile`/`spawn` without a shell, cap output and duration, then refresh the registry and installed command report. Preserve the refreshed report on stale PATH conflicts.

- [ ] **Step 4: Verify GREEN**

Run: `npm run build:node && node --test --test-name-pattern "install or update public npm CLI" dist-node/tests-node/studio-desktop-options.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add packages/app-server tests-node/studio-desktop-options.test.ts && git commit -m "支持 Desktop 安装和更新 npm CLI"`

---

### Task 4: Replace The Desktop CLI Controls And Remove Copilot UI

**Files:**
- Modify: `apps/studio-web/src/api/integrations.ts`
- Modify: `apps/studio-web/src/features/settings/AgentIntegrationsPanel.tsx`
- Modify: `apps/studio-web/src/app/App.tsx`
- Modify: `apps/studio-web/src/features/manual/ManualView.tsx`
- Modify: `tests-node/studio-ui.test.ts`

**Interfaces:**
- Consumes: empty install request and the new CLI report.
- Produces: state-derived Install/Update/Reinstall controls without path or confirmation inputs.

- [ ] **Step 1: Write failing UI assertions**

Render missing, update-available, and current fixtures. Assert the correct action labels/version/path/diagnostics, no bin-path input, no PATH checkbox, and no Copilot target or manual copy.

- [ ] **Step 2: Verify RED**

Run: `npm run build:node && node --test --test-name-pattern "Agent integrations" dist-node/tests-node/studio-ui.test.js`

Expected: FAIL against current wrapper UI.

- [ ] **Step 3: Implement state rendering and request changes**

Remove `TextInput`, command path state, and confirmation state. Submit `{}` and disable the primary command during the operation. Keep actual path and diagnostics read-only.

- [ ] **Step 4: Verify GREEN**

Run: `npm run build && node --test dist-node/tests-node/studio-ui.test.js dist-node/tests-node/studio-desktop-options.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add apps/studio-web tests-node/studio-ui.test.ts && git commit -m "改造 Desktop CLI 管理界面"`

---

### Task 5: Remove Copilot From Active Documentation And Distribution

**Files:**
- Modify: `README.md`
- Modify: `index.html`
- Modify: `docs/roadmap.md`
- Modify: `docs/contracts/skill-output.md`
- Modify: `docs/distribution/cli-command-install.md`
- Modify: `docs/distribution/studio-macos.md`
- Modify: `docs/distribution/studio-coexistence-smoke.md`
- Modify: `apps/studio-desktop/distribution/macos.json`
- Modify: `apps/studio-desktop/src/distribution-smoke.ts`
- Modify: relevant Node tests

**Interfaces:**
- Produces: active docs/metadata advertising only Codex, Claude Code, Cursor, Antigravity CLI, and OpenCode.

- [ ] **Step 1: Add a failing active-surface scan**

Assert that canonical source, active docs, UI, CLI, and distribution files do not match `/copilot/i`; explicitly exclude `changelog/`, `docs/archive/`, `docs/reviews/`, and already-committed historical plans/specs.

- [ ] **Step 2: Verify RED**

Run: `npm run build:node && node --test --test-name-pattern "active product contains no Copilot" dist-node/tests-node/package-structure.test.js`

Expected: FAIL listing active references.

- [ ] **Step 3: Update active surfaces and expectations**

Delete Copilot examples and prose, update target arrays, and rewrite wrapper-specific documentation for npm management.

- [ ] **Step 4: Verify GREEN and full regression**

Run: `npm test && npm run studio-desktop:package:dev && git diff --check`

Expected: all Node tests and distribution smoke pass with no active Copilot reference.

- [ ] **Step 5: Commit**

Run: `git add README.md index.html docs apps/studio-desktop tests-node && git commit -m "同步 CLI 管理与 Copilot 移除文档"`

## Completion Gate

- CLI missing/current/update states are verified with real executable fixtures.
- npm arguments and failures are verified without a shell.
- UI has no path input or shadowing checkbox.
- Active product scan has no Copilot reference.
- Full Node suite, frontend build, Desktop dev package smoke, and `git diff --check` pass.

