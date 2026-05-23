import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  prepareAdapterInvocation,
  type AdapterInvocationAgent,
} from "../packages/runtime/src/adapters/invocation.js";
import {
  AgentCallError,
  runAgentCallAsync,
  runAgentCallWithTiming,
} from "../packages/runtime/src/adapters.js";
import { lookupRuntimeAdapter } from "../packages/runtime/src/adapters/registry.js";

function makeWorkspace(): string {
  return mkdtempSync(path.join(tmpdir(), "agentmesh-adapter-invocation-"));
}

function builtInAgent(
  adapterId: string,
  overrides: Partial<AdapterInvocationAgent> = {},
): AdapterInvocationAgent {
  const adapter = lookupRuntimeAdapter(adapterId);
  return {
    id: adapter.id,
    adapter: adapter.id,
    command: "agent",
    args: adapter.args,
    model: "model-a",
    reasoning_effort: "high",
    ...overrides,
  };
}

test("prepares AI CLI invocations with prompt, model, reasoning, and stdout capture", () => {
  const cases: Array<{
    adapter: string;
    effort: string;
    command: string[];
    stdin?: string;
  }> = [
    {
      adapter: "codex-cli",
      effort: "high",
      command: ["agent", "exec", "-m", "model-a", "-c", 'model_reasoning_effort="high"', "-"],
      stdin: "hello",
    },
    {
      adapter: "claude-code-cli",
      effort: "high",
      command: ["agent", "-p", "--model", "model-a", "--effort", "high"],
      stdin: "hello",
    },
    {
      adapter: "cursor-agent",
      effort: "none",
      command: ["agent", "--print", "--trust", "--model", "model-a", "hello"],
    },
    {
      adapter: "antigravity-cli",
      effort: "high",
      command: ["agent", "-p", "hello"],
    },
    {
      adapter: "opencode-cli",
      effort: "xhigh",
      command: ["agent", "run", "--model", "model-a", "--variant", "max", "hello"],
    },
  ];

  for (const item of cases) {
    const prepared = prepareAdapterInvocation(
      builtInAgent(item.adapter, { reasoning_effort: item.effort }),
      {
        prompt: "hello",
        outputFile: "out.txt",
      },
    );

    assert.deepEqual(prepared.command, item.command);
    assert.equal(prepared.stdin, item.stdin);
    assert.equal(prepared.captureStdout, true);
    assert.equal(prepared.outputFile, "out.txt");
    assert.equal(prepared.nonInteractive, true);
    assert.equal(prepared.adapterId, item.adapter);
  }
});

test("prepares configured environment variables for adapter invocations", () => {
  const prepared = prepareAdapterInvocation(
    builtInAgent("antigravity-cli", {
      env: [
        "HTTPS_PROXY=http://127.0.0.1:7897",
        "NO_BROWSER=true",
      ],
    }),
    {
      prompt: "hello",
    },
  );

  assert.deepEqual(prepared.env, {
    HTTPS_PROXY: "http://127.0.0.1:7897",
    NO_BROWSER: "true",
  });
});

test("cursor-agent invocation requires a non-empty prompt", () => {
  assert.throws(
    () =>
      prepareAdapterInvocation(builtInAgent("cursor-agent", { reasoning_effort: "none" }), {
        prompt: "",
      }),
    /agent cursor-agent: prompt is required for cursor-agent/,
  );
});

test("rejects malformed configured environment variables", () => {
  for (const entry of ["MISSING_EQUALS", "", "=value"]) {
    assert.throws(
      () =>
        prepareAdapterInvocation(
          builtInAgent("antigravity-cli", {
            env: [entry],
          }),
          {
            prompt: "hello",
          },
        ),
      /agent antigravity-cli: env entries must be KEY=value strings/,
    );
  }
});

