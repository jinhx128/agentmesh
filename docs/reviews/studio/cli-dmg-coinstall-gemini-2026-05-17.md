Here is the read-only architecture and implementation-plan review of `plan.md`, focusing specifically on the CLI + DMG co-install/coexistence architecture.

### Must Fix

*   **macOS GUI `PATH` Inheritance for Provider CLIs**: In **Section 3 (CLI and DMG co-install contract)**, the plan states that external provider CLIs (e.g., Cursor, Claude, Gemini) are not bundled and that both channels must use readiness checks. However, macOS applications launched via Finder or Spotlight do not inherit the user's shell `PATH` (from `~/.zshrc`, `~/.bash_profile`, etc.). The plan must specify how the desktop-bundled runtime/App Server will resolve user-installed tools (e.g., via tools like `fix-path`, manual shell environment extraction, or explicit user configuration). Without this, the DMG will constantly fail provider readiness checks.

### Should Fix

*   **Stale Lock Recovery Policy**: In **Section 3 (Co-install locking policy)**, the plan correctly mandates that lock owner metadata includes entrypoint type (`cli` or `desktop`), PID, and timestamp, and that waiting entrypoints show diagnostics. The plan should also define the *stale lock* policy. Since the global CLI and the Desktop App can terminate abruptly (or OS crashes occur), there needs to be a defined mechanism for one entrypoint to verify if the other entrypoint's PID is dead and safely break/claim the lock.
*   **Provider CLI Resolution Verification**: In **Section 6 (P3.5 Verify CLI and DMG co-install behavior)**, alongside the `PATH` poisoning test, add a concrete verification step to prove that the GUI-launched desktop app can successfully discover and invoke an unbundled provider CLI (e.g., verifying against a mock CLI installed in a user-local bin folder like `~/.local/bin`).

### Nit

*   **Explicit Binary Pathing**: In **Section 3 (CLI and DMG co-install contract)**, it explicitly notes that the desktop App Server "must not resolve `agentmesh` through `PATH`". It would be slightly more complete to explicitly mention the exact mechanism it *should* use to guarantee isolation (e.g., Tauri's built-in `sidecar` API or strict `__dirname` relative pathing within the `.app` bundle `Contents/MacOS/` or `Contents/Resources/`).

**Verdict:** `needs_decision` (The macOS shell `PATH` vs GUI app environment issue is a standard desktop trap that requires a concrete implementation decision before packaged provider readiness can work).
