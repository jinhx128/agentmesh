import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  adapterPluginManifestFromRuntimeAdapter,
  buildAdapterPluginAgentConfig,
  defineAdapterPlugin,
  type AdapterPlugin,
} from "../packages/runtime/src/adapters/plugin.js";
import { prepareAdapterPluginSessionInvocation } from "../packages/runtime/src/adapters/invocation.js";
import { redactAdapterStructuredResult } from "../packages/runtime/src/adapters/session.js";
import { listRuntimeAdapters } from "../packages/runtime/src/adapters/registry.js";

function makeWorkspace(): string {
  return mkdtempSync(path.join(tmpdir(), "agentmesh-adapter-plugin-"));
}

function writeFixtureCli(workspace: string): string {
  const cliPath = path.join(workspace, "fixture-agent.mjs");
  writeFileSync(
    cliPath,
    [
      "import { writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "const valueAfter = (flag) => {",
      "  const index = args.indexOf(flag);",
      "  return index === -1 ? undefined : args[index + 1];",
      "};",
      "const outputFile = valueAfter('--output-file');",
      "const payload = {",
      "  model: valueAfter('--model'),",
      "  prompt: valueAfter('--prompt'),",
      "};",
      "if (outputFile) {",
      "  writeFileSync(outputFile, JSON.stringify(payload) + '\\n');",
      "}",
      "console.log('fixture ok');",
      "",
    ].join("\n"),
  );
  return cliPath;
}

function writeSessionFixtureCli(workspace: string): string {
  const cliPath = path.join(workspace, "fixture-session-agent.mjs");
  writeFileSync(
    cliPath,
    [
      "const args = process.argv.slice(2);",
      "const valueAfter = (flag) => {",
      "  const index = args.indexOf(flag);",
      "  return index === -1 ? undefined : args[index + 1];",
      "};",
      "const resume = valueAfter('--resume');",
      "const failure = valueAfter('--failure');",
      "if (failure) {",
      "  console.log(JSON.stringify({ type: 'failure', failure }));",
      "  process.exitCode = 1;",
      "} else if (resume) {",
      "  console.log(JSON.stringify({ type: 'result', session_id: resume, output: 'resumed' }));",
      "} else {",
      "  console.log(JSON.stringify({ type: 'session', session_id: 'session-test-123' }));",
      "  console.log(JSON.stringify({ type: 'result', output: 'started' }));",
      "}",
      "",
    ].join("\n"),
  );
  return cliPath;
}

function fixtureAdapter(): AdapterPlugin {
  return defineAdapterPlugin({
    id: "fixture-adapter",
    aliases: ["fixture"],
    label: "Fixture Adapter",
    description: "Contract-test adapter for third-party plugin behavior.",
    capabilities: {
      roles: ["planner"],
      stages: ["plan"],
      supports_non_interactive: true,
    },
    detect({ command }) {
      return existsSync(command)
        ? { status: "available" }
        : { status: "missing", message: `command not found: ${command}` };
    },
    resolveModel(input) {
      const normalized = input.trim().toLowerCase();
      return normalized === "fast" || normalized === "fixture-fast"
        ? { status: "resolved", canonicalModel: "fixture-fast" }
        : { status: "not_found", input };
    },
    probe({ agent }) {
      return existsSync(agent.command)
        ? { ok: true, status: "ready" }
        : { ok: false, status: "not_ready", message: `command not found: ${agent.command}` };
    },
    buildInvocation({ agent, outputFile, prompt }) {
      return {
        adapterId: agent.adapter,
        command: [
          process.execPath,
          agent.command,
          "--model",
          agent.model ?? "",
          "--prompt",
          prompt ?? "",
          "--output-file",
          outputFile ?? "",
        ],
        outputFile,
        captureStdout: false,
        nonInteractive: true,
      };
    },
    parseResult({ exitCode, stdout, stderr }) {
      return {
        ok: exitCode === 0,
        status: exitCode === 0 ? "ok" : "failed",
        stdout,
        stderr,
      };
    },
  });
}

function sessionFixtureAdapter(): AdapterPlugin {
  return defineAdapterPlugin({
    ...fixtureAdapter(),
    id: "fixture-session-adapter",
    aliases: ["fixture-session"],
    capabilities: {
      roles: ["planner"],
      stages: ["plan"],
      supports_non_interactive: true,
      supports_resume: true,
      supports_structured_session_id: true,
    },
    buildSessionInvocation({ agent, prompt, session }) {
      return {
        adapterId: agent.adapter,
        command:
          session.mode === "resume"
            ? [process.execPath, agent.command, "--resume", session.providerSessionId]
            : [process.execPath, agent.command, "--fresh", prompt ?? ""],
        captureStdout: true,
        nonInteractive: true,
      };
    },
    parseStructuredSessionResult({ exitCode, stdout }) {
      let records: Record<string, unknown>[];
      try {
        records = (stdout ?? "")
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Record<string, unknown>);
      } catch {
        return {
          outputText: "",
          failure: {
            classification: "invalid_output",
            message: "fixture produced unstructured output",
            retryable: false,
          },
        };
      }
      const session = records.find(
        (record) => record.type === "session" && typeof record.session_id === "string",
      );
      const result = records.find(
        (record) => record.type === "result" && typeof record.output === "string",
      );
      const failure = records.find(
        (record) => record.type === "failure" && typeof record.failure === "string",
      );
      if (failure) {
        const classification =
          failure.failure === "not_found"
            ? "session_not_found"
            : failure.failure === "rate_limited"
              ? "provider_busy"
              : failure.failure === "auth_required"
                ? "auth_required"
                : "invalid_output";
        return {
          outputText: "",
          failure: {
            classification,
            message: `fixture failure: ${failure.failure}`,
            retryable: classification === "provider_busy",
          },
        };
      }
      if (exitCode !== 0 || !result) {
        return {
          outputText: "",
          failure: {
            classification: "invalid_output",
            message: "fixture produced no structured result",
            retryable: false,
          },
        };
      }
      return {
        ...(session ? { providerSessionId: session.session_id as string } : {}),
        outputText: result.output as string,
      };
    },
  });
}

