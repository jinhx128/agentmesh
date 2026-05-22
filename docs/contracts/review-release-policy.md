# Review/Release Policy Contract

`schema_version`: 1

Review/release policy is a project-scoped config contract for requiring reviewer
capability profiles and release evidence without hard-coding a teammate's local
model or agent id into the project.

## Config Shape

```toml
[review_policy.<workflow-id>]
required_review_profiles = ["reviewer.security"]

[release_policy.<workflow-id>]
required_evidence = ["tests", "diff-check"]
needs_decision_risks = ["security", "migration"]
```

Fields:

- `[review_policy.<workflow-id>]`
  - `required_review_profiles`: list of capability profile tags that must
    resolve to configured reviewer agents before run creation.
- `[release_policy.<workflow-id>]`
  - `required_evidence`: list of evidence labels that release summary must
    report as present or missing.
  - `needs_decision_risks`: list of risk categories that should remain visible
    to reviewers and deciders.

Policy sections are project-scoped. User config should continue to store local
reviewer agents, adapter/model settings, and `capabilities` tags. A
reviewer satisfies a required profile when it has both `review` and the profile
tag in `capabilities`.

Projects may define explicit capability profiles instead of relying only on raw
capability tags:

```toml
[capability_profiles."reviewer.long_context"]
stage = "review"
required_capabilities = ["review", "long_context"]
min_count = 1
```

Users may map that project profile to their local agent ids:

```toml
[capability_profile_preferences."reviewer.long_context"]
agents = ["local_reviewer"]
```

## Merge Rules

Config layer order is user -> project -> explicit overlay.

- User-layer `review_policy` and `release_policy` fail fast.
- `required_review_profiles`, `required_evidence`, and `needs_decision_risks`
  are unioned in layer order with duplicates removed.
- `[workflow_defaults.<workflow-id>]` keeps its existing contract and accepts
  only concrete agent ids or lists of concrete agent ids.
- `[capability_profiles.<profile-id>]` is project-scoped and
  `[capability_profile_preferences.<profile-id>]` is user-scoped.

## Run Behavior

At `flow run` creation time, AgentMesh resolves policy for the selected workflow:

- `required_review_profiles` are resolved against configured user/project agents.
  If a project capability profile exists, its stage and required capability list
  define the match. Otherwise the profile falls back to the legacy review-facing
  capability tag behavior.
- User profile preferences are validated against the project profile; unknown
  agents or agents that do not satisfy the profile fail fast.
- If no preference exists and exactly the required number of agents match, the
  run auto-selects those agents and records a
  `profile_resolution_warnings` entry in the packet.
- If no preference exists and multiple candidate sets exist, run creation fails
  fast before the packet directory is created.
- If any required profile has no matching reviewer agent, run creation fails
  before the packet directory is created.
- Resolved reviewer agent ids are added to the review stage assignment alongside
  explicit `--review` or `[workflow_defaults]` reviewers.
- The packet records `status.json.resolved_review_release_policy` with:
  - `source_layers`
  - `policy_hash`
  - `required_review_profiles`
  - `resolved_reviewers`
  - `profile_resolution_warnings`
  - `required_evidence`
  - `needs_decision_risks`
  - `skipped_gates`
  - `missing_evidence`

## Release Summary

`release-summary.md` reads `status.json.resolved_review_release_policy` and
adds a `## Review/Release Policy` section. The summary records source layers,
resolved reviewers, policy warnings, required evidence, needs-decision risks,
skipped gates, and missing evidence. Refreshing the summary also updates the
packet status policy diagnostics so `status.json` remains the machine-readable
source of truth.
