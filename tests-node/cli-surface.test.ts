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

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.js", import.meta.url));

function makeWorkspace(): string {
  return mkdtempSync(path.join(tmpdir(), "agentmesh-cli-surface-"));
}

function runCli(
  workspace: string,
  args: string[],
  envOverrides: NodeJS.ProcessEnv = {},
  timeoutMs?: number,
) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: path.join(workspace, ".home"),
    ...envOverrides,
  };
  if (!("AGENTMESH_CONFIG" in envOverrides)) {
    delete env.AGENTMESH_CONFIG;
  }
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: workspace,
    env,
    encoding: "utf-8",
    ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
  });
}

function writeExecutable(filePath: string, content: string): void {
  writeFileSync(filePath, content);
  chmodSync(filePath, 0o755);
}

function writeAiCliShim(binDir: string, commandName: string, body?: string): void {
  mkdirSync(binDir, { recursive: true });
  writeExecutable(
    path.join(binDir, commandName),
    body ?? [
      "#!/usr/bin/env bash",
      "if [[ \"$1\" == \"--version\" || \"$*\" == *\"--help\"* ]]; then exit 0; fi",
      "cat >/dev/null",
      "printf 'OK\\n'",
      "exit 0",
      "",
    ].join("\n"),
  );
}

function userConfig(workspace: string): string {
  return path.join(workspace, ".home", ".config", "agentmesh", "config.toml");
}

function addedAgentId(output: string): string {
  const match = output.match(/Added agent: (a-[0-9a-f]{8})/);
  assert.ok(match, `expected generated agent id in output:\n${output}`);
  return match[1];
}

test("top-level help exits successfully", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));

  const help = runCli(workspace, ["--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stderr, /usage: agentmesh/);
  assert.match(help.stderr, /doctor \[--agent <agent-id> \.\.\.\]/);
  assert.match(help.stderr, /cli detect \[--json\]/);
  assert.match(help.stderr, /mcp list \[--json\]/);
  assert.match(help.stderr, /mcp add <server-id> --command <command>/);
  assert.match(help.stderr, /call --agent <agent-id>.*\[--title <title>\]/);
  assert.match(help.stderr, /run .*\[--title <title>\]/);
  assert.match(help.stderr, /flow run .*\[--title <title>\]/);
  assert.match(help.stderr, /--review-session-mode <auto\|interactive_continuous\|independent>/);
  assert.match(help.stderr, /--host-kind <host-kind>/);
  assert.match(help.stderr, /--conversation-scope <amscope_v1:uuid>/);

  const helpCommand = runCli(workspace, ["help"]);
  assert.equal(helpCommand.status, 0, helpCommand.stderr);
  assert.match(helpCommand.stderr, /usage: agentmesh/);

  const studioHelp = runCli(workspace, ["help", "studio"]);
  assert.equal(studioHelp.status, 0, studioHelp.stderr);
  assert.match(studioHelp.stderr, /usage: agentmesh studio \[--host <host>\]/);
  assert.doesNotMatch(studioHelp.stdout, /AgentMesh: http:\/\//);

  const studioFlagHelp = runCli(workspace, ["studio", "--help"], {}, 1000);
  assert.equal(studioFlagHelp.status, 0, studioFlagHelp.stderr);
  assert.equal(studioFlagHelp.error, undefined);
  assert.match(studioFlagHelp.stderr, /usage: agentmesh studio \[--host <host>\]/);
  assert.doesNotMatch(studioFlagHelp.stdout, /AgentMesh: http:\/\//);

  const agentsAddHelp = runCli(workspace, ["agents", "add", "--help"]);
  assert.equal(agentsAddHelp.status, 0, agentsAddHelp.stderr);
  assert.match(agentsAddHelp.stderr, /usage: agentmesh agents add --adapter <adapter>/);

  const agentsAddHelpAfterOption = runCli(workspace, [
    "agents",
    "add",
    "--adapter",
    "codex-cli",
    "--help",
  ]);
  assert.equal(agentsAddHelpAfterOption.status, 0, agentsAddHelpAfterOption.stderr);
  assert.match(agentsAddHelpAfterOption.stderr, /usage: agentmesh agents add --adapter <adapter>/);
  assert.doesNotMatch(agentsAddHelpAfterOption.stderr, /unknown help topic/);
});

test("workflow run rejects invalid reviewer session inputs without echoing sensitive values", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const rawScope = "amscope_v1:11111111-1111-4111-8111-111111111111";
  const sharedArgs = [
    "flow",
    "run",
    "--plan",
    "current",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--task",
    "validate reviewer session input",
  ];
  const invalidInputs = [
    ["--review-session-mode", "continuous"],
    ["--host-kind", "provider-private-host"],
    ["--conversation-scope", "amscope_v1:not-a-uuid"],
  ];

  for (const input of invalidInputs) {
    const result = runCli(workspace, [...sharedArgs, ...input]);
    assert.equal(result.status, 2, result.stderr);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /provider-private-host|amscope_v1:not-a-uuid/);
  }
  const missingValueInputs = [
    ["--review-session-mode", "--review-session-mode requires a value"],
    ["--host-kind", "--host-kind requires a value"],
    ["--conversation-scope", "--conversation-scope requires a value"],
  ];
  for (const [flag, error] of missingValueInputs) {
    const result = runCli(workspace, [...sharedArgs, flag]);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stderr.trim(), error);
  }
  const rawScopeResult = runCli(workspace, [
    ...sharedArgs,
    "--host-kind",
    "codex",
    "--conversation-scope",
    rawScope,
    "--review-session-mode",
    "invalid",
  ]);
  assert.equal(rawScopeResult.status, 2, rawScopeResult.stderr);
  assert.doesNotMatch(`${rawScopeResult.stdout}\n${rawScopeResult.stderr}`, new RegExp(rawScope));
});

