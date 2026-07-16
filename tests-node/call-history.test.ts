import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  appendCallAdoptionEvent,
  completeCallRecord,
  createCallRecord,
  formatCallIdTimestamp,
  listCallRecords,
  readCallAdoptionEvents,
  readCallRecord,
} from "../packages/runtime/src/calls/history.js";
import { listRegisteredWorkspaces } from "../packages/runtime/src/workspaces/registry.js";
import { cliPath, runCli } from "./helpers/write-side-runtime.js";

function makeWorkspace(): string {
  return mkdtempSync(path.join(tmpdir(), "agentmesh-call-history-"));
}

function writeCommandAgentConfig(
  workspace: string,
  agentId: string,
  command: string,
  extraLines: string[] = [],
): string {
  const configPath = path.join(workspace, ".home", ".config", "agentmesh", "config.toml");
  mkdirSync(path.join(workspace, ".agentmesh"), { recursive: true });
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(
    configPath,
    [
      "schema_version = 1",
      "",
      `[agents.${agentId}]`,
      `label = ${JSON.stringify(agentId)}`,
      'adapter = "command"',
      `command = ${JSON.stringify(command)}`,
      "args = []",
      'capabilities = ["plan"]',
      ...extraLines,
      "",
    ].join("\n"),
  );
  return configPath;
}

function writeExecutable(filePath: string, content: string): void {
  writeFileSync(filePath, content, { encoding: "utf-8", mode: 0o755 });
}

function onlyCallDir(workspace: string): string {
  const callsDir = path.join(workspace, ".agentmesh", "calls");
  const entries = readdirSync(callsDir);
  assert.equal(entries.length, 1);
  return path.join(callsDir, entries[0]);
}

test("direct call ids use local second precision without ISO separators", () => {
  const previousTimezone = process.env.TZ;
  try {
    process.env.TZ = "Asia/Shanghai";
    assert.equal(
      formatCallIdTimestamp(new Date("2026-05-18T08:59:12.861Z")),
      "20260518165912",
    );

    const workspace = makeWorkspace();
    test.after(() => rmSync(workspace, { recursive: true, force: true }));
    mkdirSync(path.join(workspace, ".agentmesh"), { recursive: true });

    const created = createCallRecord({
      workspace,
      cwd: workspace,
      agentId: "agent",
      adapter: "command",
      promptSource: "inline",
      createdAt: new Date(2026, 5, 16, 10, 42, 52),
    });
    const second = createCallRecord({
      workspace,
      cwd: workspace,
      agentId: "agent",
      adapter: "command",
      promptSource: "inline",
      createdAt: new Date(2026, 5, 16, 10, 42, 52),
    });
    assert.equal(created.record.id, "call-20260616104252");
    assert.equal(second.record.id, "call-20260616104252-1");
    assert.equal(created.record.title, `${path.basename(workspace)}-10:42:52`);
    assert.doesNotMatch(created.record.id, /T|Z|\.\d/);
    assert.equal(completeCallRecord(created, { status: "success", stdout: "ok" }).title, created.record.title);
  } finally {
    if (previousTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = previousTimezone;
    }
  }
});

test("agentmesh call records successful direct call evidence in the workspace", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const agent = path.join(workspace, "echo-agent.sh");
  writeExecutable(
    agent,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "payload=$(cat)",
      "printf '# Call Output\\n\\n%s\\n' \"$payload\"",
      "",
    ].join("\n"),
  );
  writeCommandAgentConfig(workspace, "caller", agent, ["stdin = true"]);

  const result = runCli(workspace, [
    "call",
    "--agent",
    "caller",
    "--prompt",
    "hello call history",
  ]);

  assert.equal(result.status, 0, result.stderr);
  const callDir = onlyCallDir(workspace);
  const call = readCallRecord(callDir);
  assert.equal(call.status, "success");
  assert.equal(call.agent_id, "caller");
  assert.equal(call.adapter, "command");
  assert.equal(call.model, null);
  assert.equal(call.purpose, "general");
  assert.equal(call.prompt_source, "inline");
  assert.equal(call.prompt_ref?.path, "prompt.md");
  assert.equal(call.output_ref?.path, "output.md");
  assert.equal(call.output_path, null);
  assert.equal(call.exit_code, 0);
  assert.equal(call.error_kind, "none");
  assert.equal(call.tokens_in, null);
  assert.equal(call.tokens_out, null);
  assert.equal(call.cost_estimate_usd, null);
  assert.equal(call.adoption_status, "unreviewed");
  assert.match(readFileSync(path.join(callDir, "prompt.md"), "utf-8"), /hello call history/);
  assert.match(readFileSync(path.join(callDir, "output.md"), "utf-8"), /# Call Output/);
  assert.deepEqual(listCallRecords(workspace).map((item) => item.id), [call.id]);
  assert.deepEqual(
    listRegisteredWorkspaces({
      registryPath: path.join(workspace, ".home", ".config", "agentmesh", "workspaces.json"),
    }).map((entry) => ({
      path: entry.path,
      enabled: entry.enabled,
      recorded: Boolean(entry.last_recorded_at),
    })),
    [{ path: realpathSync(workspace), enabled: true, recorded: true }],
  );
});

