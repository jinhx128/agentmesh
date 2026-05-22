# artifacts.toml Contract

`schema_version`: 1

`artifacts.toml` is the manifest of packet artifacts.

## Shape

```toml
schema_version = 1

[artifacts.plan]
path = "plan.md"
kind = "markdown"
stage = "plan"
agent = "planner"
```

## Required Artifact Fields

- `path`: packet-relative path when possible.
- `kind`: artifact kind, such as `request`, `context`, `markdown`, `status`,
  `review-output`, or `release-summary`.
- `stage`: producing stage or `run`.

For repeated workflows, `stage` is the runtime node id. First occurrences keep
legacy artifact ids and paths. Later canonical artifacts use the same semantic
name as their file, for example:

```toml
[artifacts.handoff_2]
path = "handoff_2.md"
kind = "markdown"
stage = "execute_2"
agent = "worker"

[artifacts.verification_2]
path = "verification_2.md"
kind = "markdown"
stage = "verify_2"
agent = "verifier"

[artifacts.findings_2]
path = "findings_2.md"
kind = "markdown"
stage = "review_2"

[artifacts.decision_2]
path = "decision_2.md"
kind = "markdown"
stage = "decide_2"

[artifacts.review_2_reviewer]
path = "reviews/review_2/reviewer.md"
kind = "review-output"
stage = "review_2"
agent = "reviewer"
```

## Path Rules

- Relative artifact paths must stay inside the packet directory.
- Absolute paths are allowed only for explicit external references.
- Validators must report missing artifact files.

## Completed Stage Protection

Artifacts produced by completed stages must not be overwritten silently. A retry
or resume flow must either preserve the existing artifact or write a new
artifact and record the replacement decision in `events.jsonl`.
