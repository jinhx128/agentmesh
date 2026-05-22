# Review Artifacts Contract

`schema_version`: 1

Review artifacts are the shared evidence model for Review Gate (`w-9d94d0db`),
Release Check (`w-67ef1b1f`), and general review stages.

## Canonical Files

- `reviews/<reviewer>.md`: raw reviewer output. The `<reviewer>` slot is a
  filesystem-safe reviewer id derived from the assigned agent id.
- `findings.md`: controller-classified findings. This file is the only place
  where raw reviewer output becomes accepted, rejected, or needs decision.
- `decision.md`: decider output, including release verdicts when the workflow is
  Release Check (`w-67ef1b1f`).

Repeated review and decide nodes use occurrence-suffixed canonical artifacts:
`findings_2.md`, `findings_3.md`, `decision_2.md`, and `decision_3.md`.

## Raw Review Output

Raw review output remains reviewer-authored evidence. It must not be treated as
accepted fact until the controller records it in `findings.md`.

When raw outputs are embedded for visibility, they use this section:

```md
## Raw Review Outputs

### reviewer-id

...
```

`## Raw Review Outputs` is a generated tail section. Controller
classifications must be written above it; refresh operations may replace this
tail with the latest raw reviewer output.

## Controller Classification

`findings.md` is the release gate input, not `reviews/<reviewer>.md`.

- `## Accepted`: findings the controller has verified and accepted.
- `## Rejected`: findings the controller has checked and rejected.
- `## Needs Decision`: findings or missing evidence that require a decider.

Raw reviewer `Must Fix` output is evidence only. It blocks release only after
the controller records it under `## Accepted`, or forces a decision only after
the controller records it under `## Needs Decision`.

Conflicting or contradictory findings must keep reviewer source attribution in
the classified item, for example `[source: antigravity, claude]`.

## Artifact Manifest

Each raw reviewer output should be recorded in `artifacts.toml` as:

```toml
schema_version = 1

[artifacts.review_antigravity]
path = "reviews/antigravity.md"
kind = "review-output"
stage = "review"
agent = "antigravity"
```

`findings.md` is recorded as `kind = "markdown"` at `stage = "review"`;
`findings_2.md` uses artifact id `findings_2` and `stage = "review_2"`.
`decision.md` is recorded as `kind = "markdown"` at `stage = "decide"`;
`decision_2.md` uses artifact id `decision_2` and `stage = "decide_2"`.

## Release Summary

`release-summary.md` reads the same `reviews/<reviewer>.md` files and
`findings.md` controller classifications. If `findings.md` does not already
include `## Raw Review Outputs`, the summary may append the raw output section
without mutating `findings.md`.
