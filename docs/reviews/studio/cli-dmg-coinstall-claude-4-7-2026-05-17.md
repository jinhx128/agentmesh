Read plan.md and reviewed the CLI + DMG co-install sections.

## Must Fix

1. **macOS GUI launch and provider CLI discovery (§3 lines 178–181).** The plan correctly bans `PATH` resolution for `agentmesh` itself, but Codex/Claude/Gemini/Cursor *must* be found somehow. Finder-launched `.app` bundles do not inherit the user's shell `PATH` (no `.zshrc`/`.bashrc` sourcing); naive readiness checks will report "missing" for tools that work fine in `agentmesh studio` from a terminal. Specify the discovery mechanism the desktop App Server uses for provider CLIs (login-shell probe, configured paths in app preferences, well-known install locations, or a documented user override) so the readiness diagnostics are actionable rather than a dead-end.

2. **Schema/runtime compatibility contract is undefined (§3 lines 184–194).** The rules say mutations require "supports the workspace packet schema and runtime compatibility metadata," but never define: (a) where compatibility metadata lives (packet file? `.agentmesh/version`?), (b) what "supports" means (semver range? major-only? exact?), (c) which direction is forward-incompatible vs. backward, and (d) what "runtime version" keys off (CLI package version, runtime package version, or packet schema — these can drift). P3.5's "schema/version mismatch fixture" test (line 466) cannot be implemented or reviewed without this contract written down.

## Should Fix

3. **PATH-poisoning test assertion shape (P3.5, line 462).** "Confirm desktop mutations still use the app-bundled runtime path" needs an explicit assertion mechanism — e.g., the resolved binary path is inside `AgentMesh.app/Contents/Resources/...`, or an invocation log records the absolute path. As written, a passing test could be ambiguous.

4. **Missing symmetric isolation test (§3 lines 176–177, P3.5).** The contract forbids the CLI from calling into `/Applications/AgentMesh.app`, but no P3.5 step verifies it. Add a test asserting global-CLI mutations never spawn the bundled runtime.

5. **Concurrent App Servers against the same workspace are implied but not exercised (§3 lines 173–175, P3.5).** Two App Servers (CLI `agentmesh studio` and `AgentMesh.app`) on separate ports, same workspace, both streaming SSE — locking handles serialized mutation, but read-side consistency and SSE divergence are unverified. Add an explicit "both App Servers running simultaneously" scenario to P3.5 or §7.

6. **Stale lock recovery is unspecified (§3 lines 196–206).** Owner metadata is well-defined, but with two install channels a crashed CLI process can orphan a lock the desktop cannot break. Define TTL / heartbeat / `kill -0`-style liveness check, and a user-visible "force release" path through diagnostics.

7. **Bootstrap token survival across WebView reload (§4 lines 264–273).** Token is in-memory only and stripped from the URL via `history.replaceState`. A WebView reload (Cmd-R, devtools refresh, crash recovery) drops it; the `/api/bootstrap` fallback would itself need an auth handshake — chicken-and-egg. Specify recovery (Tauri IPC re-issuing the token, or a `tauri://` scheme injection on reload).

8. **"Agent registration semantics" shared contract (§3 line 167) requires CLI parity surface.** P3.5 verification depends on inspecting agents through CLI after Studio creates them (line 460). Enumerate the CLI commands that must exist to make this verifiable, or call out which already do.

## Nit

9. **Lifecycle API shape is mixed (§3 lines 224–228):** `DELETE /api/v1/agents/:id` is REST-shaped while `POST /:id/enable`/`/disable` is verb-shaped. Pick one or note the deliberate split.

10. **P3.5 symmetry (line 463):** also exercise the inverse — uninstall/hide global CLI, confirm desktop still functions end-to-end.

11. **Bootstrap-over-HTTP rationale (§4):** Tauri provides IPC; using a loopback HTTP token primarily preserves parity with the browser-launched `agentmesh studio` path. Worth one sentence so future readers don't redesign it.

12. **Initial-token logging carve-out (§4 line 282).** "Logging the per-launch token" is rejected — good — but the App Server bootstrap path may currently log full request URLs (which carry `?token=`). Add a one-liner that the request-logging middleware redacts the token query parameter.

## Verdict

**needs_decision.** The boundary model (separate binaries, separate App Servers, shared packet/lock/config contracts) and the P3.5 test list are well-structured. The two blockers — undefined schema/runtime compatibility contract and unspecified provider-CLI discovery under GUI launch — must be resolved before P3.5 can be executed meaningfully. Everything else is tractable inside the existing slicing.

---
_used_: mode=无 · skills=无 · tools=Read
