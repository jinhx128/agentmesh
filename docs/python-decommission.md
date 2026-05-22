# Python Decommission

Python is no longer a target AgentMesh runtime. The TypeScript-on-Node stack is
the only command surface.

## Removed

- `src/agentmesh`
- `tests/`
- `pyproject.toml`
- Python compile / pytest / shell CLI steps from `Makefile`

## Retained Behavior In TypeScript

| Command or behavior | TS status | Verification |
| --- | --- | --- |
| `agentmesh init` | replacement_ready | `npm test` (`cli-surface`) |
| `agentmesh agents list` | replacement_ready | `npm test` (`cli-surface`) |
| `agentmesh agents add` | replacement_ready | `npm test` (`cli-surface`) |
| `agentmesh agents remove` | replacement_ready | `npm test` (`management-cli`) |
| `agentmesh adapters list` | replacement_ready | `npm test` (`cli-surface`) |
| `agentmesh workflows list` | replacement_ready | `npm test` (`workflow-registry`) |
| `agentmesh workflows show` | replacement_ready | `npm test` (`workflow-registry`) |
| `agentmesh workflows add` | replacement_ready | `npm test` (`management-cli`) |
| `agentmesh workflows remove` | replacement_ready | `npm test` (`management-cli`) |
| `agentmesh skill show` | replacement_ready | `npm test` (`skill-verify`) |
| `agentmesh skill export` | replacement_ready | `npm test` (`skill-verify`) |
| `agentmesh skill install` | replacement_ready | `npm test` (`cli-surface`) |
| `agentmesh skill verify` | replacement_ready | `npm test` (`skill-verify`) |
| `agentmesh call` | replacement_ready | `npm test` (`cli-surface`) |
| `agentmesh run` | replacement_ready | `npm test` (`cli-surface`) |
| `agentmesh doctor` | replacement_ready | `npm test` (`doctor-readiness`) |
| `agentmesh flow run` | replacement_ready | `npm test` (`cli-surface`) |
| `agentmesh flow status` | replacement_ready | `npm test` (`cli-surface`) |
| `agentmesh flow events` | replacement_ready | `npm test` (`cli-surface`) |
| `agentmesh flow prompt` | replacement_ready | `npm test` (`cli-surface`) |
| `agentmesh flow attach` | replacement_ready | `npm test` (`cli-surface`) |
| `agentmesh flow dispatch` | replacement_ready | `npm test` (`write-side-runtime`) |
| `agentmesh flow retry` | replacement_ready | `npm test` (`write-side-runtime`) |
| `agentmesh flow resume` | replacement_ready | `npm test` (`write-side-runtime`) |
| automatic context pack inputs | replacement_ready | `npm test` (`write-side-runtime`) |
| packet validation / status / events / artifacts | replacement_ready | `npm test` (`packet-*`) |
| release-check summary | replacement_ready | `npm test` (`release-check`) |

## Deferred To TS Runtime Phases

| Old behavior | Status | Target |
| --- | --- | --- |
| MCP resource ingestion | write_side | S7 MCP client hardening |

## Not Preserved As Compatibility Promises

- The old Python module entrypoint.
- Python package metadata.
- Python test harnesses.
- A long-lived `agentmesh-py` command.
- A dual-runtime compatibility period.

## Verification

Use:

```bash
make check
make smoke
```
