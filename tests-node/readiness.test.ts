import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { probeAgentRegistrationReadiness } from "../packages/runtime/src/adapters/registration.js";
import {
  buildDoctorReport,
  probeAgentReadiness,
} from "../packages/runtime/src/doctor/readiness.js";
import {
  agentmeshSkillMarkdown,
  expectedSkillFilesForTarget,
  installSkill,
  verifySkillInstall,
} from "../packages/skills/src/index.js";

const fakeMcpServerPath = fileURLToPath(
  new URL("./fixtures/mcp/fake-server.js", import.meta.url),
);

function makeWorkspace(): string {
  return mkdtempSync(path.join(tmpdir(), "agentmesh-readiness-"));
}

function withHome<T>(home: string, action: () => T): T {
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    return action();
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  }
}

function buildWorkspaceDoctorReport(
  workspace: string,
  configPath: string,
  options: Parameters<typeof buildDoctorReport>[1] & { agents?: string[] },
): ReturnType<typeof buildDoctorReport> {
  return withHome(path.join(workspace, "home"), () =>
    buildDoctorReport(configPath, options),
  );
}

function writeExecutable(filePath: string, content: string): void {
  writeFileSync(filePath, content);
  chmodSync(filePath, 0o755);
}

function sharedProjectSkillPath(workspace: string): string {
  return path.join(workspace, ".agents", "skills", "agentmesh", "SKILL.md");
}

function claudeProjectSkillPath(workspace: string): string {
  return path.join(workspace, ".claude", "skills", "agentmesh", "SKILL.md");
}

function assertSamePath(actual: string, expected: string): void {
  assert.equal(macTmpPath(actual), macTmpPath(expected));
}

function macTmpPath(filePath: string): string {
  return filePath.replace(/^\/private\/var\//, "/var/");
}

function writeCommandConfig(configPath: string, commandPath: string): void {
  writeFileSync(
    configPath,
    [
      "schema_version = 1",
      "",
      "[agents.reviewer]",
      'label = "Fake Reviewer"',
      'adapter = "command"',
      `command = "${commandPath}"`,
      "args = []",
      'capabilities = ["plan", "execute", "review", "decide"]',
      'prompt_file_arg = "--prompt-file"',
      'output_file_arg = "--output-file"',
      "",
    ].join("\n"),
  );
}

function writeCodexConfig(configPath: string, commandPath: string): void {
  writeFileSync(
    configPath,
    [
      "schema_version = 1",
      "",
      "[agents.planner]",
      'label = "Codex 5.5"',
      'adapter = "codex-cli"',
      `command = "${commandPath}"`,
      'model = "gpt-5.5"',
      'reasoning_effort = "high"',
      'capabilities = ["plan", "execute", "review", "decide"]',
      'context_mode = "workspace-aware"',
      "",
    ].join("\n"),
  );
}

test("single agent readiness probe accepts an in-memory candidate agent", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const commandPath = path.join(workspace, "fake-codex");
  const argsFile = path.join(workspace, "args.txt");
  const stdinFile = path.join(workspace, "stdin.txt");
  writeExecutable(
    commandPath,
    [
      "#!/usr/bin/env bash",
      `printf '%s\\n' "$*" >> ${JSON.stringify(argsFile)}`,
      `cat >> ${JSON.stringify(stdinFile)}`,
      "exit 0",
      "",
    ].join("\n"),
  );

  const report = probeAgentReadiness({
    id: "codex-gpt-5-5",
    label: "Codex CLI (gpt-5.5)",
    adapter: "codex-cli",
    command: commandPath,
    args: ["exec"],
    env: [],
    capabilities: ["plan", "execute", "review", "decide"],
    model: "gpt-5.5",
    reasoning_effort: "none",
  }, { probeAuth: true, probeTimeoutSecs: 5 });

  assert.equal(report.ok, true);
  assert.equal(report.id, "codex-gpt-5-5");
  assert.equal(report.classification, "ready");
  assert.equal(report.source_layer, undefined);
  assert.match(readFileSync(argsFile, "utf-8"), /exec -m gpt-5\.5 -/);
  assert.match(readFileSync(stdinFile, "utf-8"), /AgentMesh doctor authentication probe/);
});

test("registration readiness supports skip verify with an explicit warning", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const commandPath = path.join(workspace, "fake-codex");
  writeExecutable(commandPath, "#!/usr/bin/env bash\nexit 0\n");

  const result = probeAgentRegistrationReadiness({
    id: "codex-gpt-5-5",
    label: "Codex CLI (gpt-5.5)",
    adapter: "codex-cli",
    command: commandPath,
    args: ["exec"],
    env: [],
    capabilities: ["plan", "execute", "review", "decide"],
    model: "gpt-5.5",
    reasoning_effort: "none",
  }, { skipVerify: true, probeTimeoutSecs: 1 });

  assert.equal(result.ok, true);
  assert.equal(result.report.auth_probe, "skipped");
  assert.match(result.warnings.join("\n"), /not checked for auth\/model availability/);

  const missing = probeAgentRegistrationReadiness({
    id: "missing",
    label: "Missing",
    adapter: "codex-cli",
    command: path.join(workspace, "missing-codex"),
    args: ["exec"],
    env: [],
    capabilities: ["plan"],
    model: "gpt-5.5",
    reasoning_effort: "none",
  }, { skipVerify: true, probeTimeoutSecs: 1 });
  assert.equal(missing.ok, false);
  assert.equal(missing.classification, "command_not_found");
});

test("registration readiness reports actionable command and model failures", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const missing = probeAgentRegistrationReadiness({
    id: "missing",
    label: "Missing",
    adapter: "command",
    command: path.join(workspace, "missing-agent"),
    args: [],
    env: [],
    capabilities: ["plan"],
    model: "custom",
  }, { probeTimeoutSecs: 1 });
  assert.equal(missing.ok, false);
  assert.equal(missing.classification, "command_not_found");
  assert.match(missing.message, /missing-agent/);

  const modelFailureCommand = path.join(workspace, "fake-model-failure");
  writeExecutable(
    modelFailureCommand,
    [
      "#!/usr/bin/env bash",
      "if [[ \"$1\" == \"--version\" || \"$*\" == *\"--help\"* ]]; then exit 0; fi",
      "printf 'model unavailable: gpt-5.5\\n' >&2",
      "exit 2",
      "",
    ].join("\n"),
  );
  const modelFailure = probeAgentRegistrationReadiness({
    id: "codex-gpt-5-5",
    label: "Codex CLI (gpt-5.5)",
    adapter: "codex-cli",
    command: modelFailureCommand,
    args: ["exec"],
    env: [],
    capabilities: ["plan"],
    model: "gpt-5.5",
    reasoning_effort: "none",
  }, { probeTimeoutSecs: 30 });
  assert.equal(modelFailure.ok, false);
  assert.equal(modelFailure.classification, "model_unavailable");
  assert.match(modelFailure.message, /model unavailable/);
});

