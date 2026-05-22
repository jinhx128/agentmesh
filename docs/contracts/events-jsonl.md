# events.jsonl Contract

`schema_version`: 1

`events.jsonl` is an append-only audit stream. Each non-empty line is one JSON
object.

## Required Event Fields

```json
{
  "schema_version": 1,
  "timestamp": "2026-05-14T00:00:00.000Z",
  "event": "stage.completed"
}
```

Events may include additional fields such as `stage`, `agent`, `artifact`,
`path`, `diagnostic`, or `verdict`.

## Replay Semantics

- Replay events in file order.
- Ignore blank lines.
- Fail on malformed JSON.
- Fail on newer unknown `schema_version`.
- Use `status.json` as the latest snapshot, then use events for audit and
  timeline reconstruction.

## Retention Semantics

- Do not truncate `events.jsonl` inside an active run.
- Compaction, if added later, must write a new snapshot and preserve enough
  history to explain status, artifacts, retries, handoffs, reviews, and release
  verdicts.