test("agentmesh call default id uses call timestamp prefix", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const agent = path.join(workspace, "echo-agent.sh");
  writeExecutable(
    agent,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "cat >/dev/null",
      "printf '# Call Output\\n'",
      "",
    ].join("\n"),
  );
  writeCommandAgentConfig(workspace, "caller", agent, ["stdin = true"]);

  const result = runCli(workspace, [
    "call",
    "--agent",
    "caller",
    "--prompt",
    "hello generated call id",
  ]);

  assert.equal(result.status, 0, result.stderr);
  const call = readCallRecord(onlyCallDir(workspace));
  assert.match(call.id, /^call-\d{14}$/);
});

test("agentmesh call records prompt-file evidence while adapters receive file content", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const promptFile = path.join(workspace, "review-prompt.md");
  writeFileSync(promptFile, "review from file\n");
  const stdinFile = path.join(workspace, "provider-stdin.txt");
  const argsFile = path.join(workspace, "provider-args.txt");
  const agent = path.join(workspace, "prompt-file-agent.sh");
  writeExecutable(
    agent,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `printf '%s\\n' "$@" > ${JSON.stringify(argsFile)}`,
      `cat > ${JSON.stringify(stdinFile)}`,
      "printf '# Prompt File Output\\n'",
      "",
    ].join("\n"),
  );
  writeCommandAgentConfig(workspace, "prompt_file_reader", agent, ["stdin = true"]);

  const result = runCli(workspace, [
    "call",
    "--agent",
    "prompt_file_reader",
    "--prompt-file",
    "review-prompt.md",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(stdinFile, "utf-8"), "review from file\n");
  assert.equal(readFileSync(argsFile, "utf-8"), "\n");
  const call = readCallRecord(onlyCallDir(workspace));
  assert.equal(call.prompt_source, "file");
  assert.equal(call.prompt_ref?.path, "prompt.md");
  assert.equal(call.prompt_ref?.authoritative, true);
  assert.match(readFileSync(path.join(workspace, ".agentmesh", "calls", call.id, "prompt.md"), "utf-8"), /review from file/);
});