test("registration readiness reports auth timeout and help/version failures", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const timeoutCommand = path.join(workspace, "fake-timeout");
  writeExecutable(
    timeoutCommand,
    [
      "#!/usr/bin/env bash",
      "if [[ \"$1\" == \"--version\" || \"$*\" == *\"--help\"* ]]; then exit 0; fi",
      "sleep 2",
      "",
    ].join("\n"),
  );
  const timedOut = probeAgentRegistrationReadiness({
    id: "timeout",
    label: "Timeout",
    adapter: "codex-cli",
    command: timeoutCommand,
    args: ["exec"],
    env: [],
    capabilities: ["plan"],
    model: "gpt-5.5",
    reasoning_effort: "none",
  }, { probeTimeoutSecs: 1 });
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.classification, "auth_timeout");
  assert.match(timedOut.message, /timed out after 1s/);

  const helpFailureCommand = path.join(workspace, "fake-help-failure");
  writeExecutable(
    helpFailureCommand,
    [
      "#!/usr/bin/env bash",
      "if [[ \"$*\" == *\"--help\"* ]]; then exit 2; fi",
      "exit 0",
      "",
    ].join("\n"),
  );
  const helpFailure = probeAgentRegistrationReadiness({
    id: "help-failure",
    label: "Help Failure",
    adapter: "codex-cli",
    command: helpFailureCommand,
    args: ["exec"],
    env: [],
    capabilities: ["plan"],
    model: "gpt-5.5",
    reasoning_effort: "none",
  }, { probeTimeoutSecs: 30 });
  assert.equal(helpFailure.ok, false);
  assert.equal(helpFailure.classification, "help_failed");
  assert.match(helpFailure.message, /--help/);

  const versionFailureCommand = path.join(workspace, "fake-version-failure");
  writeExecutable(
    versionFailureCommand,
    [
      "#!/usr/bin/env bash",
      "if [[ \"$1\" == \"--version\" ]]; then exit 2; fi",
      "exit 0",
      "",
    ].join("\n"),
  );
  const versionFailure = probeAgentRegistrationReadiness({
    id: "version-failure",
    label: "Version Failure",
    adapter: "codex-cli",
    command: versionFailureCommand,
    args: ["exec"],
    env: [],
    capabilities: ["plan"],
    model: "gpt-5.5",
    reasoning_effort: "none",
  }, { probeTimeoutSecs: 5 });
  assert.equal(versionFailure.ok, false);
  assert.equal(versionFailure.classification, "version_failed");
  assert.match(versionFailure.message, /--version/);
});

test("doctor report marks generic command adapters ready with unknown non-interactive state", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const commandPath = path.join(workspace, "fake-agent");
  const configPath = path.join(workspace, "agentmesh.toml");
  writeExecutable(commandPath, "#!/usr/bin/env bash\nexit 0\n");
  writeCommandConfig(configPath, commandPath);

  const report = buildWorkspaceDoctorReport(workspace, configPath, { probeAuth: true });

  assert.equal(report.ok, true);
  assert.equal(report.agents[0].id, "reviewer");
  assert.equal(report.agents[0].status, "command ok (no auth probe)");
  assert.equal(report.agents[0].readiness, "ready");
  assert.equal(report.agents[0].ready, true);
  assert.equal(report.agents[0].classification, "ready");
  assert.equal(report.agents[0].non_interactive, "unknown");
  assert.equal(report.agents[0].help_probe, "not_applicable");
  assert.equal(report.agents[0].version_probe, "not_applicable");
  assert.match(report.agents[0].hints.join("\n"), /Generic command adapters/);
});

test("doctor report can target one agent by id without probing other agents", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const commandPath = path.join(workspace, "fake-agent");
  const configPath = path.join(workspace, "agentmesh.toml");
  writeExecutable(commandPath, "#!/usr/bin/env bash\nexit 0\n");
  writeFileSync(
    configPath,
    [
      "schema_version = 1",
      "",
      "[agents.fast]",
      'label = "Fast Agent"',
      'adapter = "command"',
      `command = "${commandPath}"`,
      "",
      "[agents.broken]",
      'label = "Broken Agent"',
      'adapter = "command"',
      `command = "${path.join(workspace, "missing-agent")}"`,
      "",
    ].join("\n"),
  );

  const report = buildWorkspaceDoctorReport(workspace, configPath, {
    probeAuth: true,
    agents: ["fast"],
  });

  assert.equal(report.ok, true);
  assert.deepEqual(report.agents.map((agent) => agent.id), ["fast"]);
});

test("doctor report probes AI CLI help, version, and auth readiness", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const commandPath = path.join(workspace, "fake-ai-cli");
  const argsFile = path.join(workspace, "args.txt");
  const stdinFile = path.join(workspace, "stdin.txt");
  const configPath = path.join(workspace, "agentmesh.toml");
  writeExecutable(
    commandPath,
    [
      "#!/usr/bin/env bash",
      `printf '%s\\n' "$*" >> ${JSON.stringify(argsFile)}`,
      `cat >> ${JSON.stringify(stdinFile)}`,
      "printf 'ok\\n'",
      "exit 0",
      "",
    ].join("\n"),
  );
  writeCodexConfig(configPath, commandPath);

  const report = buildWorkspaceDoctorReport(workspace, configPath, { probeAuth: true });

  assert.equal(report.ok, true);
  assert.equal(report.agents[0].status, "ok");
  assert.equal(report.agents[0].readiness, "ready");
  assert.equal(report.agents[0].non_interactive, "ready");
  assert.equal(report.agents[0].auth_probe, "passed");
  assert.equal(report.agents[0].classification, "ready");
  assert.equal(report.agents[0].help_probe, "ok");
  assert.equal(report.agents[0].version_probe, "ok");
});

