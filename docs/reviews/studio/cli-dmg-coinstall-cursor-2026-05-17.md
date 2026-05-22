Here is a read-only review of `plan.md` focused on CLI + DMG co-install / coexistence.

## Must fix

1. **Runtime compatibility metadata is named but not specified** (§3 “Co-install compatibility policy”, ~L183–L192). Mutations are gated on “runtime compatibility metadata,” but the plan does not say where it lives (e.g. which file(s) under `.agentmesh`, which fields), how versions are compared (semver vs single integer), or what “supports” means when global CLI and bundled runtime differ. Without that, two teams can implement incompatible “refusal vs read-only” behavior and still think they match the plan.

2. **Lock-owner contract stops at field list, not interchange format** (§3 “Co-install locking policy”, ~L196–L206). Required metadata (`cli`/`desktop`, runtime version, pid, operation id, timestamp) is clear; there is no plan-level statement of the **on-disk / IPC contract** (single lock file vs multiple, JSON shape, atomicity, stale-lock policy). For co-install, that is where divergent implementations hurt most.

3. **“Read allowed if schema supported” vs version skew** (~L185–L186, L189–L192). Reads ignore runtime compatibility in the written rule; only mutations mention metadata. If a newer runtime adds auxiliary state that older readers mis-render, the plan should say whether reads **error loudly**, **degrade with warnings**, or **stay best-effort**—otherwise P3.5 “view in Studio after CLI” can pass while correctness is ambiguous.

## Should fix

1. **Provider CLI readiness lacks acceptance criteria** (~L177–L181). “Readiness checks and actionable diagnostics” is the right bar, but the plan does not define minimum scope (which providers, first-run vs every command, `doctor`-style vs lazy), or what “actionable” means (exit codes, suggested fixes, links). P3.5 does not explicitly exercise provider-missing paths for **both** channels.

2. **P3.5 version-mismatch coverage is asymmetric in wording** (~L456–L466). “Schema/version mismatch fixture” is good; explicitly call out **both directions** (global CLI newer vs `AgentMesh.app` newer) if both are in scope, so implementers do not only test “old app, new workspace.”

3. **Shared contracts list “project config semantics”** (~L166–L169) but not **log/cache/tmp** boundaries. If either entrypoint writes derived data outside the shared contract, co-install debugging gets hard; one sentence on “derived artifacts must be versioned or namespaced” would tighten the plan.

4. **Separate App Servers** (~L172–L173) is clear; add a short **UX note** that two loopback servers imply two possible Studio tabs/sessions—optional but reduces confusion during P3.5 manual runs.

## Nit

1. **P3.0 already asserts “no PATH dependency”** (~L426–L428) and P3.5 **PATH poisoning** (~L461–L462); good redundancy with risks (~L558–L560).

2. **“Version and entrypoint identity must be visible in diagnostics”** (~L194) could name at least one surface (e.g. CLI banner/footer, Studio settings/about, lock wait message) so reviews have a hook.

3. **Initial lifecycle API** (~L220–L235) is orthogonal to coexistence but pairs well with lock/operation-id story; no change required for this review.

## Verdict

**needs_decision** — The coexistence **story** (separate binaries, separate App Servers, shared workspace, no `PATH` resolution for the app, lock serialization, P3.5 including PATH poisoning) is coherent and strong. Execution-ready **contracts** are not: **runtime compatibility metadata** and **lock payload/interop** need explicit decisions (and then a short addition to this plan or a linked spec), and **provider readiness** needs scoped acceptance tests so “both channels” is verifiable.

---

_used_: mode=无 · skills=无 · tools=Read