test("agentmesh call refuses outside a workspace before invoking the provider unless no-record is set", () => {
  const workspace = makeWorkspace();
  const outside = makeWorkspace();
  test.after(() => {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
  const marker = path.join(outside, "provider-ran.txt");
  const agent = path.join(workspace, "marker-agent.sh");
  writeExecutable(
    agent,
    [
      "#!/usr/bin/env bash",
      `printf ran > ${JSON.stringify(marker)}`,
      "printf '# Output\\n'",
      "",
    ].join("\n"),
  );
  const configPath = writeCommandAgentConfig(workspace, "marker", agent, ["stdin = true"]);

  const refused = spawnSync(
    process.execPath,
    [cliPath, "--config", configPath, "call", "--agent", "marker", "--prompt", "no workspace"],
    { cwd: outside, encoding: "utf-8" },
  );
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /not an AgentMesh workspace/);
  assert.equal(existsSync(marker), false);

  const unrecorded = spawnSync(
    process.execPath,
    [
      cliPath,
      "--config",
      configPath,
      "call",
      "--agent",
      "marker",
      "--prompt",
      "explicitly invisible",
      "--no-record",
    ],
    { cwd: outside, encoding: "utf-8" },
  );
  assert.equal(unrecorded.status, 0, unrecorded.stderr);
  assert.match(unrecorded.stderr, /not recorded; it will not appear in Studio/);
  assert.equal(existsSync(marker), true);
  assert.equal(existsSync(path.join(outside, ".agentmesh", "calls")), false);
});

test("agentmesh call records adapter failures and timeouts", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const failing = path.join(workspace, "failing-agent.sh");
  writeExecutable(
    failing,
    [
      "#!/usr/bin/env bash",
      "printf 'adapter failed\\n' >&2",
      "exit 7",
      "",
    ].join("\n"),
  );
  const slow = path.join(workspace, "slow-agent.sh");
  writeExecutable(slow, ["#!/usr/bin/env bash", "sleep 2", ""].join("\n"));
  const configPath = writeCommandAgentConfig(workspace, "failing", failing, ["stdin = true"]);
  const slowConfig = [
    readFileSync(configPath, "utf-8"),
    `[agents.slow]`,
    'label = "slow"',
    'adapter = "command"',
    `command = ${JSON.stringify(slow)}`,
    "args = []",
    'capabilities = ["plan"]',
    "stdin = true",
    "",
  ].join("\n");
  writeFileSync(configPath, slowConfig);

  const failed = runCli(workspace, [
    "call",
    "--agent",
    "failing",
    "--prompt",
    "please fail",
  ]);
  assert.equal(failed.status, 7);
  const failedCall = readCallRecord(onlyCallDir(workspace));
  assert.equal(failedCall.status, "failed");
  assert.equal(failedCall.exit_code, 7);
  assert.equal(failedCall.error_kind, "adapter_error");
  assert.match(failedCall.error_summary ?? "", /adapter failed/);
  assert.match(readFileSync(path.join(workspace, ".agentmesh", "calls", failedCall.id, "stderr.txt"), "utf-8"), /adapter failed/);

  const timedOut = runCli(workspace, [
    "call",
    "--agent",
    "slow",
    "--prompt",
    "please timeout",
    "--timeout-secs",
    "0.05",
  ]);
  assert.equal(timedOut.status, 1);
  const calls = listCallRecords(workspace).sort((left, right) => left.created_at.localeCompare(right.created_at));
  assert.equal(calls.length, 2);
  const timeoutCall = calls[1];
  assert.equal(timeoutCall.status, "timeout");
  assert.equal(timeoutCall.exit_code, null);
  assert.equal(timeoutCall.error_kind, "timeout");
  assert.match(timeoutCall.error_summary ?? "", /timed out after 0.05s/);
});

test("agentmesh call records workspace-relative external output files and rejects path escapes", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const agent = path.join(workspace, "file-agent.sh");
  writeExecutable(
    agent,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "output_file=''",
      "while [[ $# -gt 0 ]]; do",
      "  case \"$1\" in",
      "    --output-file) output_file=\"$2\"; shift 2 ;;",
      "    *) shift ;;",
      "  esac",
      "done",
      "printf '# External Output\\n' > \"$output_file\"",
      "",
    ].join("\n"),
  );
  writeCommandAgentConfig(workspace, "file_agent", agent, ['output_file_arg = "--output-file"']);

  const outputFile = path.join(workspace, "outputs", "call.md");
  mkdirSync(path.dirname(outputFile), { recursive: true });
  const result = runCli(workspace, [
    "call",
    "--agent",
    "file_agent",
    "--prompt",
    "write external",
    "--output-file",
    outputFile,
  ]);
  assert.equal(result.status, 0, result.stderr);
  const call = readCallRecord(onlyCallDir(workspace));
  assert.equal(call.output_path, "outputs/call.md");
  assert.equal(call.output_ref?.path, "outputs/call.md");
  assert.equal(call.output_ref?.authoritative, true);
  assert.equal(existsSync(path.join(workspace, ".agentmesh", "calls", call.id, "output.md")), false);

  const escape = runCli(workspace, [
    "call",
    "--agent",
    "file_agent",
    "--prompt",
    "escape",
    "--output-file",
    path.join(path.dirname(workspace), "escape.md"),
  ]);
  assert.equal(escape.status, 1);
  assert.match(escape.stderr, /output file escapes workspace/);
  assert.equal(listCallRecords(workspace).length, 1);
});