test("doctor help and version probes report malformed agent env", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const commandPath = path.join(workspace, "fake-ai-cli");
  const configPath = path.join(workspace, "agentmesh.toml");
  writeExecutable(commandPath, "#!/usr/bin/env bash\nexit 0\n");
  writeFileSync(
    configPath,
    [
      "schema_version = 1",
      "",
      "[agents.planner]",
      'adapter = "codex-cli"',
      `command = "${commandPath}"`,
      'model = "gpt-5.5"',
      'env = ["MISSING_EQUALS"]',
      "",
    ].join("\n"),
  );

  const report = buildWorkspaceDoctorReport(workspace, configPath, { probeAuth: true });

  assert.match(
    report.agents[0].status,
    /^auth probe failed \(agent planner: env entries must be KEY=value strings/,
  );
  assert.match(
    report.agents[0].help_probe,
    /^not_run \(agent planner: env entries must be KEY=value strings/,
  );
  assert.match(
    report.agents[0].version_probe,
    /^not_run \(agent planner: env entries must be KEY=value strings/,
  );
});

test("doctor readiness normalizes adapter aliases through shared invocation preparation", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const commandPath = path.join(workspace, "fake-antigravity-cli");
  const logFile = path.join(workspace, "probe.log");
  const stdinFile = path.join(workspace, "stdin.tmp");
  const configPath = path.join(workspace, "agentmesh.toml");
  writeExecutable(
    commandPath,
    [
      "#!/usr/bin/env bash",
      `printf 'ARGS:%s\\n' "$*" >> ${JSON.stringify(logFile)}`,
      `cat > ${JSON.stringify(stdinFile)}`,
      `if [[ -s ${JSON.stringify(stdinFile)} ]]; then printf 'STDIN:%s\\n' "$(cat ${JSON.stringify(stdinFile)})" >> ${JSON.stringify(logFile)}; fi`,
      "printf 'OK\\n'",
      "exit 0",
      "",
    ].join("\n"),
  );
  writeFileSync(
    configPath,
    [
      "schema_version = 1",
      "",
      "[agents.antigravity]",
      'adapter = "antigravity"',
      `command = "${commandPath}"`,
      'model = "gemini-2.5-pro"',
      "",
    ].join("\n"),
  );

  const report = buildWorkspaceDoctorReport(workspace, configPath, { probeAuth: true });

  assert.equal(report.ok, true);
  assert.equal(report.agents[0].adapter, "antigravity-cli");
  const log = readFileSync(logFile, "utf-8");
  assert.match(
    log,
    /ARGS:-p AgentMesh doctor authentication probe\. Reply with OK\./,
  );
  assert.doesNotMatch(log, /-m gemini-2\.5-pro/);
  assert.doesNotMatch(log, /STDIN:/);
});

test("doctor readiness rejects empty Antigravity print responses", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const commandPath = path.join(workspace, "fake-antigravity-cli");
  writeExecutable(
    commandPath,
    [
      "#!/usr/bin/env bash",
      "if [[ \"$1\" == \"--version\" || \"$*\" == *\"--help\"* ]]; then exit 0; fi",
      "exit 0",
      "",
    ].join("\n"),
  );

  const report = probeAgentReadiness({
    id: "antigravity-empty",
    label: "Antigravity Empty",
    adapter: "antigravity-cli",
    command: commandPath,
    args: [],
    env: [],
    capabilities: ["plan"],
    model: "gemini-2.5-flash",
    reasoning_effort: "none",
  }, { probeAuth: true, probeTimeoutSecs: 5 });

  assert.equal(report.ok, false);
  assert.equal(report.classification, "auth_failed");
  assert.match(report.status, /empty response/);
  assert.equal(report.auth_probe, "failed");
  assert.equal(report.non_interactive, "not_ready");
});

test("doctor readiness uses shared adapter registry and invocation preparation", () => {
  const source = readFileSync(
    path.join(process.cwd(), "packages", "runtime", "src", "doctor", "readiness.ts"),
    "utf-8",
  );

  assert.doesNotMatch(source, /function adapterDefaults/);
  assert.doesNotMatch(source, /function modelArgs/);
  assert.match(source, /normalizeAgents/);
  assert.match(source, /prepareAdapterInvocation/);
});

test("doctor report keeps skipped AI auth probes unknown", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const commandPath = path.join(workspace, "fake-ai-cli");
  const configPath = path.join(workspace, "agentmesh.toml");
  writeExecutable(commandPath, "#!/usr/bin/env bash\nexit 0\n");
  writeCodexConfig(configPath, commandPath);

  const report = buildWorkspaceDoctorReport(workspace, configPath, { probeAuth: false });

  assert.equal(report.ok, true);
  assert.equal(report.probe_auth, false);
  assert.equal(report.agents[0].status, "command ok (auth not checked)");
  assert.equal(report.agents[0].readiness, "unknown");
  assert.equal(report.agents[0].ready, null);
  assert.equal(report.agents[0].auth_probe, "skipped");
  assert.equal(report.agents[0].non_interactive, "unknown");
  assert.equal(report.agents[0].classification, "unknown");
});

test("doctor report classifies missing commands with remediation hints", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const configPath = path.join(workspace, "agentmesh.toml");
  writeCommandConfig(configPath, path.join(workspace, "missing-agent"));

  const report = buildWorkspaceDoctorReport(workspace, configPath, { probeAuth: true });

  assert.equal(report.ok, false);
  assert.equal(report.agents[0].readiness, "not_ready");
  assert.equal(report.agents[0].classification, "command_not_found");
  assert.match(report.agents[0].hints.join("\n"), /Install the command CLI|Install the command/);
});