test("skill install rejects the removed Copilot target", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));

  const result = runCli(workspace, ["skill", "install", "--target", "copilot"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unsupported skill target: copilot/);
});

test("agents list treats a missing first-run config as an empty registry", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));

  const list = runCli(workspace, ["agents", "list"]);
  assert.equal(list.status, 0, list.stderr);
  assert.equal(list.stdout, "");
  assert.equal(list.stderr, "");

  const jsonList = runCli(workspace, ["agents", "list", "--json"]);
  assert.equal(jsonList.status, 0, jsonList.stderr);
  assert.deepEqual(JSON.parse(jsonList.stdout), []);
  assert.equal(jsonList.stderr, "");
  assert.equal(existsSync(userConfig(workspace)), false);
});

test("agents list surfaces missing explicit config overlays", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const missingConfig = path.join(workspace, "missing.toml");

  const flagList = runCli(workspace, ["--config", missingConfig, "agents", "list", "--json"]);
  assert.equal(flagList.status, 1);
  assert.match(flagList.stderr, /no config found; searched:/);
  assert.match(flagList.stderr, /missing\.toml/);
  assert.equal(flagList.stdout, "");

  const envList = runCli(workspace, ["agents", "list", "--json"], {
    AGENTMESH_CONFIG: missingConfig,
  });
  assert.equal(envList.status, 1);
  assert.match(envList.stderr, /no config found; searched:/);
  assert.match(envList.stderr, /missing\.toml/);
  assert.equal(envList.stdout, "");
});