test("prepares command adapter prompt and output-file modes", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const promptFile = path.join(workspace, "prompt.md");
  writeFileSync(promptFile, "file prompt\n");

  const promptFilePrepared = prepareAdapterInvocation(
    builtInAgent("command", {
      prompt_file_arg: "--prompt-file",
      output_file_arg: "--output-file",
    }),
    {
      promptFile,
      outputFile: "out.txt",
    },
  );
  assert.deepEqual(promptFilePrepared.command, [
    "agent",
    "--prompt-file",
    promptFile,
    "--output-file",
    "out.txt",
  ]);
  assert.equal(promptFilePrepared.captureStdout, false);
  assert.equal(promptFilePrepared.stdin, undefined);
  assert.equal(promptFilePrepared.nonInteractive, false);

  const promptArgPrepared = prepareAdapterInvocation(
    builtInAgent("command", { prompt_arg: "--prompt" }),
    { prompt: "inline prompt" },
  );
  assert.deepEqual(promptArgPrepared.command, ["agent", "--prompt", "inline prompt"]);

  const stdinPrepared = prepareAdapterInvocation(
    builtInAgent("command", { stdin: true }),
    { promptFile, outputFile: "stdout.txt" },
  );
  assert.deepEqual(stdinPrepared.command, ["agent"]);
  assert.equal(stdinPrepared.stdin, "file prompt\n");
  assert.equal(stdinPrepared.captureStdout, true);
  assert.equal(stdinPrepared.outputFile, "stdout.txt");

  const defaultPrepared = prepareAdapterInvocation(builtInAgent("command"), {
    promptFile,
  });
  assert.deepEqual(defaultPrepared.command, ["agent"]);
  assert.equal(defaultPrepared.stdin, "file prompt\n");
});

test("prepares AI CLI prompt-file invocations with file content rather than the path", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const promptFile = path.join(workspace, "prompt.md");
  writeFileSync(promptFile, "file prompt for ai\n");

  const cases: Array<{
    adapter: string;
    effort: string;
    command: string[];
    stdin?: string;
  }> = [
    {
      adapter: "codex-cli",
      effort: "high",
      command: ["agent", "exec", "-m", "model-a", "-c", 'model_reasoning_effort="high"', "-"],
      stdin: "file prompt for ai\n",
    },
    {
      adapter: "claude-code-cli",
      effort: "high",
      command: ["agent", "-p", "--model", "model-a", "--effort", "high"],
      stdin: "file prompt for ai\n",
    },
    {
      adapter: "cursor-agent",
      effort: "none",
      command: ["agent", "--print", "--trust", "--model", "model-a", "file prompt for ai\n"],
    },
    {
      adapter: "antigravity-cli",
      effort: "high",
      command: ["agent", "-p", "file prompt for ai\n"],
    },
    {
      adapter: "opencode-cli",
      effort: "xhigh",
      command: ["agent", "run", "--model", "model-a", "--variant", "max", "file prompt for ai\n"],
    },
  ];

  for (const item of cases) {
    const prepared = prepareAdapterInvocation(
      builtInAgent(item.adapter, { reasoning_effort: item.effort }),
      {
        promptFile,
        outputFile: "out.txt",
      },
    );

    assert.deepEqual(prepared.command, item.command);
    assert.equal(prepared.stdin, item.stdin);
    assert.equal(
      prepared.command.includes(promptFile),
      false,
      `${item.adapter} should receive prompt file content, not the path`,
    );
  }
});

test("prepares file-output args for AI adapters when explicitly configured", () => {
  const prepared = prepareAdapterInvocation(
    builtInAgent("antigravity-cli", { output_file_arg: "--output-file" }),
    {
      prompt: "hello",
      outputFile: "antigravity.out",
    },
  );

  assert.deepEqual(prepared.command, [
    "agent",
    "-p",
    "hello",
    "--output-file",
    "antigravity.out",
  ]);
  assert.equal(prepared.captureStdout, false);
});

test("rejects AI CLI invocation preparation without a model", () => {
  assert.throws(
    () =>
      prepareAdapterInvocation(builtInAgent("codex-cli", { model: undefined }), {
        prompt: "hello",
      }),
    /agent codex-cli: model is required for codex-cli/,
  );
});