test("call record reader marks stale running records and newer schemas as read-only", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const created = createCallRecord({
    workspace,
    cwd: workspace,
    agentId: "reader",
    adapter: "command",
    promptSource: "inline",
    promptContent: "reader prompt",
  });
  assert.equal(created.record.title, `${path.basename(workspace)}-reader prompt`);

  const staleRecord = {
    ...created.record,
    heartbeat_at: "2026-05-17T00:00:00.000Z",
  };
  writeFileSync(
    path.join(created.callDir, "call.json"),
    `${JSON.stringify(staleRecord, null, 2)}\n`,
  );
  assert.equal(readCallRecord(created.callDir).status, "stale");

  const { title: _title, ...legacyRecord } = created.record;
  writeFileSync(
    path.join(created.callDir, "call.json"),
    `${JSON.stringify(legacyRecord, null, 2)}\n`,
  );
  assert.equal(readCallRecord(created.callDir).title, undefined);

  const newerRecord = {
    ...created.record,
    schema_version: 99,
    status: "success",
    completed_at: "2026-05-17T00:00:01.000Z",
  };
  writeFileSync(
    path.join(created.callDir, "call.json"),
    `${JSON.stringify(newerRecord, null, 2)}\n`,
  );
  const readOnly = readCallRecord(created.callDir) as {
    read_only?: boolean;
    schema_warning?: string;
  };
  assert.equal(readOnly.read_only, true);
  assert.match(readOnly.schema_warning ?? "", /newer than supported/);
});

test("call adoption records a single append-only transition without changing artifacts", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const created = createCallRecord({
    workspace,
    cwd: workspace,
    agentId: "reviewer",
    adapter: "command",
    promptSource: "inline",
    promptContent: "review this output",
  });
  writeFileSync(path.join(created.callDir, "output.md"), "accepted evidence\n");

  const promptBefore = readFileSync(path.join(created.callDir, "prompt.md"), "utf-8");
  const outputBefore = readFileSync(path.join(created.callDir, "output.md"), "utf-8");
  const updated = appendCallAdoptionEvent({
    callDir: created.callDir,
    status: "accepted",
    updatedByEntrypoint: "cli",
    reason: "used in changelog",
    relatedCommit: "abc1234",
    relatedRunId: "run-2026-05-17",
    updatedAt: "2026-05-17T10:00:00.000Z",
  });

  assert.equal(updated.adoption_status, "accepted");
  assert.equal(updated.title, created.record.title);
  assert.deepEqual(updated.related_run_ids, ["run-2026-05-17"]);
  assert.deepEqual(readCallRecord(created.callDir).related_run_ids, ["run-2026-05-17"]);
  assert.equal(readFileSync(path.join(created.callDir, "prompt.md"), "utf-8"), promptBefore);
  assert.equal(readFileSync(path.join(created.callDir, "output.md"), "utf-8"), outputBefore);

  const events = readCallAdoptionEvents(created.callDir);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    schema_version: 1,
    call_id: created.record.id,
    previous_status: "unreviewed",
    status: "accepted",
    updated_at: "2026-05-17T10:00:00.000Z",
    updated_by_entrypoint: "cli",
    reason: "used in changelog",
    related_commit: "abc1234",
    related_run_id: "run-2026-05-17",
    superseded_by_call_id: null,
  });

  const eventLogBefore = readFileSync(path.join(created.callDir, "adoption.jsonl"), "utf-8");
  assert.throws(
    () =>
      appendCallAdoptionEvent({
        callDir: created.callDir,
        status: "rejected",
        updatedByEntrypoint: "cli",
        reason: "changed my mind",
      }),
    /cannot transition call adoption from accepted to rejected/,
  );
  assert.equal(readFileSync(path.join(created.callDir, "adoption.jsonl"), "utf-8"), eventLogBefore);
});