test("init, agents, and adapters commands are served by the TS CLI", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const binDir = path.join(workspace, "bin");
  writeAiCliShim(binDir, "codex");
  writeAiCliShim(binDir, "cursor-agent");
  writeAiCliShim(binDir, "agy");
  writeExecutable(path.join(binDir, "agy"), [
    "#!/usr/bin/env bash",
    'if [[ "$1" == "models" ]]; then printf "Claude Sonnet 4.6 (Thinking)\\n"; exit 0; fi',
    'if [[ "$1" == "--version" || "$*" == *"--help"* ]]; then exit 0; fi',
    "cat >/dev/null",
    'printf "OK\\n"',
    "exit 0",
    "",
  ].join("\n"));
  writeAiCliShim(binDir, "opencode");
  const env = { PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` };

  const init = runCli(workspace, ["init"]);
  assert.equal(init.status, 0, init.stderr);
  assert.match(init.stdout, /Wrote: \.agentmesh\/config\.toml/);
  assert.equal(existsSync(path.join(workspace, ".agentmesh", "config.toml")), true);
  assert.equal(existsSync(path.join(workspace, ".agentmesh", "workflows")), false);
  assert.equal(existsSync(path.join(workspace, "agentmesh.toml")), false);
  assert.match(
    readFileSync(path.join(workspace, ".agentmesh", "config.toml"), "utf-8"),
    /Register personal CLI agents once/,
  );
  assert.match(
    readFileSync(path.join(workspace, ".agentmesh", "config.toml"), "utf-8"),
    /agentmesh agents add --adapter <adapter> --model <model-or-alias>/,
  );
  assert.match(
    readFileSync(path.join(workspace, ".agentmesh", "config.toml"), "utf-8"),
    /--skip-verify is diagnostic-only/,
  );
  assert.match(
    readFileSync(path.join(workspace, ".agentmesh", "config.toml"), "utf-8"),
    /# \[context_policy\]/,
  );
  assert.match(
    readFileSync(path.join(workspace, ".agentmesh", "config.toml"), "utf-8"),
    /# denied_paths = \["\.agentmesh\/runs", "docs\/archive", "dist-node", "node_modules"\]/,
  );
  assert.match(readFileSync(path.join(workspace, ".gitignore"), "utf-8"), /^\.agentmesh\/$/m);

  const add = runCli(workspace, [
    "agents",
    "add",
    "--adapter",
    "codex-cli",
    "--model",
    "gpt-5.5",
  ], env);
  assert.equal(add.status, 0, add.stderr);
  const plannerId = addedAgentId(add.stdout);

  const list = runCli(workspace, ["agents", "list"]);
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, new RegExp(`${plannerId}\\tCodex CLI`));
  assert.doesNotMatch(list.stdout, /aliases=/);
  const listJson = runCli(workspace, ["agents", "list", "--json"]);
  assert.equal(listJson.status, 0, listJson.stderr);
  const listPayload = JSON.parse(listJson.stdout);
  assert.equal(listPayload[0].source_layer, "user");
  assert.match(listPayload[0].source_path, /\.config\/agentmesh\/config\.toml$/);
  assert.match(readFileSync(userConfig(workspace), "utf-8"), /adapter = "codex-cli"/);

  const update = runCli(workspace, [
    "agents",
    "update",
    plannerId,
    "--model",
    "gpt-5.4",
    "--label",
    "Codex GPT-5.4",
    "--capability",
    "review",
  ], env);
  assert.equal(update.status, 0, update.stderr);
  assert.match(update.stdout, new RegExp(`Updated agent: ${plannerId}`));
  assert.match(readFileSync(userConfig(workspace), "utf-8"), /label = "Codex GPT-5\.4"/);
  assert.match(readFileSync(userConfig(workspace), "utf-8"), /model = "gpt-5\.4"/);
  assert.match(readFileSync(userConfig(workspace), "utf-8"), /capabilities = \[\s*"review"\s*\]/);

  const shorthand = runCli(workspace, [
    "agents",
    "add",
    "--adapter",
    "opencode",
    "--model",
    "zhuanzhuan/deepseek-v4-pro",
  ], env);
  assert.equal(shorthand.status, 0, shorthand.stderr);
  assert.match(readFileSync(userConfig(workspace), "utf-8"), /adapter = "opencode-cli"/);

  const cursor = runCli(workspace, [
    "agents",
    "add",
    "--adapter",
    "cursor",
    "--model",
    "compose2-fast",
    "--reasoning-effort",
    "high",
  ], env);
  assert.equal(cursor.status, 0, cursor.stderr);
  assert.match(cursor.stdout, /Warning: cursor-agent does not support reasoning_effort; stored none instead of high/);
  assert.match(readFileSync(userConfig(workspace), "utf-8"), /adapter = "cursor-agent"/);
  assert.match(readFileSync(userConfig(workspace), "utf-8"), /model = "composer-2-fast"/);
  assert.match(readFileSync(userConfig(workspace), "utf-8"), /reasoning_effort = "none"/);

  const antigravity = runCli(workspace, [
    "agents",
    "add",
    "--adapter",
    "antigravity",
    "--model",
    "Claude Sonnet 4.6 (Thinking)",
    "--reasoning-effort",
    "high",
  ], env);
  assert.equal(antigravity.status, 0, antigravity.stderr);
  assert.match(antigravity.stdout, /Warning: antigravity-cli does not support reasoning_effort; stored none instead of high/);
  assert.match(readFileSync(userConfig(workspace), "utf-8"), /adapter = "antigravity-cli"/);
  assert.match(readFileSync(userConfig(workspace), "utf-8"), /model = "Claude Sonnet 4\.6 \(Thinking\)"/);
  assert.match(readFileSync(userConfig(workspace), "utf-8"), /reasoning_effort = "none"/);

  const adapters = runCli(workspace, ["adapters", "list"]);
  assert.equal(adapters.status, 0, adapters.stderr);
  assert.match(adapters.stdout, /opencode-cli\tOpenCode CLI/);
  assert.match(adapters.stdout, /cursor-agent\tCursor Agent/);
  assert.match(adapters.stdout, /antigravity-cli\tAntigravity CLI/);
  assert.doesNotMatch(adapters.stdout, /gemini-cli\tGemini CLI/);
});

test("antigravity model discovery feeds the selected label into calls", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const binDir = path.join(workspace, "bin");
  const logFile = path.join(workspace, "agy-args.log");
  mkdirSync(binDir, { recursive: true });
  writeExecutable(path.join(binDir, "agy"), [
    "#!/usr/bin/env bash",
    'if [[ "$1" == "models" ]]; then',
    '  printf "Claude Sonnet 4.6 (Thinking)\\n"',
    "  exit 0",
    "fi",
    `printf '%s\\n' "$*" >> ${JSON.stringify(logFile)}`,
    'printf "OK\\n"',
    "",
  ].join("\n"));
  const env = { PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` };

  const init = runCli(workspace, ["init"], env);
  assert.equal(init.status, 0, init.stderr);

  const added = runCli(workspace, [
    "agents",
    "add",
    "--adapter",
    "antigravity",
    "--model",
    "Claude Sonnet 4.6 (Thinking)",
  ], env);
  assert.equal(added.status, 0, added.stderr);

  const agentId = addedAgentId(added.stdout);
  const called = runCli(workspace, ["call", "--agent", agentId, "--prompt", "只回复 OK"], env);
  assert.equal(called.status, 0, called.stderr);
  const calls = readFileSync(logFile, "utf-8").trimEnd().split("\n");
  assert.equal(calls.at(-1), "--model Claude Sonnet 4.6 (Thinking) -p 只回复 OK");
});