test("doctor provider discovery finds GUI-launched provider tools outside PATH", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const home = path.join(workspace, "home");
  const binDir = path.join(home, ".local", "bin");
  mkdirSync(binDir, { recursive: true });
  const providerPath = path.join(binDir, "codex");
  writeExecutable(providerPath, "#!/usr/bin/env bash\nexit 0\n");
  const previousPath = process.env.PATH;
  process.env.PATH = "";
  try {
    const report = probeAgentReadiness({
      id: "codex-gpt-5-5",
      label: "Codex CLI (gpt-5.5)",
      adapter: "codex-cli",
      command: "codex",
      args: ["exec"],
      env: [],
      capabilities: ["plan"],
      model: "gpt-5.5",
      reasoning_effort: "none",
    }, {
      probeAuth: false,
      providerToolDiscovery: {
        enabled: true,
        homeDir: home,
        workspace,
      },
    });

    assert.equal(report.ok, true);
    assert.equal(report.command, providerPath);
    assert.equal(report.provider_tool_source, "well_known");
    assert.match(report.provider_tool_diagnostics.join("\n"), /well-known/);
  } finally {
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
  }
});

test("doctor provider discovery rejects unsafe login-shell probe output", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const home = path.join(workspace, "home");
  const emptyWellKnownDir = path.join(workspace, "empty-bin");
  mkdirSync(home, { recursive: true });
  mkdirSync(emptyWellKnownDir, { recursive: true });
  const shellPath = path.join(workspace, "fake-shell");
  writeExecutable(
    shellPath,
    "#!/usr/bin/env bash\nprintf '%s\\n' \"$FAKE_PROVIDER_OUTPUT\"\n",
  );
  const workspaceLocalProvider = path.join(workspace, "codex");
  writeExecutable(workspaceLocalProvider, "#!/usr/bin/env bash\nexit 0\n");
  const unsafeOutputs = [
    ["alias output", "codex: aliased to /opt/homebrew/bin/codex", /absolute executable path/],
    ["relative output", "./codex", /absolute executable path/],
    ["multi-line output", "/opt/homebrew/bin/codex\n/usr/local/bin/codex", /single path/],
    ["workspace-local output", workspaceLocalProvider, /inside the current workspace/],
  ] as const;
  for (const [label, output, diagnostic] of unsafeOutputs) {
    const report = probeAgentReadiness({
      id: `codex-${label.replace(/[^a-z]+/g, "-")}`,
      label,
      adapter: "codex-cli",
      command: "codex",
      args: ["exec"],
      env: [],
      capabilities: ["plan"],
      model: "gpt-5.5",
      reasoning_effort: "none",
    }, {
      probeAuth: false,
      providerToolDiscovery: {
        enabled: true,
        homeDir: home,
        wellKnownPaths: [emptyWellKnownDir],
        workspace,
        shellPath,
        shellEnv: { FAKE_PROVIDER_OUTPUT: output },
      },
    });

    assert.equal(report.classification, "command_not_found", label);
    assert.equal(report.provider_tool_source, "missing", label);
    assert.match(report.provider_tool_diagnostics.join("\n"), diagnostic, label);
  }
});

test("doctor config preserves commas inside quoted array strings", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const commandPath = path.join(workspace, "fake-ai-cli");
  const argsFile = path.join(workspace, "args.txt");
  const configPath = path.join(workspace, "agentmesh.toml");
  writeExecutable(
    commandPath,
    [
      "#!/usr/bin/env bash",
      `printf '%s\\n' "$@" >> ${JSON.stringify(argsFile)}`,
      "cat >/dev/null",
      "exit 0",
      "",
    ].join("\n"),
  );
  writeFileSync(
    configPath,
    [
      "schema_version = 1",
      "",
      "[agents.planner]",
      'label = "Codex 5.5"',
      'adapter = "codex-cli"',
      `command = "${commandPath}"`,
      'model = "gpt-5.5"',
      'args = ["--tag", "hello, world"]',
      "",
    ].join("\n"),
  );

  const report = buildWorkspaceDoctorReport(workspace, configPath, { probeAuth: true });

  assert.equal(report.ok, true);
  const args = readFileSync(argsFile, { encoding: "utf-8" }).split(/\r?\n/);
  assert.ok(args.includes("--tag"));
  assert.ok(args.includes("hello, world"));
});

test("doctor uses configured adapter args without duplicating defaults", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const commandPath = path.join(workspace, "fake-ai-cli");
  const argsFile = path.join(workspace, "args.txt");
  const configPath = path.join(workspace, "agentmesh.toml");
  writeExecutable(
    commandPath,
    [
      "#!/usr/bin/env bash",
      `printf '%s\\n' "$@" >> ${JSON.stringify(argsFile)}`,
      "cat >/dev/null",
      "exit 0",
      "",
    ].join("\n"),
  );
  writeFileSync(
    configPath,
    [
      "schema_version = 1",
      "",
      "[agents.planner]",
      'label = "Codex 5.5"',
      'adapter = "codex-cli"',
      `command = "${commandPath}"`,
      'args = ["exec"]',
      'model = "gpt-5.5"',
      "",
    ].join("\n"),
  );

  const report = buildWorkspaceDoctorReport(workspace, configPath, { probeAuth: true });

  assert.equal(report.ok, true);
  const args = readFileSync(argsFile, { encoding: "utf-8" }).trim().split(/\s+/);
  assert.equal(args.filter((arg) => arg === "exec").length, 2);
});

test("doctor config rejects malformed TOML lines", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const configPath = path.join(workspace, "agentmesh.toml");
  writeFileSync(
    configPath,
    [
      "schema_version = 1",
      "",
      "[agents.planner]",
      'label = "Codex 5.5"',
      "this is not valid TOML",
      "",
    ].join("\n"),
  );

  assert.throws(
    () => buildWorkspaceDoctorReport(workspace, configPath, { probeAuth: false }),
    /invalid agentmesh TOML/,
  );
});

test("doctor config accepts inline comments outside quoted values", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const commandPath = path.join(workspace, "fake-ai-cli");
  const argsFile = path.join(workspace, "args.txt");
  const configPath = path.join(workspace, "agentmesh.toml");
  writeExecutable(
    commandPath,
    [
      "#!/usr/bin/env bash",
      `printf '%s\\n' "$@" >> ${JSON.stringify(argsFile)}`,
      "cat >/dev/null",
      "exit 0",
      "",
    ].join("\n"),
  );
  writeFileSync(
    configPath,
    [
      "schema_version = 1 # root schema",
      "",
      "[agents.planner]",
      'label = "Codex # Planner" # inline comment',
      'adapter = "codex-cli"',
      `command = "${commandPath}"`,
      'model = "gpt-5.5" # model comment',
      'args = ["--tag", "hello # world"] # array comment',
      "",
    ].join("\n"),
  );

  const report = buildWorkspaceDoctorReport(workspace, configPath, { probeAuth: true });

  assert.equal(report.ok, true);
  assert.equal(report.agents[0].label, "Codex # Planner");
  const args = readFileSync(argsFile, { encoding: "utf-8" }).split(/\r?\n/);
  assert.ok(args.includes("hello # world"));
});

