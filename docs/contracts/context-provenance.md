# Context Provenance Contract

`schema_version`: 1

Each captured entry in `context.md` should include a visible provenance block
before its content. The block is human-readable TOML fenced in Markdown so entry
agents can inspect source quality without loading hidden state.

Required fields:

- `schema_version`
- `source_type`: `file`, `diff_file`, `verification_file`,
  `scoped_git_diff`, `mcp_resource`, `project_spec`, or
  `project_correction`
- `source`
- `capture_timestamp`
- `freshness`: `fresh`, `stale`, or `unknown`
- `owner`: a known owner or `unknown`
- `validation_state`: `ok`, `failed`, or `skipped`
- `ingestion_error`: error text or `null`; MCP failures should use
  `<classification>: <message>`
- `redaction_state`: `none`, `redacted`, or `unknown`

Optional fields:

- `source_path`
- `source_uri`
- `source_command`

Failed context capture must remain visible to entry agents with
`validation_state = "failed"` and a useful `ingestion_error`. Successful MCP
resource capture uses `validation_state = "ok"` and `ingestion_error = null`;
failed MCP resource capture records one of these classifications when available:
`server_start_failed`, `initialize_failed`, `resource_not_found`,
`non_text_resource`, `resource_too_large`, `timeout`, `invalid_json_rpc`, or
`unknown`.

Project corrections use `source_type = "project_correction"`, `source` as the
correction id, and `source_path` as the local `.agentmesh/corrections/<id>.toml`
path. Only active corrections enter normal context packs; superseded records
remain readable through correction commands.