test("cli detect reports supported provider CLIs through the shared resolver", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const opencodePath = path.join(workspace, ".home", ".opencode", "bin", "opencode");
  mkdirSync(path.dirname(opencodePath), { recursive: true });
  writeExecutable(opencodePath, [
    "#!/bin/sh",
    "if [ \"$1\" = \"--version\" ]; then",
    "  echo 'opencode 9.9.9'",
    "  exit 0",
    "fi",
    "exit 0",
    "",
  ].join("\n"));

  const result = runCli(workspace, ["cli", "detect", "--json"], {
    PATH: "",
    SHELL: path.join(workspace, "missing-shell"),
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout) as {
    schema_version: number;
    tools: Array<{
      tool: string;
      adapter: string;
      command: string;
      found: boolean;
      source: string;
      path?: string;
      version: string;
    }>;
  };
  assert.equal(payload.schema_version, 1);
  assert.deepEqual(
    payload.tools.map((tool) => tool.tool).sort(),
    ["antigravity", "claude", "codex", "cursor", "opencode"],
  );
  const opencode = payload.tools.find((tool) => tool.tool === "opencode");
  assert.equal(opencode?.adapter, "opencode-cli");
  assert.equal(opencode?.command, "opencode");
  assert.equal(opencode?.found, true);
  assert.equal(opencode?.source, "well_known");
  assert.equal(opencode?.path, opencodePath);
  assert.equal(opencode?.version, "opencode 9.9.9");
});

test("init keeps agentmesh gitignore entries idempotent and migrates legacy runs ignore", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeFileSync(path.join(workspace, ".gitignore"), ".agentmesh/\n");

  const init = runCli(workspace, ["init"]);
  assert.equal(init.status, 0, init.stderr);
  assert.equal(readFileSync(path.join(workspace, ".gitignore"), "utf-8"), ".agentmesh/\n");

  const forced = runCli(workspace, ["init", "--force"]);
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(readFileSync(path.join(workspace, ".gitignore"), "utf-8"), ".agentmesh/\n");

  const legacyWorkspace = makeWorkspace();
  test.after(() => rmSync(legacyWorkspace, { recursive: true, force: true }));
  writeFileSync(
    path.join(legacyWorkspace, ".gitignore"),
    [
      "# AgentMesh runtime packets",
      ".agentmesh/runs/",
      "",
    ].join("\n"),
  );

  const legacyInit = runCli(legacyWorkspace, ["init"]);
  assert.equal(legacyInit.status, 0, legacyInit.stderr);
  assert.equal(
    readFileSync(path.join(legacyWorkspace, ".gitignore"), "utf-8"),
    [
      "# AgentMesh runtime packets",
      ".agentmesh/",
      "",
    ].join("\n"),
  );

  const duplicateWorkspace = makeWorkspace();
  test.after(() => rmSync(duplicateWorkspace, { recursive: true, force: true }));
  writeFileSync(
    path.join(duplicateWorkspace, ".gitignore"),
    [
      ".agentmesh/runs/",
      ".agentmesh/",
      "",
    ].join("\n"),
  );

  const duplicateInit = runCli(duplicateWorkspace, ["init"]);
  assert.equal(duplicateInit.status, 0, duplicateInit.stderr);
  assert.equal(
    readFileSync(path.join(duplicateWorkspace, ".gitignore"), "utf-8"),
    ".agentmesh/\n",
  );
});

test("agents add preserves existing user config comments", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const binDir = path.join(workspace, "bin");
  writeAiCliShim(binDir, "codex");
  const configPath = userConfig(workspace);
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(
    configPath,
    [
      "schema_version = 1",
      "# keep this operator note",
      "",
    ].join("\n"),
  );

  const add = runCli(workspace, [
    "agents",
    "add",
    "--adapter",
    "codex-cli",
    "--model",
    "gpt-5.5",
  ], { PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` });
  assert.equal(add.status, 0, add.stderr);
  const plannerId = addedAgentId(add.stdout);

  const content = readFileSync(configPath, "utf-8");
  assert.match(content, /# keep this operator note/);
  assert.match(content, new RegExp(`\\[agents\\.${plannerId}\\]`));
  assert.doesNotMatch(content, /aliases =/);
});

test("agents add defaults to user config and env config overlays remain visible", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const binDir = path.join(workspace, "bin");
  writeAiCliShim(binDir, "codex");
  const projectConfigDir = path.join(workspace, ".agentmesh");
  mkdirSync(projectConfigDir, { recursive: true });
  const projectConfig = path.join(projectConfigDir, "config.toml");
  writeFileSync(projectConfig, "schema_version = 1\n");

  const add = runCli(workspace, [
    "agents",
    "add",
    "--adapter",
    "codex",
    "--model",
    "gpt-5.5",
  ], { PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` });
  assert.equal(add.status, 0, add.stderr);
  const plannerId = addedAgentId(add.stdout);
  assert.equal(existsSync(path.join(workspace, "agentmesh.toml")), false);
  assert.doesNotMatch(readFileSync(projectConfig, "utf-8"), /adapter = "codex-cli"/);
  assert.match(readFileSync(userConfig(workspace), "utf-8"), /adapter = "codex-cli"/);

  const list = runCli(workspace, ["agents", "list"]);
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, new RegExp(`${plannerId}\\tCodex CLI`));

  const envConfig = path.join(workspace, "custom.toml");
  writeFileSync(
    envConfig,
    [
      "schema_version = 1",
      "",
      "[agents.env_planner]",
      'adapter = "command"',
      `command = "${process.execPath}"`,
      "args = []",
      'capabilities = ["plan"]',
      "",
    ].join("\n"),
  );
  const envList = runCli(workspace, ["agents", "list"], {
    AGENTMESH_CONFIG: envConfig,
  });
  assert.equal(envList.status, 0, envList.stderr);
  assert.match(envList.stdout, /env_planner/);
  assert.match(envList.stdout, new RegExp(`${plannerId}\\tCodex CLI`));
});

