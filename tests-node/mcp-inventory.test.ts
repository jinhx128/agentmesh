import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.js", import.meta.url));
const fakeServerPath = fileURLToPath(
  new URL("./fixtures/mcp/fake-server.js", import.meta.url),
);

function makeWorkspace(): string {
  return mkdtempSync(path.join(tmpdir(), "agentmesh-mcp-inventory-"));
}

function runCli(workspace: string, args: string[]) {
  const home = path.join(workspace, "home");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
  };
  delete env.AGENTMESH_CONFIG;
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: workspace,
    encoding: "utf-8",
    env,
  });
}

function runCliWithHome(workspace: string, home: string, args: string[]) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
  };
  delete env.AGENTMESH_CONFIG;
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: workspace,
    encoding: "utf-8",
    env,
  });
}

function projectConfig(workspace: string): string {
  return path.join(workspace, ".agentmesh", "config.toml");
}

function userConfig(home: string): string {
  return path.join(home, ".config", "agentmesh", "config.toml");
}

test("mcp list reports configured servers without starting them", () => {
  const workspace = makeWorkspace();
  const home = path.join(workspace, "home");
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  mkdirSync(path.dirname(userConfig(home)), { recursive: true });
  mkdirSync(home, { recursive: true });
  const logPath = path.join(workspace, "fake-server-events.jsonl");
  writeFileSync(
    userConfig(home),
    [
      "schema_version = 1",
      "",
      "[mcp_servers.docs]",
      `command = ${JSON.stringify(process.execPath)}`,
      `args = ${JSON.stringify([fakeServerPath, "--log", logPath])}`,
      'resource_hints = ["memory://configured"]',
      "",
    ].join("\n"),
  );

  const result = runCliWithHome(workspace, home, ["mcp", "list", "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schema_version, 1);
  assert.deepEqual(payload.diagnostics, []);
  assert.equal(payload.servers.length, 1);
  assert.deepEqual(payload.servers[0], {
    id: "docs",
    source_layer: "user",
    source_path: path.resolve(userConfig(home)),
    command: process.execPath,
    args: [fakeServerPath, "--log", logPath],
    resource_hints: ["memory://configured"],
    diagnostics: [],
  });
  assert.equal(existsSync(logPath), false);
});

test("mcp list reports project MCP configs as diagnostics", () => {
  const workspace = makeWorkspace();
  const home = path.join(workspace, "home");
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  mkdirSync(path.dirname(projectConfig(workspace)), { recursive: true });
  writeFileSync(
    projectConfig(workspace),
    [
      "schema_version = 1",
      "",
      "[mcp_servers.docs]",
      'command = "project-docs"',
      "",
    ].join("\n"),
  );

  const result = runCliWithHome(workspace, home, ["mcp", "list", "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.servers, []);
  assert.equal(payload.diagnostics[0].classification, "config_layer_error");
  assert.match(payload.diagnostics[0].message, /mcp_servers are user-scoped and cannot be set in project config/);
});

test("mcp add writes a user-level server entry without secret-bearing fields", () => {
  const workspace = makeWorkspace();
  const home = path.join(workspace, "home");
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  mkdirSync(home, { recursive: true });

  const result = runCliWithHome(workspace, home, [
    "mcp",
    "add",
    "docs",
    "--command",
    "docs-mcp",
    "--arg",
    "--stdio",
    "--arg",
    "project",
    "--resource-hint",
    "memory://configured",
  ]);

  assert.equal(result.status, 0, result.stderr);
  const content = readFileSync(userConfig(home), "utf-8");
  assert.match(content, /\[mcp_servers\.docs\]/);
  assert.match(content, /command = "docs-mcp"/);
  assert.match(content, /args = \[\s*"--stdio", "project"\s*\]/);
  assert.match(content, /resource_hints = \[\s*"memory:\/\/configured"\s*\]/);
  assert.doesNotMatch(content, /token|env|session/i);
});

test("mcp add rejects unsupported secret-like options", () => {
  const workspace = makeWorkspace();
  const home = path.join(workspace, "home");
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  mkdirSync(home, { recursive: true });

  const result = runCliWithHome(workspace, home, [
    "mcp",
    "add",
    "docs",
    "--command",
    "docs-mcp",
    "--token",
    "secret",
  ]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage: agentmesh mcp add/);
  assert.equal(existsSync(userConfig(home)), false);
});

test("mcp add rejects ids that already exist in user config", () => {
  const workspace = makeWorkspace();
  const home = path.join(workspace, "home");
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  mkdirSync(path.dirname(userConfig(home)), { recursive: true });
  writeFileSync(
    userConfig(home),
    [
      "schema_version = 1",
      "",
      "[mcp_servers.docs]",
      'command = "user-docs"',
      "",
    ].join("\n"),
  );

  const result = runCliWithHome(workspace, home, [
    "mcp",
    "add",
    "docs",
    "--command",
    "project-docs",
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /mcp server id already exists: docs/);
  assert.match(readFileSync(userConfig(home), "utf-8"), /command = "user-docs"/);
});

test("mcp remove deletes a user-level MCP server", () => {
  const workspace = makeWorkspace();
  const home = path.join(workspace, "home");
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  mkdirSync(path.dirname(userConfig(home)), { recursive: true });
  writeFileSync(
    userConfig(home),
    [
      "schema_version = 1",
      "",
      "[mcp_servers.docs]",
      'command = "user-docs"',
      "",
    ].join("\n"),
  );

  const result = runCliWithHome(workspace, home, [
    "mcp",
    "remove",
    "docs",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(readFileSync(userConfig(home), "utf-8"), /\[mcp_servers\.docs\]/);
});

test("mcp inventory lists configured servers and resource hints without resources/read", () => {
  const workspace = makeWorkspace();
  const home = path.join(workspace, "home");
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  mkdirSync(path.dirname(userConfig(home)), { recursive: true });
  const logPath = path.join(workspace, "fake-server-events.jsonl");
  writeFileSync(
    userConfig(home),
    [
      "schema_version = 1",
      "",
      "[mcp_servers.docs]",
      `command = ${JSON.stringify(process.execPath)}`,
      `args = ${JSON.stringify([fakeServerPath, "--log", logPath, "--list-count", "60"])}`,
      'resource_hints = ["memory://configured"]',
      "",
    ].join("\n"),
  );

  const result = runCliWithHome(workspace, home, ["mcp", "inventory", "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schema_version, 1);
  assert.equal(payload.hint_limit, 50);
  assert.equal(payload.servers.length, 1);
  assert.equal(payload.servers[0].id, "docs");
  assert.equal(payload.servers[0].source_layer, "user");
  assert.equal(payload.servers[0].resource_hints.length, 50);
  assert.deepEqual(payload.servers[0].resource_hints[0], {
    uri: "memory://configured",
    source: "config",
  });
  assert.equal(payload.servers[0].resource_hints[1].source, "listed");
  assert.equal(payload.servers[0].resource_hints[1].uri, "memory://listed-1");
  assert.equal(payload.servers[0].list_error, null);

  const events = readFileSync(logPath, "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).event);
  assert.deepEqual(events, ["initialize", "initialized", "resources/list", "close"]);
});

test("mcp inventory keeps configured hints when resource listing fails", () => {
  const workspace = makeWorkspace();
  const home = path.join(workspace, "home");
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  mkdirSync(path.dirname(userConfig(home)), { recursive: true });
  writeFileSync(
    userConfig(home),
    [
      "schema_version = 1",
      "",
      "[mcp_servers.docs]",
      `command = ${JSON.stringify(path.join(workspace, "missing-mcp"))}`,
      'resource_hints = ["memory://configured"]',
      "",
    ].join("\n"),
  );

  const result = runCliWithHome(workspace, home, ["mcp", "inventory", "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.servers[0].resource_hints, [
    {
      uri: "memory://configured",
      source: "config",
    },
  ]);
  assert.match(payload.servers[0].list_error, /^server_start_failed: /);
});