test("calls adopt CLI records adoption through the runtime boundary", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeCommandAgentConfig(workspace, "caller", process.execPath);
  const created = createCallRecord({
    workspace,
    cwd: workspace,
    agentId: "reviewer",
    adapter: "command",
    promptSource: "inline",
    promptContent: "review this output",
  });

  const adopted = runCli(workspace, [
    "calls",
    "adopt",
    created.record.id,
    "--status",
    "accepted",
    "--entrypoint",
    "studio",
    "--reason",
    "used in implementation",
    "--related-commit",
    "abc1234",
    "--related-run-id",
    "run-linked",
    "--json",
  ]);
  assert.equal(adopted.status, 0, adopted.stderr);
  const payload = JSON.parse(adopted.stdout);
  assert.equal(payload.call.adoption_status, "accepted");
  assert.equal(payload.adoption_events[0].updated_by_entrypoint, "studio");
  assert.equal(payload.adoption_events[0].reason, "used in implementation");
  assert.equal(payload.adoption_events[0].related_commit, "abc1234");
  assert.equal(payload.adoption_events[0].related_run_id, "run-linked");
  assert.equal(readCallRecord(created.callDir).adoption_status, "accepted");

  const invalidTransition = runCli(workspace, [
    "calls",
    "adopt",
    created.record.id,
    "--status",
    "rejected",
  ]);
  assert.equal(invalidTransition.status, 1);
  assert.match(invalidTransition.stderr, /cannot transition call adoption from accepted to rejected/);
});

test("call adoption supports superseded links without requiring referenced calls or runs to exist", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const created = createCallRecord({
    workspace,
    cwd: workspace,
    agentId: "researcher",
    adapter: "command",
    promptSource: "inline",
    promptContent: "research",
  });

  const updated = appendCallAdoptionEvent({
    callDir: created.callDir,
    status: "superseded",
    updatedByEntrypoint: "desktop",
    reason: "newer answer used",
    relatedRunId: "missing-run",
    supersededByCallId: "missing-call",
    updatedAt: "2026-05-17T10:01:00.000Z",
  });

  assert.equal(updated.adoption_status, "superseded");
  assert.deepEqual(updated.related_run_ids, ["missing-run"]);
  assert.deepEqual(updated.related_call_ids, ["missing-call"]);
  assert.equal(readCallAdoptionEvents(created.callDir)[0].superseded_by_call_id, "missing-call");
});

test("call adoption validates direct runtime metadata before appending events", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const created = createCallRecord({
    workspace,
    cwd: workspace,
    agentId: "reviewer",
    adapter: "command",
    promptSource: "inline",
    promptContent: "review metadata",
  });

  assert.throws(
    () =>
      appendCallAdoptionEvent({
        callDir: created.callDir,
        status: "accepted",
        updatedByEntrypoint: "studio",
        relatedRunId: "../escape",
      }),
    /invalid related-run-id: \.\.\/escape/,
  );
  assert.equal(existsSync(path.join(created.callDir, "adoption.jsonl")), false);

  assert.throws(
    () =>
      appendCallAdoptionEvent({
        callDir: created.callDir,
        status: "accepted",
        updatedByEntrypoint: "studio",
        reason: "bad\0reason",
      }),
    /text values cannot contain null bytes/,
  );
  assert.equal(existsSync(path.join(created.callDir, "adoption.jsonl")), false);
  assert.equal(readCallRecord(created.callDir).adoption_status, "unreviewed");
});

test("call adoption rejects invalid transitions and newer schema records", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const created = createCallRecord({
    workspace,
    cwd: workspace,
    agentId: "reader",
    adapter: "command",
    promptSource: "inline",
    promptContent: "reader prompt",
  });

  assert.throws(
    () =>
      appendCallAdoptionEvent({
        callDir: created.callDir,
        status: "superseded",
        updatedByEntrypoint: "cli",
      }),
    /superseded adoption requires superseded_by_call_id/,
  );
  assert.equal(existsSync(path.join(created.callDir, "adoption.jsonl")), false);

  const newerRecord = {
    ...created.record,
    schema_version: 99,
  };
  writeFileSync(
    path.join(created.callDir, "call.json"),
    `${JSON.stringify(newerRecord, null, 2)}\n`,
  );
  assert.throws(
    () =>
      appendCallAdoptionEvent({
        callDir: created.callDir,
        status: "accepted",
        updatedByEntrypoint: "cli",
        reason: "newer schema should be read-only",
      }),
    /cannot mutate adoption for newer call record schema/,
  );
  assert.equal(existsSync(path.join(created.callDir, "adoption.jsonl")), false);
});
