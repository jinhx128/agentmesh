# Prompt Assembly Contract

`schema_version`: 1

Prompt assembly turns packet files into the stage prompt passed to an entry
agent, worker CLI, or future Studio view. The packet remains the source of
truth; the prompt is a bounded observation snapshot derived from it.

## Current Runtime Surface

- `agentmesh flow prompt <run> --stage <node-id>` renders the prompt for the
  current entrance agent without writing an artifact.
- Worker dispatch writes a prompt snapshot to `prompts/<node-id>.md` and records a
  `prompt` artifact before invoking the worker adapter.
- The current prompt builder reads `request.md`, `assignment.toml`,
  `context.md`, prior canonical artifacts, prior raw review outputs, and
  `release-summary.md` when those files are relevant to the stage.
- Verify prompts must include Request, Assignment, Context, ordered prior
  evidence, and a verify contract that tells the agent to write commands, logs,
  skipped checks, and verification evidence into `verification.md`.
- Execute prompts include a handoff contract requiring `Changed Files`,
  `Verification`, `Not Verified`, `Remaining Risk`, and `Next Action` sections.
- Release-check review and decide prompts refresh `release-summary.md` before
  assembly so the prompt sees a release-summary derived refresh of packet
  evidence.
- All workflows assemble prior node evidence in workflow order. Each prior
  section names the node id, semantic stage label, and artifact path, for
  example `Prior Output: execute_2 (Handoff)` with `handoff_2.md` or
  `Prior Output: decide (Decision)` with `decision.md`.
- Review raw outputs from prior review nodes are included from their node-aware
  paths, such as `reviews/review_2/<reviewer>.md`.
- Missing prior canonical artifacts are rendered as explicitly unavailable
  rather than as ambiguous empty sections.
- If `verify` appears after `review`, ordered prior evidence may include review
  artifacts, but live working tree inspection or unstored terminal output is not
  durable verification evidence.

## Snapshot Rules

- A prompt snapshot is evidence for one dispatch attempt. It is not the
  canonical state of the run.
- Rebuilding a prompt may produce different text if packet artifacts changed
  between attempts.
- A dispatch attempt must pass the same snapshot path to the adapter that it
  records in `artifacts.toml`.
- Completed-stage artifacts remain protected; regenerating a prompt must not
  overwrite completed review, execution, handoff, findings, or decision
  artifacts.

## Live Working Tree

- The live working tree is not frozen by prompt assembly. Local files may change
  after the prompt snapshot is generated.
- Agents must treat packet artifacts and explicit context provenance as the
  stable evidence boundary, then inspect the live working tree when their role
  requires current code or docs.
- If a stage depends on a particular diff, verification log, or external fact,
  that input should be captured into `context.md`, `release-summary.md`, or a
  named artifact instead of relying on private chat state.

## Context Freshness

- context freeze means `context.md` is captured packet evidence with visible
  provenance, including timestamp, source, freshness, validation state, and
  redaction state.
- context refresh means adding or regenerating context with new provenance. A
  refresh must be visible in packet artifacts or events; hidden refreshes are
  not allowed.
- release-summary derived refresh is a derived summary of existing packet
  evidence for release-check prompts. It may aggregate diff, verification,
  review findings, skipped checks, and residual risk, but it must not replace
  the original evidence files.
- Stale, failed, skipped, or unknown context remains visible so reviewers and
  deciders can account for missing evidence.

## Budget Policy

- A per-stage budget should reserve space first for protocol instructions,
  request, assignment, and current stage contract; then include context, plan,
  handoff, findings, and release summary according to stage relevance.
- A per-adapter budget may further bound prompts for CLIs or models with known
  limits. Unknown adapter limits must be represented as unknown, not guessed.
- Budget enforcement must not silently drop evidence. If content is omitted,
  truncated, summarized, or deferred to a file path, the prompt must say so and
  preserve the source path or artifact id.
- Bounded inline evidence preserves head and tail excerpts with an explicit
  middle-omission marker. Context references surface the packet truncation state
  and original byte count without replaying the full context.
- Review and decide prompts should prefer exact evidence references over large
  repeated content when the packet already contains stable artifacts.

## Redaction Posture

- The default redaction posture is conservative visibility: do not claim content
  was redacted unless a redaction step actually happened.
- Context provenance must carry `redaction_state = "none"`, `"redacted"`, or
  `"unknown"` as defined in `context-provenance.md`.
- Prompt assembly must not invent secrets, hide failed redaction, or remove
  suspicious content without leaving a visible note.
- Future redaction policies should run before prompt snapshot creation and
  record their result in provenance, not only in adapter-specific logs.