test("agents add rejects explicit scope flags because agents are global", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const binDir = path.join(workspace, "bin");
  writeAiCliShim(binDir, "codex");

  const add = runCli(workspace, [
    "agents",
    "add",
    "--adapter",
    "codex",
    "--model",
    "gpt-5.5",
    "--scope",
    "project",
  ], { PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` });
  assert.equal(add.status, 2);
  assert.match(add.stderr, /agents are global user-level resources; --scope is not supported/);
  assert.equal(existsSync(userConfig(workspace)), false);

  const invalid = runCli(workspace, [
    "agents",
    "add",
    "bad",
    "--adapter",
    "codex",
    "--model",
    "gpt-5.5",
    "--scope",
    "team",
  ]);
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /agents are global user-level resources; --scope is not supported/);
});

test("agents add generates a short id and probes before writing", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const binDir = path.join(workspace, "bin");
  const argsFile = path.join(workspace, "probe-args.txt");
  const stdinFile = path.join(workspace, "probe-stdin.txt");
  writeAiCliShim(
    binDir,
    "codex",
    [
      "#!/usr/bin/env bash",
      `printf '%s\\n' "$*" >> ${JSON.stringify(argsFile)}`,
      `cat >> ${JSON.stringify(stdinFile)}`,
      "exit 0",
      "",
    ].join("\n"),
  );

  const add = runCli(workspace, [
    "agents",
    "add",
    "--adapter",
    "codex",
    "--model",
    "gpt55",
  ], { PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` });

  assert.equal(add.status, 0, add.stderr);
  const agentId = addedAgentId(add.stdout);
  const content = readFileSync(userConfig(workspace), "utf-8");
  assert.match(content, new RegExp(`\\[agents\\.${agentId}\\]`));
  assert.match(content, /label = "Codex CLI \(gpt-5\.5\)"/);
  assert.match(content, /adapter = "codex-cli"/);
  assert.match(content, /model = "gpt-5.5"/);
  assert.doesNotMatch(content, /aliases =/);
  assert.match(content, /capabilities = \[ "plan", "execute", "verify", "review", "decide" \]/);
  assert.match(readFileSync(argsFile, "utf-8"), /exec -m gpt-5\.5/);
  assert.match(readFileSync(stdinFile, "utf-8"), /AgentMesh doctor authentication probe/);
});

test("agents add resolves user model aliases after adapter discovery misses", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const binDir = path.join(workspace, "bin");
  writeAiCliShim(binDir, "codex");
  mkdirSync(path.dirname(userConfig(workspace)), { recursive: true });
  writeFileSync(
    userConfig(workspace),
    [
      "schema_version = 1",
      "",
      "[model_aliases.mimo]",
      'adapter = "codex-cli"',
      'model = "gpt-5.5"',
      "",
    ].join("\n"),
  );

  const add = runCli(workspace, [
    "agents",
    "add",
    "--adapter",
    "codex",
    "--model",
    "mimo",
  ], { PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` });

  assert.equal(add.status, 0, add.stderr);
  const agentId = addedAgentId(add.stdout);
  const content = readFileSync(userConfig(workspace), "utf-8");
  assert.match(content, /\[model_aliases\.mimo\]/);
  assert.match(content, new RegExp(`\\[agents\\.${agentId}\\]`));
  assert.match(content, /model = "gpt-5.5"/);
});

test("agents add rejects positional agent ids", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const binDir = path.join(workspace, "bin");
  writeAiCliShim(binDir, "codex");

  const add = runCli(workspace, [
    "agents",
    "add",
    "legacy_planner",
    "--adapter",
    "codex",
    "--model",
    "gpt55",
  ], { PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` });

  assert.equal(add.status, 2);
  assert.match(add.stderr, /usage: agentmesh agents add --adapter <adapter>/);
  assert.equal(existsSync(userConfig(workspace)), false);
});

