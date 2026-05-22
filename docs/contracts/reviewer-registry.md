# Reviewer Registry Contract

`schema_version`: 1

Reviewer registry metadata describes which configured AgentMesh agents can act
as reviewers and what output format the controller expects from them.

## Shape

```json
{
  "schema_version": 1,
  "expected_output_format": "agentmesh-review-markdown-v1",
  "reviewers": [
    {
      "schema_version": 1,
      "id": "antigravity",
      "label": "Antigravity Reviewer",
      "adapter_target": "antigravity-cli",
      "expected_output_format": "agentmesh-review-markdown-v1",
      "availability": {
        "state": "available",
        "reason": "agent has review capability"
      },
      "capability_profiles": ["review", "reviewer.security"],
      "source_layer": "user",
      "source_path": "~/.config/agentmesh/config.toml"
    }
  ]
}
```

## Rules

- `id` is the configured agent id.
- `label` is the human-readable agent label.
- `adapter_target` is the normalized adapter id used to invoke the agent.
- `expected_output_format` is currently `agentmesh-review-markdown-v1`.
- `availability.state` is `available`, `unavailable`, or `unknown`.
- `capability_profiles` lists review-facing capability tags (`review` and
  `reviewer.*`) that can satisfy review policy profiles.
- Agents with empty capabilities or an explicit `review` capability are
  available reviewer candidates.
- Agents that lack `review` capability remain visible as `unavailable` records
  so workflow planning can explain why they were not selected.

## Observation Surface

- `agentmesh reviewers list` emits human-readable reviewer rows.
- `agentmesh reviewers list --json` emits the full registry report.
- Reviewer output is evidence, not fact. Controllers still classify findings as
  accepted, rejected, or needs decision before a release gate can block.
