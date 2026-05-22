Here is a read-only review of **`plan-c.md`** focused on Tauri 2 default shell, React/Vite frontend, Node App Server boundary, App Server–owned agent create/delete lifecycle, and internal unsigned macOS DMG.

---

## Must Fix

1. **Agent lifecycle observability contract is underspecified** (§3, ~L146–L153; P2.7 ~L298–L306)
   The plan says lifecycle status may be delivered via **“polling, SSE, or WebSocket”** but does not pick an initial mechanism, versioning strategy, or how the UI correlates asynchronous CLI/runtime outcomes with UI state. Without that, engineers can diverge across features or redo transport later.

2. **Create/delete semantics beyond “delegation” need a normative API shape** (§3; P2.7 ~L298–L306)
   “Validate → lock-aware delegation → CLI/runtime” is good at a boundary level, but the plan does not require **explicit** handling of duplicate creates, overlapping deletes, in-flight mutations, partial failure surfaces (exit codes, stderr), or **what “delete” means** if an agent is running (P2.7 mentions “explicit safe stop or refusal path”—good—as a checklist item but not as a canonical rule). Risks ambiguous UX and duplicated policy between endpoints.

3. **Packaged dynamic bootstrap + sidecar readiness is mostly implied, not required** (§4 ~L159–184; P3.0/P3.1 ~313–326)
   You specify dynamic port + per-launch token and that Tauri exposes URL/token to the UI, but you do **not** state as a contract that the shell **must not** navigate/load the SPA until the App Server is **listening and healthy** (or until bootstrap can succeed). P3.0 verification hints at startup behavior but §4 reads as payload-only; a race/flaky-first-load class of bugs is still open at the architecture level.

4. **Internal DMG scope omits concrete macOS + CPU architecture commitments** (~L103–L112; P3.4 ~L335–342; §7 ~L378–384)
   “Unsigned DMG acceptable” is clear, but bundling Node + native bits for Tauri implies decisions: **minimum macOS version**, **arm64 vs x86_64 vs universal**, Rosetta assumptions, etc. Spike criteria reference “clean machine” but not **which** machines; that affects whether the spike is passing.

5. **`http://127.0.0.1:.../?token=...` threat model noted only implicitly** (~L169–L173)
   For internal-only localhost this is usually acceptable, but the plan rejects “Rust-side validation to compensate for bootstrap issues” (~L182–184) without stating expected mitigations (**bind to loopback**, no remote binding, Referer/other leakage assumptions). Worth one explicit sentence so security review does not reopen the bootstrap design.

---

## Should Fix

1. **Electron fallback threshold repeated but “cost” comparison method unstated** (~L91–L101 vs P3.0 ~L320–321)
   You have qualitative gates (“concrete blocker,” “acceptable cost”). For a steering doc, **one** criterion helps: e.g. time-box spike, enumerated must-pass behaviors, documented failure mode that triggers contingency.

2. **“App Server … does not become a second runtime” vs rich orchestration** (~L127–133)
   The tension is manageable (thin orchestration invoking CLI), but reviewers may ask where **workflow policy** stops and **routing** begins. A short clarification (or anti-pattern examples) reduces scope creep toward reimplementing runtime rules in Node.

3. **§5 “Initial React views” reads like a breadth list; sequencing is gated in P1.3/P2** (~L188–L198 vs P1.3 ~L257–261)
   Not wrong, but the doc could cross-reference §1’s “don’t migrate run workspace first” in §5 header to prevent someone reading §5 alone and planning the wrong first slice.

4. **Verification strategy names “parity tests” without defining them** (P2 gate ~L272–273; §7 ~L362–368)
   For agent lifecycle specifically, parity likely needs **fixture agents**, snapshot of CLI outcomes, or contract tests against App Server—none of which are spelled out.

---

## Nit

1. **“Radix-style primitives”** (~L76) leaves room for tooling churn (Radix vs shadcn vs headless-kit); fine for architecture, fuzzy for procurement.

2. **Monorepo sketch `apps/studio/`** (~L209–L232) mixes server and frontend names; aligns with §3 split but may collide with existing repo layout—the plan already allows path drift.

3. **Zustand explicitly deferred twice** (~L31–32 and ~L80)—harmless redundancy.

---

## Verdict

**needs_decision** — The architectural boundaries (Tauri thin shell; React+Vite UI; Node App Server as sole API/control plane for UI; lifecycle not in Rust; internal unsigned DMG with Gatekeeper playbook) are **coherent** and reinforced in §2–§3, §4, P3, and Risks (~L404–L431). Execution can start **P1**, but shipping a **confidence-inspiring** packaged path and agent lifecycle slice still needs spelled-out decisions on **lifecycle transport semantics**, **create/delete correctness rules**, **DMG/architecture targets**, and **normative bootstrap/sidecar startup ordering**.

---

_used_: mode=无 · skills=无 · tools=Read