test("agents add parses explicit capabilities and overrides defaults", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const binDir = path.join(workspace, "bin");
  writeAiCliShim(binDir, "codex");

  const add = runCli(workspace, [
    "agents",
    "add",
    "--adapter",
    "codex",
    "--model",
    "gpt55",
    "--capability",
    "plan",
    "--capability",
    "decide",
    "--timeout-seconds",
    "1200",
  ], { PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` });

  assert.equal(add.status, 0, add.stderr);
  const content = readFileSync(userConfig(workspace), "utf-8");
  assert.match(content, /capabilities = \[\s*"plan",\s*"decide"\s*\]/);
  assert.match(content, /timeout_seconds = 1200/);
  assert.doesNotMatch(content, /"execute"/);
  assert.doesNotMatch(content, /"verify"/);
  assert.doesNotMatch(content, /"review"/);
});

test("agents add rejects invalid static metadata before writing", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const binDir = path.join(workspace, "bin");
  writeAiCliShim(binDir, "codex");
  const env = { PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` };

  const positionalId = runCli(workspace, [
    "agents",
    "add",
    "bad id",
    "--adapter",
    "codex",
    "--model",
    "gpt55",
  ], env);
  assert.equal(positionalId.status, 2);
  assert.match(positionalId.stderr, /usage: agentmesh agents add --adapter <adapter>/);
  assert.equal(existsSync(userConfig(workspace)), false);

  const invalidTimeout = runCli(workspace, [
    "agents",
    "add",
    "--adapter",
    "codex",
    "--model",
    "gpt55",
    "--timeout-seconds",
    "10",
  ], env);
  assert.equal(invalidTimeout.status, 2);
  assert.match(invalidTimeout.stderr, /timeout_seconds must be between 30 and 3600/);
  assert.equal(existsSync(userConfig(workspace)), false);

  const invalidReasoning = runCli(workspace, [
    "agents",
    "add",
    "--adapter",
    "codex",
    "--model",
    "gpt55",
    "--reasoning-effort",
    "warp",
  ], env);
  assert.equal(invalidReasoning.status, 2);
  assert.match(invalidReasoning.stderr, /reasoning_effort must be one of/);
  assert.equal(existsSync(userConfig(workspace)), false);

  const invalidAlias = runCli(workspace, [
    "agents",
    "add",
    "--adapter",
    "codex",
    "--model",
    "gpt55",
    "--alias",
    "legacy",
  ], env);
  assert.equal(invalidAlias.status, 2);
  assert.match(invalidAlias.stderr, /usage: agentmesh agents add --adapter <adapter>/);
});

test("agent aliases are no longer accepted in CLI or config", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const binDir = path.join(workspace, "bin");
  writeAiCliShim(binDir, "codex");
  mkdirSync(path.dirname(userConfig(workspace)), { recursive: true });
  writeFileSync(
    userConfig(workspace),
    [
      "schema_version = 1",
      "",
      "[agents.existing]",
      'adapter = "command"',
      'aliases = ["runner"]',
      "",
    ].join("\n"),
  );

  const list = runCli(workspace, ["agents", "list"], { PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` });
  assert.equal(list.status, 1);
  assert.match(list.stderr, /agents\.existing\.aliases is not supported/);

  const add = runCli(workspace, [
    "agents",
    "add",
    "--adapter",
    "codex",
    "--model",
    "gpt55",
    "--alias",
    "runner",
  ], { PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` });
  assert.equal(add.status, 2);
  assert.match(add.stderr, /usage: agentmesh agents add --adapter <adapter>/);
  const content = readFileSync(userConfig(workspace), "utf-8");
  assert.doesNotMatch(content, /label = "Codex CLI \(gpt-5\.5\)"/);
});

test("agents add skips generated id collisions before writing", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const binDir = path.join(workspace, "bin");
  writeAiCliShim(binDir, "codex");
  mkdirSync(path.dirname(userConfig(workspace)), { recursive: true });
  writeFileSync(
    userConfig(workspace),
    [
      "schema_version = 1",
      "",
      "[agents.a-00000001]",
      'adapter = "codex-cli"',
      'command = "codex"',
      'model = "gpt-5.5"',
      "",
    ].join("\n"),
  );
  const add = runCli(workspace, [
    "agents",
    "add",
    "--adapter",
    "codex",
    "--model",
    "gpt55",
  ], { PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` });

  assert.equal(add.status, 0, add.stderr);
  const agentId = addedAgentId(add.stdout);
  assert.notEqual(agentId, "a-00000001");
  const content = readFileSync(userConfig(workspace), "utf-8");
  assert.match(content, /\[agents\.a-00000001\]/);
  assert.match(content, new RegExp(`\\[agents\\.${agentId}\\]`));
});

test("agents add gates writes on readiness and keeps skip verify diagnostic-only", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const binDir = path.join(workspace, "bin");
  writeAiCliShim(
    binDir,
    "codex",
    [
      "#!/usr/bin/env bash",
      "if [[ \"$1\" == \"--version\" || \"$*\" == *\"--help\"* ]]; then exit 0; fi",
      "printf 'model unavailable: gpt-5.5\\n' >&2",
      "exit 2",
      "",
    ].join("\n"),
  );
  const env = { PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` };

  const rejected = runCli(workspace, [
    "agents",
    "add",
    "--adapter",
    "codex",
    "--model",
    "gpt-5.5",
  ], env);

  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /Model unavailable/);
  assert.equal(existsSync(userConfig(workspace)), false);

  const skipped = runCli(workspace, [
    "agents",
    "add",
    "--adapter",
    "codex",
    "--model",
    "gpt-5.5",
    "--skip-verify",
  ], env);

  assert.equal(skipped.status, 2);
  assert.match(skipped.stderr, /--skip-verify is diagnostic-only and does not write config/);
  assert.equal(existsSync(userConfig(workspace)), false);
});

