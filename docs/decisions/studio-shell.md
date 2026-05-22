# Studio Shell Decision

`schema_version`: 1

Decision: L8 Studio starts as a local web wrapper served by a small Node.js
process. Tauri and Electron are deferred until packaging, distribution, or
native desktop integration becomes a real requirement.

Final distribution target: AgentMesh should support both a signed macOS desktop
app and a developer CLI, backed by the same runtime/schema/protocol code but not
by the same installed binary.

## Sources Checked

- Tauri official docs: <https://tauri.app/start/>
- Tauri distribution docs: <https://v2.tauri.app/distribute/>
- Tauri updater plugin docs: <https://v2.tauri.app/plugin/updater/>
- Tauri sidecar docs: <https://v2.tauri.app/develop/sidecar/>
- Electron official docs: <https://www.electronjs.org/docs/latest/>
- Vite official docs: <https://vite.dev/guide/> and
  <https://vite.dev/guide/build>

## Constraints

- AgentMesh runtime is TypeScript on Node.
- Studio v1 must not import `packages/runtime`.
- Studio v1 mutations must call `agentmesh` CLI subprocesses.
- Packet files remain the source of truth.
- The first user is a local operator in one workspace.
- L8 should not introduce Rust, native installers, app signing, auto-updates, or
  OS integration before the UI proves value.

## Options

### Local Web Wrapper

Shape:

- `apps/studio` contains frontend assets and a narrow Node.js Studio server.
- The server reads packet files and spawns `agentmesh` CLI subprocesses.
- The browser UI talks only to the Studio server.
- The server remains a UI adapter, not a protocol runtime.

Pros:

- Stays inside the current TS/Node stack.
- No Rust toolchain or Chromium bundle.
- Fast to dogfood and test in this repo.
- Easy to keep CLI as the only mutation implementation.
- Works with Vite or a simple static asset build later.

Cons:

- Not a packaged desktop app.
- Requires a local port while Studio is running.
- Browser cannot directly access arbitrary workspace files without the local
  server.

Decision for L8: choose this.

### Tauri

Tauri is attractive for a later packaged desktop app because it uses a web
frontend with native webviews and can integrate native logic when needed. It is
also designed around a Rust-side application layer.

Why not now:

- It introduces Rust/native build prerequisites before AgentMesh has proven the
  Studio workflows.
- The first Studio mutation bridge only needs CLI subprocesses, not deep native
  integration.
- AgentMesh already decided Rust must not own packet, workflow, event, adapter,
  or release gate business logic.

Revisit when:

- Users need a signed desktop app.
- OS tray, file associations, native notifications, or secure local filesystem
  permissions become product requirements.
- A local web wrapper is the bottleneck rather than the protocol.

### Electron

Electron is mature and gives a bundled Chromium plus Node runtime, which makes
local file access and subprocess orchestration straightforward.

Why not now:

- It is heavier than the current need.
- It bundles a browser before Studio has validated its core workflows.
- It expands the app security and packaging surface immediately.

Revisit when:

- Cross-platform packaged desktop distribution matters more than bundle size and
  native dependency weight.
- Studio needs Chromium-consistent rendering that system webviews cannot provide.

## Implementation Boundary

L8 local web wrapper should expose only UI-shaped endpoints:

- list runs
- read status/events/artifacts
- preview artifact text
- run allowed CLI commands

It must not expose generic filesystem access or a general command runner. The
server should have an allowlist of commands matching the Studio scope decision.

## Deferred Decisions

- React vs plain TypeScript UI.
- Vite vs minimal static build.
- Tailwind/Radix/shadcn or local CSS.
- Tauri/Electron packaging.
- Local auth or access control.

These should be decided only when L8.3/L8.4 implementation pressure makes the
tradeoff real.

## Final Packaged Shape

The final macOS product does not need Mac App Store distribution. macOS is the
first packaged desktop target. The target is a Developer ID signed and
notarized DMG that installs `AgentMesh.app` into `/Applications`, with
app-managed updates after the first install. Windows and Linux packaging need
their own distribution decisions instead of inheriting the macOS DMG rules.

Recommended shape:

- `AgentMesh.app` is installed from a signed, notarized DMG.
- The app bundles its own compatible AgentMesh Core/App Server/CLI entrypoint.
- The app uses its bundled runtime by default and must not depend on a global
  `agentmesh` command from npm, Homebrew, or a user-managed Node version.
- The app can expose an optional "Install Command Line Tool" action that places
  a shim or symlink on the user's PATH, pointing back to the app-bundled CLI.
- The command-line-tool installer must not silently overwrite an existing
  `agentmesh` on PATH. It should detect collisions, explain the current target,
  and require user confirmation before replacing or shadowing it.
- Prefer a wrapper script over a raw symlink for the app-installed command-line
  tool so missing, moved, or deleted app bundles fail with an actionable error.
- App updates update the app-bundled runtime and UI together.
- npm updates update only the developer CLI installation.
- The update framework, update channel policy, failed-update behavior, and
  rollback story must be chosen before packaged desktop implementation begins.

