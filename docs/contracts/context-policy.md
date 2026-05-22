# Context Policy Contract

`schema_version`: 1

Context policy is a layered config contract for bounding and annotating context
captured into a run packet. It is local-first and records only policy values, not
secrets or host session state.

## Config Shape

Context policy lives at the root of AgentMesh config:

```toml
[context_policy]
max_bytes = 262144
max_files = 12
freshness_max_age_seconds = 604800
required_sources = ["docs/architecture.md"]
denied_paths = ["secrets", ".env"]
redact_patterns = ["API_KEY=[A-Za-z0-9]+"]
```

Recommended checkout-local starting point:

```toml
[context_policy]
max_files = 12
max_bytes = 262144
denied_paths = [".agentmesh/runs", "docs/archive", "dist-node", "node_modules"]
redact_patterns = ["API_KEY=[A-Za-z0-9]+"]
```

Treat `max_bytes` as a conservative token-cost proxy, not exact tokenizer
output. The policy bounds context payload size before prompt assembly; model
tokenization can still differ by language, code density, and provider.

Fields:

- `max_bytes`: positive integer. Maximum total bytes for file-backed context
  sources checked by policy.
- `max_files`: positive integer. Maximum number of file-backed context sources
  checked by policy.
- `freshness_max_age_seconds`: positive integer. Resolved policy metadata for
  freshness-sensitive context. Enforcement can be source-specific.
- `required_sources`: list of project-relative file paths that are automatically
  captured as context files before explicit `--context-file` inputs.
- `denied_paths`: list of project-relative files or directories that must not
  enter context. A denied directory rejects all descendants.
- `redact_patterns`: list of JavaScript regular expressions applied to captured
  context content. Matches containing `=` preserve the key and replace the value
  with `[REDACTED]`.

Unknown fields fail fast. Array fields must contain only strings.

## Merge Rules

Config layer order is user -> project -> explicit overlay.

- `required_sources`, `denied_paths`, and `redact_patterns` are unioned in layer
  order with duplicates removed.
- `max_bytes`, `max_files`, and `freshness_max_age_seconds` use the stricter
  value; smaller positive integers win.
- Explicit overlays can tighten limits or add sources/denials/redactions, but
  cannot remove lower-layer `denied_paths`.

## Run Behavior

Before packet creation, `flow run` resolves the final policy and checks:

- required sources exist and are files
- required and explicit file-backed context sources do not match `denied_paths`
- file count does not exceed `max_files`
- total readable file bytes do not exceed `max_bytes`
- redaction patterns compile as regular expressions

Policy failures stop before the run directory is created.

When policy succeeds:

- required sources are prepended to `context.md` as normal context-file entries
- matching content is redacted and provenance records `redaction_state = "redacted"`
- `status.json.resolved_context_policy` records the resolved policy
- `status.json.context_bytes` records the final written UTF-8 byte size
- `context.md` includes a `## Resolved Context Policy` section

Generated context can still exceed `max_bytes` after policy preflight because
scoped `git diff`, MCP resources, project specs, and active corrections are
rendered after input-file stat checks. In that case AgentMesh writes a bounded
context file beginning with:

```text
AGENTMESH_CONTEXT_TRUNCATED
max_bytes = <limit>
original_bytes = <generated-size>
source_command = "git diff HEAD -- <scope>"
```

The marker is part of the downstream evidence. Agents and reviewers must treat
truncated context as incomplete evidence and record residual risk instead of
assuming omitted content is irrelevant.

Studio reads `status.json.resolved_context_policy` through the packet browser
summary and shows a compact policy summary in the run overview.

`--exclude-correction <id>` is a per-run escape hatch for active correction
records that are not relevant to the current task. It does not remove the
correction from the project; it only prevents that correction record from being
included in the generated context for that run.