test("doctor config accepts multi-line arrays", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const commandPath = path.join(workspace, "fake-ai-cli");
  const argsFile = path.join(workspace, "args.txt");
  const configPath = path.join(workspace, "agentmesh.toml");
  writeExecutable(
    commandPath,
    [
      "#!/usr/bin/env bash",
      `printf '%s\\n' "$@" >> ${JSON.stringify(argsFile)}`,
      "cat >/dev/null",
      "exit 0",
      "",
    ].join("\n"),
  );
  writeFileSync(
    configPath,
    [
      "schema_version = 1",
      "",
      "[agents.planner]",
      'label = "Codex 5.5"',
      'adapter = "codex-cli"',
      `command = "${commandPath}"`,
      'model = "gpt-5.5"',
      "args = [",
      '  "--tag",',
      '  "multi line",',
      "]",
      "",
    ].join("\n"),
  );

  const report = buildWorkspaceDoctorReport(workspace, configPath, { probeAuth: true });

  assert.equal(report.ok, true);
  assert.deepEqual(report.agents[0].id, "planner");
  const args = readFileSync(argsFile, { encoding: "utf-8" }).split(/\r?\n/);
  assert.ok(args.includes("--tag"));
  assert.ok(args.includes("multi line"));
});

test("doctor resolves PATH commands through PATHEXT entries", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const binDir = path.join(workspace, "bin");
  mkdirSync(binDir, { recursive: true });
  const configPath = path.join(workspace, "agentmesh.toml");
  writeExecutable(path.join(binDir, "gemini.CMD"), "#!/usr/bin/env bash\nexit 0\n");
  writeCommandConfig(configPath, "gemini");
  const previousPath = process.env.PATH;
  const previousPathext = process.env.PATHEXT;
  process.env.PATH = binDir;
  process.env.PATHEXT = ".CMD;.EXE";
  try {
    const report = buildWorkspaceDoctorReport(workspace, configPath, { probeAuth: true });

    assert.equal(report.ok, true);
    assert.equal(report.agents[0].readiness, "ready");
  } finally {
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
    if (previousPathext === undefined) {
      delete process.env.PATHEXT;
    } else {
      process.env.PATHEXT = previousPathext;
    }
  }
});

test("doctor treats backslash commands as direct relative paths", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const binDir = path.join(workspace, "bin");
  mkdirSync(binDir, { recursive: true });
  writeExecutable(path.join(binDir, "fake-agent.cmd"), "#!/usr/bin/env bash\nexit 0\n");
  const configPath = path.join(workspace, "agentmesh.toml");
  writeFileSync(
    configPath,
    [
      "schema_version = 1",
      "",
      "[agents.reviewer]",
      'label = "Fake Reviewer"',
      'adapter = "command"',
      "command = '.\\bin\\fake-agent.cmd'",
      "",
    ].join("\n"),
  );
  const previousCwd = process.cwd();
  process.chdir(workspace);
  try {
    const report = buildWorkspaceDoctorReport(workspace, configPath, { probeAuth: true });

    assert.equal(report.ok, true);
    assert.equal(report.agents[0].readiness, "ready");
  } finally {
    process.chdir(previousCwd);
  }
});

test("skill verify reports missing, mismatch, and ok install states", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const home = path.join(workspace, "home");
  const expectedSkill = "# AgentMesh Skill\n";

  const missing = verifySkillInstall("claude", {
    homeDir: home,
    expectedSkill,
    cwd: workspace,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.files[0].status, "missing");
  assert.equal(missing.files[0].classification, "missing");
  assert.match(missing.files[0].hint ?? "", /skill install/);

  const installPath = claudeProjectSkillPath(workspace);
  mkdirSync(path.dirname(installPath), { recursive: true });
  writeFileSync(installPath, "custom\n");
  const mismatch = verifySkillInstall("claude", {
    homeDir: home,
    expectedSkill,
    cwd: workspace,
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.files[0].status, "content_mismatch");
  assert.equal(mismatch.files[0].classification, "content_mismatch");

  writeFileSync(installPath, expectedSkill);
  const ok = verifySkillInstall("claude", {
    homeDir: home,
    expectedSkill,
    cwd: workspace,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.files[0].status, "ok");
  assert.equal(ok.files[0].classification, "ok");
});

test("skill target matrix uses shared project path with Claude project exception", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const home = path.join(workspace, "home");
  const expectedSkill = "# AgentMesh Skill\n";
  const sharedTargets = ["codex", "cursor", "antigravity", "opencode", "copilot"] as const;

  for (const target of sharedTargets) {
    rmSync(path.join(workspace, ".agents"), { recursive: true, force: true });
    const report = installSkill(target, {
      homeDir: home,
      cwd: workspace,
      expectedSkill,
      force: true,
    });
    assert.equal(report.ok, true, target);
    assert.equal(report.files[0].path, sharedProjectSkillPath(workspace), target);
    assert.equal(readFileSync(sharedProjectSkillPath(workspace), "utf-8"), expectedSkill, target);
    assert.equal(existsSync(path.join(home, ".codex-custom", "skills", "agentmesh", "SKILL.md")), false, target);
    assert.equal(existsSync(path.join(workspace, ".cursor", "rules", "agentmesh.mdc")), false, target);
    assert.equal(existsSync(path.join(home, ".antigravity", "extensions", "agentmesh", "SKILL.md")), false, target);
    assert.equal(existsSync(path.join(home, ".copilot", "skills", "agentmesh", "SKILL.md")), false, target);
  }

  const claude = installSkill("claude", {
    homeDir: home,
    cwd: workspace,
    expectedSkill,
    force: true,
  });
  assert.equal(claude.ok, true);
  assert.equal(claude.files[0].path, claudeProjectSkillPath(workspace));
  assert.equal(readFileSync(claudeProjectSkillPath(workspace), "utf-8"), expectedSkill);
  assert.equal(existsSync(path.join(home, ".claude", "skills", "agentmesh", "SKILL.md")), false);
});

test("skill expected files contract exposes target paths without host home fallbacks", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const home = path.join(workspace, "home");
  const sharedTargets = ["codex", "cursor", "antigravity", "opencode", "copilot"] as const;

  for (const target of sharedTargets) {
    const files = expectedSkillFilesForTarget(target, { cwd: workspace, homeDir: home });
    assert.deepEqual(files, [
      {
        path: sharedProjectSkillPath(workspace),
        target,
        expected: true,
      },
    ]);
  }

  assert.deepEqual(expectedSkillFilesForTarget("claude", { cwd: workspace, homeDir: home }), [
    {
      path: claudeProjectSkillPath(workspace),
      target: "claude",
      expected: true,
    },
  ]);
});