test("agents add reports usage for positional ids and unknown adapters", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));

  const tooMany = runCli(workspace, [
    "agents",
    "add",
    "one",
    "two",
    "--adapter",
    "codex",
    "--model",
    "gpt-5.5",
  ]);
  assert.equal(tooMany.status, 2);
  assert.match(tooMany.stderr, /usage: agentmesh agents add --adapter <adapter>/);

  const unknown = runCli(workspace, [
    "agents",
    "add",
    "--adapter",
    "unknown",
    "--model",
    "gpt-5.5",
  ]);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /unknown adapter: unknown/);
  assert.match(unknown.stderr, /Supported adapters:/);
  assert.equal(existsSync(userConfig(workspace)), false);
});

test("agents add rejects model names that cannot be resolved", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));

  const add = runCli(workspace, [
    "agents",
    "add",
    "--adapter",
    "codex",
    "--model",
    "gpt-6",
  ]);

  assert.equal(add.status, 2);
  assert.match(add.stderr, /could not resolve --model: gpt-6/);
  assert.equal(existsSync(userConfig(workspace)), false);
});

test("agents add reports ambiguous model candidates without writing config", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));

  const add = runCli(workspace, [
    "agents",
    "add",
    "--adapter",
    "codex",
    "--model",
    "gpt5",
  ]);

  assert.equal(add.status, 2);
  assert.match(add.stderr, /ambiguous --model: gpt5/);
  assert.match(add.stderr, /gpt-5\.4/);
  assert.match(add.stderr, /gpt-5\.5/);
  assert.equal(existsSync(userConfig(workspace)), false);
});

test("call invokes a configured command adapter from the TS CLI", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  mkdirSync(path.join(workspace, ".agentmesh"), { recursive: true });
  const fake = path.join(workspace, "fake-agent.sh");
  const stdoutFake = path.join(workspace, "stdout-agent.sh");
  const argsFile = path.join(workspace, "args.txt");
  writeExecutable(
    fake,
    [
      "#!/usr/bin/env bash",
      `printf '%s\\n' "$@" > ${JSON.stringify(argsFile)}`,
      "while [[ $# -gt 0 ]]; do",
      "  case \"$1\" in",
      "    --output-file) shift; printf 'agent output\\n' > \"$1\" ;;",
      "  esac",
      "  shift || true",
      "done",
      "",
    ].join("\n"),
  );
  writeExecutable(
    stdoutFake,
    [
      "#!/usr/bin/env bash",
      "printf 'stdout output\\n'",
      "",
    ].join("\n"),
  );
  mkdirSync(path.dirname(userConfig(workspace)), { recursive: true });
  writeFileSync(
    userConfig(workspace),
    [
      "schema_version = 1",
      "",
      "[agents.echo]",
      'label = "Echo Agent"',
      'adapter = "command"',
      `command = "${fake}"`,
      "args = []",
      'capabilities = ["plan", "execute", "review", "decide"]',
      'prompt_arg = "--prompt"',
      'output_file_arg = "--output-file"',
      "",
      "[agents.stdout]",
      'label = "Stdout Agent"',
      'adapter = "command"',
      `command = "${stdoutFake}"`,
      "args = []",
      'capabilities = ["plan", "execute", "review", "decide"]',
      "",
    ].join("\n"),
  );

  const outputFile = path.join(workspace, "out.txt");
  const result = runCli(workspace, [
    "call",
    "--agent",
    "echo",
    "--prompt",
    "hello",
    "--output-file",
    outputFile,
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(argsFile, "utf-8"), /--prompt/);
  assert.equal(readFileSync(outputFile, "utf-8"), "agent output\n");

  const stdoutOutputFile = path.join(workspace, "stdout-out.txt");
  const stdoutResult = runCli(workspace, [
    "call",
    "--agent",
    "stdout",
    "--prompt",
    "hello",
    "--output-file",
    stdoutOutputFile,
  ]);
  assert.equal(stdoutResult.status, 0, stdoutResult.stderr);
  assert.equal(readFileSync(stdoutOutputFile, "utf-8"), "stdout output\n");
});

