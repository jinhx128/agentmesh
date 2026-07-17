# Cross-Host Reviewer Session Reuse Design

## Goal

Allow repeated ordinary reviews initiated from the same Codex, Cursor, Claude Code, Antigravity, or OpenCode conversation to reuse each reviewer provider's native session across AgentMesh runs, while preserving packet-first evidence, preventing cross-conversation contamination, and forcing fresh sessions for independent gates.

The feature optimizes continuity and repeated repository discovery. It must not make a review's correctness depend on hidden provider history.

## Current Facts

- Every dispatched lane currently starts a new non-interactive CLI process with `spawn`; no provider session identifier is captured or resumed.
- `flow resume` resumes AgentMesh workflow state, not a provider conversation.
- Existing `stage.agent_reused` means an already completed artifact was reused inside a run. It does not mean a provider session was resumed.
- Codex, Claude Code, Cursor Agent, OpenCode, and Antigravity expose some form of resume/continue command in their installed CLI help, but stable structured session-ID capture in non-interactive mode is not yet verified for every adapter.
- The current Codex tool request metadata includes a stable `threadId`. Other hosts require host-specific integration or an explicitly propagated scope token.
- A focused prompt that prohibited repository exploration reduced a three-reviewer architecture review to Cursor 24.1s, Claude Opus 4.8 49.5s, and GLM 5.2 141.2s. Session reuse must be evaluated separately from prompt-scope discipline.

## Approved Product Modes

### Interactive continuous

Repeated ordinary reviews in the same host conversation, workspace/worktree, and reviewer identity may resume the reviewer provider session across AgentMesh runs.

Every resumed turn still receives the current packet request, scoped diff or structured delta, verification, corrections, and known risks. Provider memory is advisory context only. Resumed evidence is marked non-hermetic.

### Independent

Release, security, compliance, red-team, approval, first cold-read, cross-workspace/worktree, executor self-review, and other formal gates always use fresh provider sessions.

Independent execution physically bypasses reviewer-session registry reads and writes. An independent session created by a provider is not registered for later reuse.

### Auto

Workflow and review-profile policy resolve `auto` to interactive continuous only when all of the following are true:

- a stable native or propagated host conversation scope exists;
- the review is not covered by an independent-only profile;
- the adapter supports explicit resume and structured session-ID capture;
- the local reviewer-session registry is available and passes permission checks.

Otherwise `auto` resolves to fresh without failing the review. A CLI override may request fresh, but no override may weaken an independent-only policy.

## Architecture

### Layer 1: Host Scope Resolver

The resolver produces a host-neutral scope for each entry conversation:

```text
host_kind
conversation_scope_ref
workspace_id
worktree_id
scope_source = native | propagated | missing
```

`host_kind` is a closed enum covering Codex, Cursor, Claude Code, Antigravity, OpenCode, Studio Desktop, headless CLI, and unknown. Each native-capable host integration documents how its conversation identifier is obtained and how long it remains stable.

Native identifiers always take precedence. They are never written to a packet. AgentMesh derives `conversation_scope_ref` with HMAC-SHA256 using a machine-local scope key and the host kind plus native identifier.

When no stable native identifier is exposed, AgentMesh may issue `amscope_v1:<uuid>`. The host Skill must pass it explicitly on later calls in the same conversation. The token is a correlation key, not a provider session ID. Missing, invalid, or forgotten tokens resolve to `scope_source=missing` and fresh execution. AgentMesh never falls back to a workspace-wide active scope.

The resolver derives canonical workspace and worktree identities from real paths. The worktree identity includes both the canonical checkout root and Git directory identity so linked worktrees cannot share reviewer sessions accidentally.

### Layer 2: Reviewer Session Registry

The registry lives under `~/.config/agentmesh/reviewer-sessions/`. Its directory is user-only (`0700`) and entry files are `0600`; Windows uses an equivalent user-exclusive ACL. The registry is not part of a project packet, git repository, or Studio data export.

The registry key is a hash of:

```text
conversation_scope_ref
canonical workspace_id and worktree_id
agent_id, adapter_id, model, reasoning effort
normalized invocation fingerprint
```

The normalized invocation fingerprint covers command/arguments, capability profile, permission and context mode, reviewer persona and prompt-schema versions, adapter plugin version, provider CLI version, and environment variable names. It never includes secret environment values.

Each entry stores the provider's opaque session ID, creation and last-use timestamps, expiry, epoch, successful resume count, adapter/version fingerprint, and estimated context usage. Provider session files, tokens, cookies, keychains, and login state are never read or copied.

Writes are atomic and entry-locked. The registry exposes only an irreversible `session_ref` to packet provenance. Original provider session IDs are redacted from stdout, stderr, errors, events, telemetry, Studio, and packet artifacts.

### Layer 3: Adapter Session Capability