test("skill verify reports legacy Cursor rule files without treating them as the target install", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const expectedSkill = "# AgentMesh Skill\n";
  const legacyPath = path.join(workspace, ".cursor", "rules", "agentmesh.mdc");
  mkdirSync(path.dirname(legacyPath), { recursive: true });
  writeFileSync(legacyPath, "legacy cursor rule\n");

  const report = verifySkillInstall("cursor", {
    cwd: workspace,
    expectedSkill,
  });

  assert.equal(report.ok, false);
  assert.equal(report.files[0].path, sharedProjectSkillPath(workspace));
  assert.equal(report.files[0].classification, "missing");
  assert.equal(report.files[1].path, legacyPath);
  assert.equal(report.files[1].expected, false);
  assert.equal(report.files[1].classification, "legacy_only");
  assert.match(report.files[1].hint ?? "", /legacy Cursor/);
});

test("skill install --force refreshes target file without deleting legacy Cursor rule", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const home = path.join(workspace, "home");
  const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.js", import.meta.url));
  const sharedPath = sharedProjectSkillPath(workspace);
  const legacyPath = path.join(workspace, ".cursor", "rules", "agentmesh.mdc");
  mkdirSync(path.dirname(sharedPath), { recursive: true });
  mkdirSync(path.dirname(legacyPath), { recursive: true });
  writeFileSync(sharedPath, "stale skill\n");
  writeFileSync(legacyPath, "legacy cursor rule\n");

  const installResult = spawnSync(
    process.execPath,
    [cliPath, "skill", "install", "--target", "cursor", "--force"],
    { cwd: workspace, env: { ...process.env, HOME: home }, encoding: "utf-8" },
  );
  assert.equal(installResult.status, 0, installResult.stderr);
  assert.doesNotMatch(installResult.stdout, /legacy_only/);
  assert.doesNotMatch(installResult.stdout, /\.cursor\/rules\/agentmesh\.mdc/);

  const installedSkill = readFileSync(sharedPath, "utf-8");
  assert.match(installedSkill, /^---\nname: agentmesh\n/);
  assert.equal(existsSync(legacyPath), true);

  const verifyResult = spawnSync(
    process.execPath,
    [cliPath, "skill", "verify", "--target", "cursor", "--json"],
    { cwd: workspace, env: { ...process.env, HOME: home }, encoding: "utf-8" },
  );
  assert.equal(verifyResult.status, 0, verifyResult.stderr);
  const payload = JSON.parse(verifyResult.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.files[0].classification, "ok");
  assert.equal(payload.files[1].classification, "legacy_only");
  assert.equal(existsSync(legacyPath), true);
});

test("doctor and skill verify CLI emit JSON readiness reports", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const commandPath = path.join(workspace, "fake-agent");
  const configPath = path.join(workspace, "agentmesh.toml");
  writeExecutable(commandPath, "#!/usr/bin/env bash\nexit 0\n");
  writeCommandConfig(configPath, commandPath);
  const home = path.join(workspace, "home");

  const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.js", import.meta.url));
  const doctorResult = spawnSync(
    process.execPath,
    [cliPath, "--config", configPath, "doctor", "--json"],
    { cwd: workspace, env: { ...process.env, HOME: home }, encoding: "utf-8" },
  );
  assert.equal(doctorResult.status, 0, doctorResult.stderr);
  const doctorPayload = JSON.parse(doctorResult.stdout);
  assert.equal(doctorPayload.agents[0].readiness, "ready");
  assert.equal(doctorPayload.agents[0].source_layer, "explicit");
  assert.equal(doctorPayload.config_layers[0].source, "explicit");

  const skillResult = spawnSync(
    process.execPath,
    [cliPath, "skill", "verify", "--target", "claude", "--json"],
    { cwd: workspace, env: { ...process.env, HOME: home }, encoding: "utf-8" },
  );
  assert.equal(skillResult.status, 1);
  const payload = JSON.parse(skillResult.stdout);
  assert.equal(payload.target, "claude");
  assert.equal(payload.files[0].status, "missing");
  assert.equal(payload.files[0].classification, "missing");
});

test("skill export only accepts the markdown format", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const home = path.join(workspace, "home");
  const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.js", import.meta.url));
  const env = { ...process.env, HOME: home };

  const defaultExport = spawnSync(
    process.execPath,
    [cliPath, "skill", "export"],
    { cwd: workspace, env, encoding: "utf-8" },
  );
  assert.equal(defaultExport.status, 0, defaultExport.stderr);
  assert.match(defaultExport.stdout, /^---\nname: agentmesh/m);

  const markdownExport = spawnSync(
    process.execPath,
    [cliPath, "skill", "export", "--format", "markdown"],
    { cwd: workspace, env, encoding: "utf-8" },
  );
  assert.equal(markdownExport.status, 0, markdownExport.stderr);
  assert.equal(markdownExport.stdout, defaultExport.stdout);

  const badFormat = spawnSync(
    process.execPath,
    [cliPath, "skill", "export", "--format", "json"],
    { cwd: workspace, env, encoding: "utf-8" },
  );
  assert.equal(badFormat.status, 2);
  assert.match(badFormat.stderr, /usage: agentmesh skill export \[--format markdown\]/);

  const showWithFormat = spawnSync(
    process.execPath,
    [cliPath, "skill", "show", "--format", "markdown"],
    { cwd: workspace, env, encoding: "utf-8" },
  );
  assert.equal(showWithFormat.status, 2);
  assert.match(showWithFormat.stderr, /usage: agentmesh skill show/);
});