test("adapter plugin contract doc defines the narrow third-party surface", () => {
  const doc = readFileSync(
    path.join(process.cwd(), "docs", "contracts", "adapter-plugin.md"),
    { encoding: "utf-8" },
  );

  for (const requiredTerm of [
    "schema_version",
    "id",
    "label",
    "detect()",
    "resolveModel(input)",
    "probe(config)",
    "buildInvocation(request)",
    "parseResult(output)",
    "must not write packet files",
    "must not advance runtime state",
    "must not bypass agent registration readiness",
    "cloud runner",
  ]) {
    assert.match(doc, new RegExp(requiredTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("built-in adapters can be projected into the adapter plugin manifest shape", () => {
  for (const adapter of listRuntimeAdapters()) {
    const manifest = adapterPluginManifestFromRuntimeAdapter(adapter);
    assert.equal(manifest.id, adapter.id);
    assert.equal(manifest.label, adapter.label);
    assert.deepEqual(manifest.aliases, adapter.aliases);
    assert.deepEqual(manifest.capabilities, adapter.capabilities);
  }
});

test("fixture adapter runs the add probe invoke parse contract flow", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const plugin = fixtureAdapter();
  const cliPath = writeFixtureCli(workspace);
  const outputFile = path.join(workspace, "out.json");

  const agent = buildAdapterPluginAgentConfig(plugin, {
    agentId: "fixture-planner",
    command: cliPath,
    model: "fast",
    capabilities: ["plan"],
  });

  assert.equal(agent.id, "fixture-planner");
  assert.equal(agent.adapter, "fixture-adapter");
  assert.equal(agent.model, "fixture-fast");
  assert.deepEqual(plugin.detect({ command: agent.command }), { status: "available" });
  assert.deepEqual(plugin.probe({ agent, timeoutSecs: 1 }), { ok: true, status: "ready" });

  const invocation = plugin.buildInvocation({
    agent,
    prompt: "draft the plan",
    outputFile,
  });
  const result = spawnSync(invocation.command[0], invocation.command.slice(1), {
    encoding: "utf-8",
  });
  const parsed = plugin.parseResult({
    exitCode: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  });

  assert.equal(parsed.ok, true);
  assert.equal(parsed.status, "ok");
  assert.match(parsed.stdout ?? "", /fixture ok/);
  assert.deepEqual(JSON.parse(readFileSync(outputFile, { encoding: "utf-8" })), {
    model: "fixture-fast",
    prompt: "draft the plan",
  });
});

test("adapter plugin helpers do not expose internal packet writers", () => {
  const source = readFileSync(
    path.join(process.cwd(), "packages", "runtime", "src", "adapters", "plugin.ts"),
    { encoding: "utf-8" },
  );

  assert.doesNotMatch(source, /packet\/io/);
  assert.doesNotMatch(
    source,
    /\b(saveStatus|appendEvent|recordArtifact|writeArtifacts|writeFileAtomic|writeFileSync|appendFileSync)\b/,
  );
});

test("session-capable plugins build distinct fresh and resume commands", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const plugin = sessionFixtureAdapter();
  const agent = buildAdapterPluginAgentConfig(plugin, {
    agentId: "fixture-session",
    command: writeSessionFixtureCli(workspace),
    model: "fast",
  });

  const fresh = prepareAdapterPluginSessionInvocation(plugin, agent, { prompt: "begin" }, { mode: "fresh" });
  const resumed = prepareAdapterPluginSessionInvocation(
    plugin,
    agent,
    { prompt: "ignored" },
    { mode: "resume", providerSessionId: "session-test-123" },
  );

  assert.deepEqual(fresh.command.slice(-2), ["--fresh", "begin"]);
  assert.deepEqual(resumed.command.slice(-2), ["--resume", "session-test-123"]);
});

test("session-capable plugins parse only structured JSONL session IDs and redact returned diagnostics", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const plugin = sessionFixtureAdapter();
  const agent = buildAdapterPluginAgentConfig(plugin, {
    agentId: "fixture-session",
    command: writeSessionFixtureCli(workspace),
    model: "fast",
  });
  const invocation = prepareAdapterPluginSessionInvocation(plugin, agent, {}, { mode: "fresh" });
  const result = spawnSync(invocation.command[0], invocation.command.slice(1), { encoding: "utf-8" });
  const parsed = plugin.parseStructuredSessionResult?.({
    exitCode: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  });

  assert.equal(parsed?.providerSessionId, "session-test-123");
  assert.equal(parsed?.outputText, "started");
  assert.equal(
    sessionFixtureAdapter().parseStructuredSessionResult?.({
      exitCode: 0,
      stdout: "the previous session is session-test-123",
    })?.failure?.classification,
    "invalid_output",
  );
  assert.deepEqual(
    redactAdapterStructuredResult({
      providerSessionId: "session-test-123",
      outputText: "diagnostic session-test-123",
      failure: {
        classification: "session_not_found",
        message: "session-test-123 was not found",
        retryable: false,
        diagnostic: "provider diagnostic session-test-123",
      },
    }),
    {
      outputText: "diagnostic [REDACTED]",
      failure: {
        classification: "session_not_found",
        message: "[REDACTED] was not found",
        retryable: false,
      },
    },
  );
});

test("session fixture maps documented failures without provider-specific public states", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const cliPath = writeSessionFixtureCli(workspace);
  const plugin = sessionFixtureAdapter();
  const expected = {
    not_found: "session_not_found",
    rate_limited: "provider_busy",
    auth_required: "auth_required",
    invalid_output: "invalid_output",
  } as const;

  for (const [failure, classification] of Object.entries(expected)) {
    const result = spawnSync(process.execPath, [cliPath, "--failure", failure], { encoding: "utf-8" });
    const parsed = plugin.parseStructuredSessionResult?.({
      exitCode: result.status ?? 1,
      stdout: result.stdout,
      stderr: result.stderr,
    });
    assert.equal(parsed?.failure?.classification, classification);
    assert.equal(parsed?.failure?.retryable, classification === "provider_busy");
    assert.doesNotMatch(JSON.stringify(parsed), /session-test-123/);
  }
});