test("prepares antigravity invocations without implying per-agent model selection", () => {
  const prepared = prepareAdapterInvocation(
    builtInAgent("antigravity-cli", { model: undefined }),
    { prompt: "hello" },
  );

  assert.deepEqual(prepared.command, ["agent", "-p", "hello"]);
  assert.equal(prepared.stdin, undefined);
});

test("agent calls report config load and synchronous spawn timing", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const outputFile = path.join(workspace, "agent-output.md");
  const agent = path.join(workspace, "agent.sh");
  writeFileSync(
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
      "printf '# Output\\n' > \"$output_file\"",
      "",
    ].join("\n"),
    { encoding: "utf-8", mode: 0o755 },
  );
  const configPath = path.join(workspace, "agentmesh.toml");
  writeFileSync(
    configPath,
    [
      "schema_version = 1",
      "",
      "[agents.timer]",
      'label = "Timer"',
      'adapter = "command"',
      `command = ${JSON.stringify(agent)}`,
      "args = []",
      'capabilities = ["plan"]',
      'output_file_arg = "--output-file"',
      "",
    ].join("\n"),
  );

  const result = runAgentCallWithTiming({
    configPath,
    agentName: "timer",
    outputFile,
  });

  assert.equal(result.exitCode, 0);
  assert.match(readFileSync(outputFile, "utf-8"), /# Output/);
  assert.equal(typeof result.timing.config_load_ms, "number");
  assert.equal(typeof result.timing.adapter_spawn_ms, "number");
  assert.equal(typeof result.timing.agent_total_ms, "number");
  assert.equal(typeof result.timing.total_ms, "number");
  assert.equal(result.timing.first_output_ms, undefined);
});

test("agent calls discover provider CLIs installed outside PATH", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const home = path.join(workspace, "home");
  const providerBin = path.join(home, ".opencode", "bin");
  mkdirSync(providerBin, { recursive: true });
  const providerPath = path.join(providerBin, "opencode");
  writeFileSync(providerPath, "#!/bin/sh\necho discovered-opencode \"$@\"\n");
  chmodSync(providerPath, 0o755);

  const configPath = path.join(workspace, "agentmesh.toml");
  writeFileSync(
    configPath,
    [
      "schema_version = 1",
      "",
      "[agents.review]",
      'label = "OpenCode Review"',
      'adapter = "opencode-cli"',
      'command = "opencode"',
      'args = [ "run" ]',
      'model = "openai/gpt-5.5"',
      'reasoning_effort = "none"',
      'capabilities = [ "review" ]',
      "",
    ].join("\n"),
  );
  const outputFile = path.join(workspace, "review.out");
  const previousHome = process.env.HOME;
  const previousPath = process.env.PATH;
  process.env.HOME = home;
  process.env.PATH = "";
  try {
    const result = runAgentCallWithTiming({
      configPath,
      cwd: workspace,
      agentName: "review",
      prompt: "hello",
      outputFile,
    });

    assert.equal(result.exitCode, 0);
    assert.match(readFileSync(outputFile, "utf-8"), /discovered-opencode run --model openai\/gpt-5\.5 hello/);
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
  }
});

test("async agent calls capture stdout and first output timing", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const outputFile = path.join(workspace, "async-output.md");
  const agent = path.join(workspace, "async-agent.sh");
  writeFileSync(
    agent,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "printf '# Async Output\\n\\nCaptured stdout.\\n'",
      "",
    ].join("\n"),
    { encoding: "utf-8", mode: 0o755 },
  );
  const configPath = writeCommandAgentConfig(workspace, "async_stdout", agent);

  const result = await runAgentCallAsync({
    configPath,
    agentName: "async_stdout",
    outputFile,
  });

  assert.equal(result.exitCode, 0);
  assert.match(readFileSync(outputFile, "utf-8"), /Captured stdout/);
  assert.equal(typeof result.timing.adapter_spawn_ms, "number");
  assert.equal(typeof result.timing.first_output_ms, "number");
  assert.equal(typeof result.timing.agent_total_ms, "number");
});