test("doctor CLI --agent emits a JSON readiness report for only that agent", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const commandPath = path.join(workspace, "fake-agent");
  const configPath = path.join(workspace, "agentmesh.toml");
  writeExecutable(commandPath, "#!/usr/bin/env bash\nexit 0\n");
  writeFileSync(
    configPath,
    [
      "schema_version = 1",
      "",
      "[agents.fast]",
      'label = "Fast Agent"',
      'adapter = "command"',
      `command = "${commandPath}"`,
      "",
      "[agents.broken]",
      'label = "Broken Agent"',
      'adapter = "command"',
      `command = "${path.join(workspace, "missing-agent")}"`,
      "",
    ].join("\n"),
  );
  const home = path.join(workspace, "home");

  const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.js", import.meta.url));
  const result = spawnSync(
    process.execPath,
    [cliPath, "--config", configPath, "doctor", "--agent", "fast", "--json"],
    { cwd: workspace, env: { ...process.env, HOME: home }, encoding: "utf-8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.agents.map((agent: { id: string }) => agent.id), ["fast"]);
});

test("doctor CLI reports user config layer for default agent registry", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const home = path.join(workspace, "home");
  const commandPath = path.join(workspace, "fake-agent");
  const configPath = path.join(home, ".config", "agentmesh", "config.toml");
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeExecutable(commandPath, "#!/usr/bin/env bash\nexit 0\n");
  writeCommandConfig(configPath, commandPath);

  const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.js", import.meta.url));
  const result = spawnSync(
    process.execPath,
    [cliPath, "doctor", "--skip-auth-probe", "--json"],
    { cwd: workspace, env: { ...process.env, HOME: home }, encoding: "utf-8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.config_layers[0].source, "user");
  assert.equal(payload.agents[0].source_layer, "user");
  assert.match(payload.agents[0].source_path, /\.config\/agentmesh\/config\.toml$/);
});

test("doctor CLI emits actionable config layer diagnostics as JSON", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const home = path.join(workspace, "home");
  const configPath = path.join(workspace, "bad.toml");
  writeFileSync(configPath, "schema_version = 1\n\n[agents.bad]\nnot valid\n");

  const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.js", import.meta.url));
  const result = spawnSync(
    process.execPath,
    [cliPath, "--config", configPath, "doctor", "--json"],
    { cwd: workspace, env: { ...process.env, HOME: home }, encoding: "utf-8" },
  );
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.diagnostics[0].classification, "malformed_config_layer");
  assert.match(payload.diagnostics[0].hint, /TOML syntax/);
});

test("doctor CLI reports duplicate workflow registry diagnostics", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const home = path.join(workspace, "home");
  const commandPath = path.join(workspace, "fake-agent");
  const configPath = path.join(workspace, "agentmesh.toml");
  const workflowDir = path.join(home, ".config", "agentmesh", "workflows");
  mkdirSync(workflowDir, { recursive: true });
  writeExecutable(commandPath, "#!/usr/bin/env bash\nexit 0\n");
  writeCommandConfig(configPath, commandPath);
  writeFileSync(
    path.join(workflowDir, "w-7db15660.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'stages = ["plan"]',
      'description = "Duplicate built-in workflow."',
      'when_to_use = ["Never."]',
      'packet_artifacts = ["plan.md"]',
      'quality_gates = ["None."]',
      "",
    ].join("\n"),
  );

  const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.js", import.meta.url));
  const result = spawnSync(
    process.execPath,
    [cliPath, "--config", configPath, "doctor", "--skip-auth-probe", "--json"],
    { cwd: workspace, env: { ...process.env, HOME: home }, encoding: "utf-8" },
  );
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.diagnostics[0].classification, "workflow_registry_error");
  assert.match(payload.diagnostics[0].message, /duplicate workflow id 'w-7db15660'/);
});

test("doctor CLI reports MCP server diagnostics", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const home = path.join(workspace, "home");
  const configPath = path.join(workspace, "agentmesh.toml");
  writeFileSync(
    configPath,
    [
      "schema_version = 1",
      "",
      "[mcp_servers.missing]",
      `command = "${path.join(workspace, "missing-mcp")}"`,
      "",
      "[mcp_servers.list_fails]",
      `command = "${process.execPath}"`,
      `args = ${JSON.stringify([fakeMcpServerPath, "--list-error"])}`,
      "",
    ].join("\n"),
  );

  const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.js", import.meta.url));
  const result = spawnSync(
    process.execPath,
    [cliPath, "--config", configPath, "doctor", "--skip-auth-probe", "--json"],
    { cwd: workspace, env: { ...process.env, HOME: home }, encoding: "utf-8" },
  );

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.deepEqual(
    payload.diagnostics.map((diagnostic: { classification: string }) => diagnostic.classification).sort(),
    ["mcp_command_missing", "mcp_resource_list_failed"],
  );
  assert.match(
    payload.diagnostics.map((diagnostic: { message: string }) => diagnostic.message).join("\n"),
    /missing.*missing-mcp|list_fails.*List failed/s,
  );
});

test("skill install writes host files and verify reports ok", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const home = path.join(workspace, "home");
  const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.js", import.meta.url));

  const installResult = spawnSync(
    process.execPath,
    [cliPath, "skill", "install", "--target", "claude"],
    { cwd: workspace, env: { ...process.env, HOME: home }, encoding: "utf-8" },
  );
  assert.equal(installResult.status, 0, installResult.stderr);

  const verifyResult = spawnSync(
    process.execPath,
    [cliPath, "skill", "verify", "--target", "claude", "--json"],
    { cwd: workspace, env: { ...process.env, HOME: home }, encoding: "utf-8" },
  );
  assert.equal(verifyResult.status, 0, verifyResult.stderr);
  const payload = JSON.parse(verifyResult.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.files[0].classification, "ok");
  assertSamePath(payload.files[0].path, claudeProjectSkillPath(workspace));
  assert.equal(existsSync(claudeProjectSkillPath(workspace)), true);
  assert.equal(existsSync(path.join(home, ".claude", "skills", "agentmesh", "SKILL.md")), false);
});

