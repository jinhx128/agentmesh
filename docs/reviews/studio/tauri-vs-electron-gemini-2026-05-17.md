Based on the provided decision records (`studio-distribution.md`, `studio-shell.md`), the architecture target (`plan-c.md`), and the new facts regarding peer AI desktop applications (Claude, Codex, OpenCode), here is the architecture review of the Tauri vs. Electron decision.

### Architectural Review: Tauri vs. Electron for AgentMesh Studio

The current decision isolates the AgentMesh Node runtime into a "sidecar" App Server, using Tauri purely as a lightweight lifecycle shell and webview host. While this forces a clean separation of concerns and minimizes bundle size, the new ecosystem facts indicate that mature AI desktop tools overwhelmingly converge on Electron.

#### Evaluation of Trade-offs

1. **Sidecar Lifecycle vs. Native Node (Electron):**
   - **Tauri:** Requires packaging the Node App Server into a standalone executable (e.g., via `pkg` or SEA) or bundling a Node binary and a JS bundle. Tauri must manage this child process over stdio/ports. If Tauri crashes (e.g., `kill -9`), the sidecar may zombie, holding locks or loopback ports.
   - **Electron:** The Main process *is* a Node.js process. The App Server logic runs natively without inter-process lifecycle orchestration, ensuring deterministic teardown.
2. **`node-pty` and Native Modules:**
   - **Tauri:** Compiling and linking native Node modules (like `node-pty` for real terminal streams) inside a packaged sidecar executable across macOS Intel/ARM, Windows, and Linux is notoriously difficult and brittle.
   - **Electron:** Native modules are a solved problem via `electron-rebuild`. Since Plan C explicitly defers `xterm.js`, the inevitable need for `node-pty` will heavily stress the Tauri sidecar approach.
3. **WebView vs. Chromium Consistency:**
   - **Tauri:** Relies on WKWebView (macOS) and WebView2 (Windows). Advanced UI components (Monaco Editor, React Flow) often exhibit subtle keybinding, scrolling, or layout bugs in WKWebView compared to Chromium.
   - **Electron:** Bundles a specific Chromium version. The React/Vite UI will render identically on all operating systems, reducing QA surface area.
4. **Development Speed & Stack Alignment:**
   - AgentMesh is built in TS/Node. Tauri requires Rust for shell modifications (e.g., custom tray menus, deep linking, native dialogs). Electron keeps the entire codebase in TypeScript, accelerating iteration for a TS-focused team.
5. **Bundle Size & Security Boundary:**
   - Tauri wins decisively on bundle size (~15MB vs ~150MB) and memory overhead. Tauri's capability-based IPC is also more secure by default. However, for a developer-focused AI tool, bundle size is rarely a disqualifying factor compared to stability and terminal integration.
6. **Signature/Update/Packaging:**
   - Both support Developer ID, notarization, and automatic updates. Electron's `autoUpdater` (Squirrel) is older and heavier, while `tauri-plugin-updater` is modern and uses static JSON. Both meet the requirements.

---

### Findings

- **[Must] Evaluate `node-pty` packaging risk.** Plan C lists `xterm.js` as deferred. If the Studio requires real terminal emulation for agent interaction, `node-pty` will be required. Packaging native Node modules into a Tauri sidecar is a high-risk path that often triggers the Electron fallback.
- **[Must] Address sidecar process management.** The contract requires Tauri to start/stop the Node App Server. You must ensure the Node process gracefully exits if the Tauri parent is forcefully terminated, preventing orphan processes and locked ports.
- **[Should] Re-weight bundle size vs. cross-platform rendering.** AI tools (Claude, Cursor) accept Electron's weight because it guarantees Chromium's rendering engine for complex text editors (Monaco) and consistent Node integration. The Tauri WKWebView dependency on macOS may introduce unforeseen UI friction.
- **[Nit] Update fallback triggers.** `studio-shell.md` correctly lists `node-pty` and sidecar packaging as fallback triggers. Add "Monaco/React Flow WKWebView compatibility" as an explicit trigger to monitor during P4.

---

### Recommended Conclusion

**Retain Tauri as the initial target to force decoupling, but lower the threshold for switching to Electron.**

The Tauri decision enforces a strict client-server boundary (React UI -> Dynamic Port -> Node App Server) which is architecturally superior because it guarantees the UI cannot bypass the App Server to touch the filesystem. If you started with Electron, it would be too tempting to import runtime code directly into the Electron Main process.

However, given the domain (AI coding agents), you will likely hit the `node-pty` or complex sidecar packaging barriers. Treat Tauri as a "forcing function for good architecture." If the validation experiments below fail or take more than a few days, invoke the Electron fallback immediately, keeping the exact same decoupled UI/App Server boundary.

---

### Required Validation Experiments (If keeping Tauri for P3)

Before committing fully to Tauri in P3, complete these targeted spike tests:

1. **The Zombie Sidecar Test:**
   - Wire a dummy Node sidecar that binds a dynamic port. Start it via Tauri. Force-kill the Tauri app using Activity Monitor or `kill -9`.
   - *Pass condition:* The Node sidecar detects the detached parent and self-terminates.
2. **The Native Module Packaging Spike:**
   - Add a native Node dependency (e.g., `node-pty` or `better-sqlite3`) to a dummy App Server.
   - Attempt to bundle it into a Tauri sidecar for both macOS Apple Silicon and Intel.
   - *Pass condition:* The packaged DMG runs on a clean machine without missing `bindings` or `.node` file errors.
3. **The Advanced UI Render Smoke:**
   - Spin up a basic Vite/React app with a Monaco Editor instance and an `xterm.js` instance. Load it inside Tauri (WKWebView).
   - *Pass condition:* Scrolling, code selection, and standard IDE keyboard shortcuts work identically to Chrome.