The developer CLI remains a separate distribution channel:

- `npm install -g agentmesh` installs the terminal CLI.
- `agentmesh studio` starts a local Studio server and opens the system browser.
- The CLI Studio uses the npm-installed version of AgentMesh.
- The app Studio uses the app-bundled version of AgentMesh.

Both channels share code and packet contracts, but the physical installations
are intentionally independent. This prevents a desktop app from breaking because
the user's global npm package, Node version manager, or PATH changed.

## Desktop And CLI Coexistence

It is valid for one machine to have both:

- `/Applications/AgentMesh.app`
- a PATH-visible `agentmesh` CLI installed by npm, Homebrew, source checkout, or
  the app's optional command-line-tool installer

Default resolution rules:

- `AgentMesh.app` launches its own bundled runtime.
- App-originated Studio actions and App Server subprocess mutations use the
  app-bundled runtime/CLI entrypoint, not a PATH lookup.
- Terminal usage resolves `agentmesh` through the user's shell PATH.
- Entry-agent skills call the local `agentmesh` CLI the same way a terminal
  command does; they do not automatically reach into `AgentMesh.app`.
- If the user installs the app's command-line tool into PATH, entry agents may
  call that app-bundled CLI because it has become the PATH-visible command.

Shared data such as user config, project `.agentmesh/` directories, packets, and
run locks must stay compatible across app and CLI installations. The app and CLI
must rely on packet schema compatibility and single-writer locking rather than
assuming only one distribution channel exists on the machine.

Version skew rules:

- A newer app or CLI may read older compatible packet/config schemas.
- An older app or CLI that sees a newer unsupported schema must fail fast or
  degrade to read-only behavior; it must not overwrite files it cannot safely
  preserve.
- Packet/config migrations must be explicit and reversible enough for support
  workflows; silent rewrites during read-only inspection are not allowed.

Locking rules:

- A packaged App Server must use the same filesystem run-lock contract as the
  CLI for every packet mutation.
- A lock schema the caller does not understand must be treated as active and
  blocking, not ignored.
- Long-running App Server writes and short-lived CLI writes must contend on the
  same run directory lock before touching `status.json`, `events.jsonl`,
  `artifacts.toml`, or stage artifacts.

Config ownership rules:

- Project `.agentmesh/config.toml` remains project-owned.
- User config remains user-owned and shared across channels.
- App-only preferences should live in the app support directory, not in shared
  AgentMesh user config, unless CLI behavior must intentionally observe them.
- Shared config writers should prefer section-level ownership and validation
  over broad "last writer wins" rewrites.

## Final Transport Direction

For a packaged desktop app, avoid a fixed public localhost port as the product
contract. The app should start or connect to an AgentMesh App Server with a
per-launch auth token and a dynamically allocated `127.0.0.1` port for
high-throughput UI traffic such as event streams, logs, artifact previews, and
model output.

Dynamic port selection is a packaged desktop requirement. The current L8 local
web wrapper can keep a fixed development port. The packaged app must detect
port allocation or local network failures and surface an actionable error in the
UI instead of silently hanging.

Unix socket or stdio transport can still be used for private lifecycle/control
operations when it is a better fit, but the UI hot path should not require all
large or streaming payloads to double-hop through a Rust host process.

The CLI should keep its direct runtime path for workflow commands in terminal,
CI, and scripted usage. A long-running App Server/daemon is primarily for the
desktop app, browser Studio sessions, IDE integration, or future multi-client
local sessions.

## App Server Boundary

P4 fixes the App Server as a local UI adapter and lifecycle boundary. It serves
the Studio UI from the app bundle, binds a dynamic loopback port, requires a
per-launch token, exposes health checks, and supports graceful shutdown from
the desktop host. It does not become a second packet runtime.

App-originated actions use the app-bundled App Server and runtime APIs. Terminal and
entry-agent usage continues to resolve the PATH-visible `agentmesh` command.
The only exception is when the user explicitly installs the app command-line
tool into PATH; at that point entry agents may call the app-bundled CLI because
it has become the PATH-visible command.

App Server mutation must go through CLI/runtime commands and the existing
filesystem run-lock. The App Server must not write packet files directly, must
not bypass `.agentmesh.lock/lease.json`, and must treat unknown lock schemas as
active/blocking. Unsupported newer packet or config schemas must fail fast for
mutation or degrade to read-only inspection; silent rewrites are not allowed.

The detailed contract lives in `docs/contracts/app-server.md`.

## Desktop Distribution Stack

P4.2 chooses Tauri 2 as the default desktop host and distribution stack for the
first packaged AgentMesh Studio release. The first target remains macOS DMG
distribution with Developer ID signing, notarization, app-managed signed update
artifacts, and an app-bundled runtime/App Server/CLI sidecar.

Electron remains a fallback only for verified Chromium API requirements,
`node-pty` / native Node module requirements, or measured Tauri sidecar
packaging failure. The detailed distribution and updater policy lives in
`docs/decisions/studio-distribution.md`.