test("skill install writes shared project SKILL.md for Codex-compatible hosts", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const home = path.join(workspace, "home");
  const codexHome = path.join(home, ".codex-custom");
  const env = { ...process.env, CODEX_HOME: codexHome, HOME: home };
  const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.js", import.meta.url));

  const installResult = spawnSync(
    process.execPath,
    [cliPath, "skill", "install", "--target", "codex"],
    { cwd: workspace, env, encoding: "utf-8" },
  );
  assert.equal(installResult.status, 0, installResult.stderr);

  const installedSkill = readFileSync(
    sharedProjectSkillPath(workspace),
    "utf-8",
  );
  assert.match(
    installedSkill,
    /^---\nname: agentmesh\ndescription: Use AgentMesh CLI orchestration from entry agents\.\n---\n\n# AgentMesh Skill\n\n<!-- agentmesh-skill-version-metadata:start -->/,
  );

  const verifyResult = spawnSync(
    process.execPath,
    [cliPath, "skill", "verify", "--target", "codex", "--json"],
    { cwd: workspace, env, encoding: "utf-8" },
  );
  assert.equal(verifyResult.status, 0, verifyResult.stderr);
  const payload = JSON.parse(verifyResult.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.files[0].classification, "ok");
  assertSamePath(payload.files[0].path, sharedProjectSkillPath(workspace));
  assert.equal(existsSync(path.join(codexHome, "skills", "agentmesh", "SKILL.md")), false);
});

test("skill install and verify accept opencode as a shared project target", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const home = path.join(workspace, "home");
  const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.js", import.meta.url));
  const env = { ...process.env, HOME: home };

  const installResult = spawnSync(
    process.execPath,
    [cliPath, "skill", "install", "--target", "opencode"],
    { cwd: workspace, env, encoding: "utf-8" },
  );
  assert.equal(installResult.status, 0, installResult.stderr);
  assert.ok(macTmpPath(installResult.stdout).includes(sharedProjectSkillPath(workspace)));

  const verifyResult = spawnSync(
    process.execPath,
    [cliPath, "skill", "verify", "--target", "opencode", "--json"],
    { cwd: workspace, env, encoding: "utf-8" },
  );
  assert.equal(verifyResult.status, 0, verifyResult.stderr);
  const payload = JSON.parse(verifyResult.stdout);
  assert.equal(payload.target, "opencode");
  assert.equal(payload.ok, true);
  assertSamePath(payload.files[0].path, sharedProjectSkillPath(workspace));
});

test("skill output declares AgentMesh protocol version metadata", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const home = path.join(workspace, "home");
  const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.js", import.meta.url));

  const markdown = agentmeshSkillMarkdown();
  for (const expected of [
    "## Version Metadata",
    "AgentMesh CLI version: 0.1.0",
    "Packet schema version: 1",
    "Workflow recipe schema version: 1",
    "skill install --target opencode",
    ".agents/skills/agentmesh/SKILL.md",
    ".claude/skills/agentmesh/SKILL.md",
    "legacy Cursor rule",
    "do not provide an `agent-id`",
    "short internal id",
  ]) {
    assert.match(markdown, new RegExp(expected.replace(".", "\\.")));
  }
  assert.doesNotMatch(markdown, /agents add executor/);
  assert.doesNotMatch(markdown, /agents add reviewer/);
  assert.doesNotMatch(markdown, /CODEX_HOME\/skills/);
  assert.doesNotMatch(markdown, /\.cursor\/rules\/agentmesh\.mdc.*Current install targets/s);

  const showResult = spawnSync(process.execPath, [cliPath, "skill", "show"], {
    cwd: workspace,
    encoding: "utf-8",
  });
  assert.equal(showResult.status, 0, showResult.stderr);
  assert.match(showResult.stdout, /AgentMesh CLI version: 0\.1\.0/);
  assert.match(showResult.stdout, /Packet schema version: 1/);
  assert.match(showResult.stdout, /Workflow recipe schema version: 1/);

  const exportResult = spawnSync(
    process.execPath,
    [cliPath, "skill", "export", "--format", "markdown"],
    { cwd: workspace, encoding: "utf-8" },
  );
  assert.equal(exportResult.status, 0, exportResult.stderr);
  assert.match(exportResult.stdout, /AgentMesh CLI version: 0\.1\.0/);
  assert.match(exportResult.stdout, /Packet schema version: 1/);
  assert.match(exportResult.stdout, /Workflow recipe schema version: 1/);

  const installResult = spawnSync(
    process.execPath,
    [cliPath, "skill", "install", "--target", "claude"],
    { cwd: workspace, env: { ...process.env, HOME: home }, encoding: "utf-8" },
  );
  assert.equal(installResult.status, 0, installResult.stderr);
  const installedSkill = readFileSync(
    claudeProjectSkillPath(workspace),
    "utf-8",
  );
  assert.match(installedSkill, /AgentMesh CLI version: 0\.1\.0/);
  assert.match(installedSkill, /Packet schema version: 1/);
  assert.match(installedSkill, /Workflow recipe schema version: 1/);
});

test("skill output is loadable by hosts that require YAML frontmatter", () => {
  const markdown = agentmeshSkillMarkdown();

  assert.match(
    markdown,
    /^---\nname: agentmesh\ndescription: Use AgentMesh CLI orchestration from entry agents\.\n---\n\n# AgentMesh Skill\n\n<!-- agentmesh-skill-version-metadata:start -->/,
  );
});

test("doctor CLI rejects invalid probe timeout values", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const home = path.join(workspace, "home");

  const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.js", import.meta.url));
  const result = spawnSync(
    process.execPath,
    [cliPath, "doctor", "--probe-timeout-secs", "abc", "--json"],
    { cwd: workspace, env: { ...process.env, HOME: home }, encoding: "utf-8" },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage: agentmesh doctor/);
});

test("doctor CLI rejects stray positionals matching timeout values", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const home = path.join(workspace, "home");

  const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.js", import.meta.url));
  const result = spawnSync(
    process.execPath,
    [cliPath, "doctor", "5", "--probe-timeout-secs", "5", "--json"],
    { cwd: workspace, env: { ...process.env, HOME: home }, encoding: "utf-8" },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage: agentmesh doctor/);
});