Adapters declare explicit capabilities:

```text
supports_resume
supports_structured_session_id
```

V1 does not expose a general fork capability. An adapter enables reuse only when both capabilities are verified for the installed provider CLI version.

The adapter boundary implements:

```text
start
resume
extract structured session ID
classify resume failure
```

Session-ID extraction accepts structured JSON or an adapter-owned structured footer only. It never parses free-form model text and never scans private provider stores.

## Invocation Flow

1. Resolve workflow/profile review-session policy.
2. If independent, bypass the registry and start a fresh provider session without registering it.
3. Resolve the host conversation scope and canonical workspace/worktree.
4. If scope is missing or adapter capabilities are unavailable, execute fresh and record the reason.
5. Compute the reviewer-session key and acquire its entry lock while the existing run mutation lock is held. The global order is run mutation lock, registry entry lock, then provider invocation; reverse acquisition is forbidden.
6. On a valid registry hit, resume the provider session and send the complete current packet evidence plus a since-last structured code delta that invalidates obsolete file/line references.
7. On a miss, start fresh and capture a structured provider session ID.
8. Classify failures according to the action matrix below.
9. Atomically update the registry only for successful continuous executions that own the current entry epoch.
10. Record packet provenance and release the lock.

The lock covers both registry read-modify-write and the provider's linear conversation append. If it cannot be acquired in five seconds, the lane runs as fresh isolated with `registry_write=false`. The isolated attempt uses `(run_id, lane_id, attempt)` as its idempotency key.

## Packet Contract

Each attempt records:

```text
session_mode = fresh | resumed | fallback_fresh | fresh_isolated
session_ref
conversation_scope_ref
scope_source
hermetic
non_hermetic_reason
adapter capability snapshot
rotation or fallback reason
registry_write
```

Resumed attempts set `hermetic=false` and `non_hermetic_reason=session_resume`. These fields propagate into findings, decide prompts, and release summaries. They do not replace or weaken review-output validity checks.

Provider-session events use a new `reviewer_session.*` namespace. They do not reuse artifact-level `stage.agent_reused`.

## Lifecycle

### Initial defaults

- Idle TTL: two hours after the last successful start/resume completes.
- Absolute TTL: `min(12 hours, provider retention minus safety margin)`.
- Maximum successful resumes: eight. Network/rate-limit retries and fresh starts do not consume this count.
- Entry-lock wait: five seconds.
- Heartbeat interval: ten seconds.
- Fresh recovery: at most once per lane attempt when the failure class permits it.

Provider retention wins when it is shorter than the AgentMesh TTL. Unknown provider retention uses the local 12-hour cap but treats earlier provider `not_found` as normal rotation.

### Context rotation

A fixed context percentage is insufficient. Rotation uses:

```text
estimated history
+ current packet
+ reserved maximum output
+ reasoning headroom
>= provider context limit
```

When reliable provider telemetry is unavailable, AgentMesh emits a soft warning at 60% estimated use and rotates at 80%, with the eight-resume limit as an additional guard. A context-based rotation has a one-stage cooldown.

### Immediate rotation

Rotate when any of the following changes:

- host conversation scope;
- workspace or worktree;
- agent, adapter, model, or reasoning effort;
- permission or context mode;
- normalized configuration fingerprint;
- reviewer persona or system/prompt schema;
- adapter plugin or provider CLI version;
- provider session expiry, absence, incompatibility, or context overflow;
- explicit close or native host-close event.

Ordinary Git HEAD, diff, and data-correction changes do not rotate the session. They are resent as current packet evidence. A correction that changes persona or system-level instructions is promoted to an immediate rotation.

### Close and garbage collection

Explicit or native close increments the registry entry epoch before invalidation. A process holding an older epoch may finish but cannot write the entry back to life.

Garbage collection removes expired and orphaned entries. Losing a propagated scope token may leave an orphan until GC; it cannot cause cross-conversation reuse because no workspace-default lookup exists.

The product exposes session listing, inspection, close, close-current-scope, and expired-entry purge operations. Studio may show masked status, reviewer, host, last-use, and expiry information but never the raw provider session ID.

## Lease And Crash Recovery

The AgentMesh parent process updates the entry heartbeat every ten seconds during invocation. A lease is stale only when three consecutive heartbeats are missing and the owner PID is no longer alive. Lane timeout is not used as a stale-lock clock.

PID liveness prevents a wall-clock jump from stealing a live lease. Close/resume races use registry epoch compare-and-swap. Crash recovery, PID reuse, heartbeat loss, and atomic-write interruption are covered by contract tests.

## Failure Action Matrix