test("async agent calls support output-file args, stdin, nonzero exit, timeout, and spawn failure", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const outputFile = path.join(workspace, "async-file-output.md");
  const fileAgent = path.join(workspace, "file-agent.sh");
  writeFileSync(
    fileAgent,
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
      "printf '# File Output\\n' > \"$output_file\"",
      "",
    ].join("\n"),
    { encoding: "utf-8", mode: 0o755 },
  );
  const stdinAgent = path.join(workspace, "stdin-agent.sh");
  writeFileSync(
    stdinAgent,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "payload=$(cat)",
      "printf '# Stdin\\n\\n%s\\n' \"$payload\"",
      "",
    ].join("\n"),
    { encoding: "utf-8", mode: 0o755 },
  );
  const failingAgent = path.join(workspace, "failing-agent.sh");
  writeFileSync(
    failingAgent,
    ["#!/usr/bin/env bash", "exit 7", ""].join("\n"),
    { encoding: "utf-8", mode: 0o755 },
  );
  const slowAgent = path.join(workspace, "slow-agent.sh");
  writeFileSync(
    slowAgent,
    ["#!/usr/bin/env bash", "sleep 2", ""].join("\n"),
    { encoding: "utf-8", mode: 0o755 },
  );
  const configPath = path.join(workspace, "agentmesh.toml");
  writeFileSync(
    configPath,
    [
      "schema_version = 1",
      "",
      commandAgentToml("file_agent", fileAgent, ['output_file_arg = "--output-file"']),
      commandAgentToml("stdin_agent", stdinAgent, ["stdin = true"]),
      commandAgentToml("failing_agent", failingAgent),
      commandAgentToml("slow_agent", slowAgent),
      commandAgentToml("missing_agent", path.join(workspace, "missing-agent")),
      "",
    ].join("\n"),
  );

  const fileResult = await runAgentCallAsync({
    configPath,
    agentName: "file_agent",
    outputFile,
  });
  assert.equal(fileResult.exitCode, 0);
  assert.match(readFileSync(outputFile, "utf-8"), /# File Output/);
  assert.equal(fileResult.timing.first_output_ms, undefined);

  const stdinOutput = path.join(workspace, "stdin-output.md");
  const stdinResult = await runAgentCallAsync({
    configPath,
    agentName: "stdin_agent",
    prompt: "hello from stdin",
    outputFile: stdinOutput,
  });
  assert.equal(stdinResult.exitCode, 0);
  assert.match(readFileSync(stdinOutput, "utf-8"), /hello from stdin/);

  const failingResult = await runAgentCallAsync({
    configPath,
    agentName: "failing_agent",
  });
  assert.equal(failingResult.exitCode, 7);
  assert.equal(typeof failingResult.timing.agent_total_ms, "number");

  await assert.rejects(
    () => runAgentCallAsync({ configPath, agentName: "slow_agent", timeoutSecs: 0.05 }),
    (error) =>
      error instanceof AgentCallError
      && /timed out after 0.05s/.test(error.message)
      && typeof error.timing.adapter_spawn_ms === "number",
  );

  await assert.rejects(
    () => runAgentCallAsync({ configPath, agentName: "missing_agent" }),
    (error) =>
      error instanceof AgentCallError
      && /spawn/.test(error.message)
      && typeof error.timing.agent_total_ms === "number",
  );
});

function writeCommandAgentConfig(workspace: string, agentId: string, command: string): string {
  const configPath = path.join(workspace, "agentmesh.toml");
  writeFileSync(
    configPath,
    [
      "schema_version = 1",
      "",
      commandAgentToml(agentId, command),
      "",
    ].join("\n"),
  );
  return configPath;
}

function commandAgentToml(agentId: string, command: string, extraLines: string[] = []): string {
  return [
    `[agents.${agentId}]`,
    `label = ${JSON.stringify(agentId)}`,
    'adapter = "command"',
    `command = ${JSON.stringify(command)}`,
    "args = []",
    'capabilities = ["plan"]',
    ...extraLines,
    "",
  ].join("\n");
}
