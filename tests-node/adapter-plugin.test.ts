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