| Failure class | Action |
|---|---|
| Expired, not found, context overflow | Rotate and allow one fresh recovery |
| Unsupported after provider upgrade | Disable reuse for that adapter/version, then allow one fresh recovery |
| Transient network | Retry resume once with roughly one-second jittered backoff |
| Rate limit | Honor `Retry-After`; otherwise use bounded exponential backoff within lane/stage budget |
| Provider busy | Bounded backoff, then lane failure or configured fallback agent |
| Authentication, permission, trust | Hard failure with readiness/auth guidance; never silently fresh |
| Incompatible permission/config schema | Hard failure or explicit capability disable; never hide drift with fresh |
| Invalid resumed output | Record invalid output; continuous mode may allow one fresh recovery |

No failure path may loop between resume and fresh indefinitely.

## Security

- Raw host conversation identifiers and provider session IDs never enter packets or logs.
- Registry permissions are verified before reuse; unsafe permissions force fresh and surface a diagnostic.
- A machine-local HMAC key derives stable local references without exposing native IDs.
- Error payloads and structured-output parsing pass through session-ID redaction.
- AgentMesh does not read or copy provider token files, cookies, keychains, or session-store files.
- Reuse is machine-local. Moving a packet to CI or another machine naturally produces fresh execution and records a registry miss.

## Testing

### Contract and unit tests

- Native, propagated, missing, invalid, and native-over-propagated scope resolution.
- Canonical workspace/worktree identities across symlinks and linked worktrees.
- Registry key normalization, secret exclusion, permissions, atomic writes, epochs, GC, and corruption handling.
- Entry-lock contention, five-second fallback, heartbeat loss, owner crash, PID reuse, clock jumps, and close/resume races.
- Independent policy never reading or writing registry state, including temporary files.
- Attempt provenance, non-hermetic propagation, event naming, and session-ID redaction in every output/error surface.
- Resume-count boundaries at eight/nine and simultaneous idle/absolute/provider expiry.
- Context headroom prediction, soft/hard fallback thresholds, overflow recovery, and rotation cooldown.
- Structured deltas invalidating obsolete line references; data corrections resend, persona corrections rotate.
- Every failure-class action and retry/fallback limit.

### Adapter capability matrix

For Codex, Claude Code, Cursor Agent, Antigravity, and OpenCode, verify on supported CLI versions:

- a new non-interactive invocation emits a stable structured session ID;
- explicit resume continues that session;
- resume failure classes are distinguishable;
- model/reasoning/permission changes behave as declared;
- IDs are not leaked through AgentMesh logs or artifacts.

Adapters that fail any load-bearing capability remain fresh-only.

### End-to-end scenarios

- Two runs from one host conversation resume the same reviewer sessions.
- Two host conversations in one workspace never share sessions.
- Different worktrees, models, reviewers, and permission profiles produce fresh sessions.
- Concurrent runs targeting one reviewer serialize or fall back to fresh isolated without registry writes.
- Native close and explicit close prevent later resume.
- Release/security profiles remain independent even when a matching continuous registry entry exists.

### Quality and performance evaluation

Use identical prompt-scope constraints for fresh and resumed arms. Measure wall time, provider/tool reads, output validity, injected-defect detection, and false-LGTM rate. Do not attribute gains from restricted workspace exploration to session reuse.

## Rollout

1. Build the five-CLI capability spike and document results without changing default behavior.
2. Add policy/provenance schemas and independent-path enforcement; keep every adapter fresh-only.
3. Add the local registry, locking, lifecycle, redaction, and one verified adapter behind an experimental flag.
4. Enable interactive continuous per verified adapter, with fresh fallback and telemetry.
5. Add host-native scope integrations and propagated-token fallback per host.
6. Add Studio visibility and management after CLI/runtime behavior is stable.
7. Enable ordinary-review defaults only after A/B quality and latency gates pass.

## Acceptance Criteria

- Repeated ordinary reviews in one supported host conversation demonstrably resume the same per-reviewer provider sessions.
- Formal independent gates cannot read, write, or reuse continuous registry entries.
- Missing metadata, unsupported adapters, unsafe registry permissions, and resume expiry degrade safely to fresh when the failure matrix allows it.
- Concurrent host conversations and worktrees do not cross-contaminate sessions.
- Packets remain sufficient to understand authoritative inputs and outputs; resumed hidden state is disclosed as non-hermetic.
- No raw conversation or provider session ID appears in packet, log, telemetry, Studio, or error output.
- Adapter-specific A/B tests show a meaningful latency/tool-read improvement without unacceptable defect-detection or false-LGTM regression.

## Non-Goals

- Do not copy or synchronize full host/provider private conversation history.
- Do not keep provider CLI processes or PTYs permanently resident in V1.
- Do not provide cross-machine reviewer-session migration.
- Do not infer a host conversation from a workspace-wide active session.
- Do not enable general provider-session fork semantics in V1.
- Do not weaken release, security, compliance, or red-team independence for performance.