test("call invokes built-in AI CLI adapters with model args and prompt content", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  mkdirSync(path.join(workspace, ".agentmesh"), { recursive: true });
  const fake = path.join(workspace, "fake-codex.sh");
  const argsFile = path.join(workspace, "ai-args.txt");
  const stdinFile = path.join(workspace, "ai-stdin.txt");
  const envFile = path.join(workspace, "ai-env.txt");
  writeExecutable(
    fake,
    [
      "#!/usr/bin/env bash",
      `printf '%s\\n' "$@" > ${JSON.stringify(argsFile)}`,
      `cat > ${JSON.stringify(stdinFile)}`,
      `printf '%s\\n' "$AGENTMESH_TEST_ENV" > ${JSON.stringify(envFile)}`,
      "printf 'ai output\\n'",
      "",
    ].join("\n"),
  );
  mkdirSync(path.dirname(userConfig(workspace)), { recursive: true });
  writeFileSync(
    userConfig(workspace),
    [
      "schema_version = 1",
      "",
      "[agents.ai]",
      'label = "AI Agent"',
      'adapter = "codex-cli"',
      `command = "${fake}"`,
      'model = "gpt-5.5"',
      'reasoning_effort = "high"',
      'env = ["AGENTMESH_TEST_ENV=present"]',
      'capabilities = ["plan", "execute", "review", "decide"]',
      "",
    ].join("\n"),
  );
  writeFileSync(path.join(workspace, "prompt.md"), "hello ai\n");

  const outputFile = path.join(workspace, "ai-out.txt");
  const result = runCli(workspace, [
    "call",
    "--agent",
    "ai",
    "--prompt-file",
    "prompt.md",
    "--output-file",
    outputFile,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const args = readFileSync(argsFile, "utf-8").trim().split(/\s+/);
  assert.deepEqual(args, ["exec", "-m", "gpt-5.5", "-c", 'model_reasoning_effort="high"', "-"]);
  assert.equal(readFileSync(stdinFile, "utf-8"), "hello ai\n");
  assert.equal(readFileSync(envFile, "utf-8"), "present\n");
  assert.equal(readFileSync(outputFile, "utf-8"), "ai output\n");
});

test("call rejects current with host-only guidance", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));

  const result = runCli(workspace, [
    "call",
    "--agent",
    "current",
    "--prompt",
    "hello",
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /current is host-only/);
  assert.match(result.stderr, /flow prompt/);
  assert.match(result.stderr, /flow attach/);
});

test("flow run, prompt, attach, status, and events use TS packet files", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));

  const run = runCli(workspace, [
    "flow",
    "run",
    "--plan",
    "current",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--task",
    "ship typed packets",
    "--title",
    "发布类型化数据包",
    "--run-id",
    "typed-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const prompt = runCli(workspace, ["flow", "prompt", "typed-flow", "--stage", "plan"]);
  assert.equal(prompt.status, 0, prompt.stderr);
  assert.match(prompt.stdout, /ship typed packets/);

  const attach = runCli(workspace, [
    "flow",
    "attach",
    "typed-flow",
    "--stage",
    "plan",
    "--text",
    "# Plan\n\nDo it.",
  ]);
  assert.equal(attach.status, 0, attach.stderr);

  const status = runCli(workspace, ["flow", "status", "typed-flow", "--json"]);
  assert.equal(status.status, 0, status.stderr);
  const payload = JSON.parse(status.stdout);
  assert.equal(payload.run_id, "typed-flow");
  assert.equal(payload.title, "发布类型化数据包");
  assert.deepEqual(payload.completed_stages, ["plan"]);

  const humanStatus = runCli(workspace, ["flow", "status", "typed-flow"]);
  assert.equal(humanStatus.status, 0, humanStatus.stderr);
  assert.match(humanStatus.stdout, /Title: 发布类型化数据包/);

  const events = runCli(workspace, ["flow", "events", "typed-flow", "--json"]);
  assert.equal(events.status, 0, events.stderr);
  assert.ok(JSON.parse(events.stdout).some((event: { event: string }) => event.event === "artifact.written"));

  const unsupportedRole = runCli(workspace, [
    "flow",
    "run",
    "--workflow",
    "w-4963ede2",
    "--plan",
    "current",
    "--execute",
    "current",
    "--decide",
    "current",
    "--task",
    "ship typed packets",
  ]);
  assert.equal(unsupportedRole.status, 2);
  assert.match(unsupportedRole.stderr, /does not include role/);

  const unsupportedTail = runCli(workspace, ["flow", "events", "typed-flow", "--follow"]);
  assert.equal(unsupportedTail.status, 2);
  assert.match(unsupportedTail.stderr, /not supported/);

  const runDir = path.join(workspace, ".agentmesh", "runs", "typed-flow");
  assert.equal(readFileSync(path.join(runDir, "plan.md"), "utf-8"), "# Plan\n\nDo it.\n");
});
