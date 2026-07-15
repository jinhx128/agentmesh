# Desktop CLI Management And Copilot Removal Design

## Goal

Make Desktop manage the public `@jinhx128/agentmesh` npm CLI as a real installed tool, and remove Copilot completely from AgentMesh's active product surface.

## Current Facts

- Desktop currently writes an app-managed shell wrapper into a user-selected bin directory.
- PATH commands that are not wrappers report `unknown` because Desktop does not execute `agentmesh --version`.
- The UI exposes a bin path input and a PATH-shadowing confirmation checkbox.
- Copilot remains in the CLI target parser, Skill target type, canonical Skill, Desktop UI/API, distribution metadata, README, active docs, and tests.

## Approved Behavior

### CLI discovery

Desktop resolves `agentmesh` through the same desktop-aware discovery policy used for provider CLIs: process PATH, well-known user/system bin directories, and a login-shell probe. When found, Desktop executes the resolved absolute path with `--version` using a five-second timeout and reports the parsed semantic version, absolute path, source, and diagnostics.

Desktop queries `https://registry.npmjs.org/@jinhx128%2Fagentmesh/latest` for the current public npm version. Registry failure must not hide the installed CLI; it produces an `unknown` latest-version state and an actionable network diagnostic.

### CLI install and update

The UI has no path input and no PATH-shadowing checkbox. It shows one primary action derived from state:

- missing: Install CLI
- installed and older than npm latest: Update CLI
- current: Reinstall CLI, available as a secondary recovery action
- npm unavailable: Retry check; install remains possible when an npm executable is available

Desktop resolves `npm` with the same discovery policy and runs the absolute executable with `install --global @jinhx128/agentmesh@latest --no-audit --no-fund`. It never invokes a shell and never requests administrator privileges. After npm exits, Desktop re-runs command discovery and version probing. The response reflects the command that the user's login environment will actually execute, so PATH shadowing becomes a diagnosis instead of a destructive confirmation flow.

Permission, network, missing npm, timeout, and PATH-shadowing failures retain stderr/stdout excerpts and provide concise remediation. Desktop no longer creates or updates app-managed wrappers.

### Copilot removal

Remove `copilot` from `SkillTarget`, `AgentMeshSkillTarget`, `--target` parsing, canonical AgentMesh Skill instructions, Desktop API/UI/manual, distribution metadata/smoke tests, README, website, roadmap, active distribution docs, and active contracts. Historical changelog, archived plans, and review records remain unchanged. The application must not delete Skill files already present on the user's disk.

## Interfaces

`StudioCommandLineToolReport` becomes a public npm CLI report containing `supported`, `package_name`, `installed`, `path`, `source`, `installed_version`, `latest_version`, `status`, and `diagnostics`. `status` is `missing`, `current`, `update_available`, or `unknown`.

`POST /api/desktop/integrations/command-line-tool` accepts an empty JSON object and performs install/update/reinstall. The response contains the refreshed integration report plus an `operation` object with npm path, arguments, exit status, and diagnostics. No request field controls filesystem paths or overwrite behavior.

## Error Handling

- Registry HTTP or JSON errors: return the installed report with `latest_version: "unknown"` and diagnostics; do not fail the whole settings page.
- Missing npm: return HTTP 400 with a message explaining that Node.js/npm must be installed and visible to the login shell.
- npm non-zero exit: return HTTP 400 with a bounded diagnostic that distinguishes common permission and network failures.
- Successful npm command but stale PATH command: return HTTP 409 with the refreshed report and a PATH-order diagnostic.
- Version output without a semantic version: preserve the output in diagnostics and report `installed_version: "unknown"`.

## Testing

Use fake executable files and an injected registry fetch in Node tests. Cover PATH/login-shell discovery, real version probing, registry failure, install arguments, post-install re-probe, permission/network failure mapping, and stale PATH detection. UI rendering tests cover the state-derived actions and absence of path controls and Copilot.

## Non-Goals

- Do not manage Node.js or npm installation.
- Do not silently edit shell profiles.
- Do not delete existing user Copilot Skill files.
- Do not publish a new npm version as part of this implementation unless separately requested.
