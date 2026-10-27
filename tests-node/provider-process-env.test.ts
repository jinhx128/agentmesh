import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { discoverAdapterModels } from "../packages/runtime/src/adapters/models.js";
import { detectSupportedProviderClis } from "../packages/runtime/src/adapters/provider-cli-diagnostics.js";

function withHostEnvironment(action: (directory: string) => void): void {
  const directory = mkdtempSync(path.join(tmpdir(), "agentmesh-provider-env-"));
  const inherited: NodeJS.ProcessEnv = {
    PATH: directory,
    CLAUDECODE: "1",
    CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: "1",
    CLAUDE_CODE_HOST_AUTH_ENV_VAR: "HOST_TOKEN",
    ANTHROPIC_BASE_URL: "https://inherited-provider.invalid",
    ANTHROPIC_API_KEY: undefined,
    ANTHROPIC_AUTH_TOKEN: undefined,
  };
  const previous = Object.fromEntries(Object.keys(inherited).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(inherited)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    action(directory);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

function writeProbe(file: string, claude: boolean, output: string): void {
  writeFileSync(file, [
    `#!${process.execPath}`,
    "const assert = require('node:assert/strict');",
    "assert.equal(process.env.CLAUDECODE, undefined);",
    "assert.equal(process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST, undefined);",
    "assert.equal(process.env.CLAUDE_CODE_HOST_AUTH_ENV_VAR, undefined);",
    `assert.equal(process.env.ANTHROPIC_BASE_URL, ${claude ? "undefined" : "'https://inherited-provider.invalid'"});`,
    `console.log(${JSON.stringify(output)});`,
  ].join("\n"), { mode: 0o755 });
}

test("global provider version probes isolate Claude routing without changing other providers", { skip: process.platform === "win32" }, () => {
  withHostEnvironment((directory) => {
    for (const command of ["claude", "codex", "cursor-agent", "opencode", "agy"]) {
      writeProbe(path.join(directory, command), command === "claude", "1.2.3");
    }
    const report = detectSupportedProviderClis({ enabled: false });
    assert.equal(report.tools.length, 5);
    for (const provider of report.tools) {
      assert.equal(provider.found, true, provider.tool);
      assert.equal(provider.version, "1.2.3", `${provider.tool}: ${provider.diagnostic}`);
      assert.equal(provider.diagnostic, undefined);
    }
  });
});

test("real model discovery subprocesses apply adapter-specific environment isolation", { skip: process.platform === "win32" }, () => {
  withHostEnvironment((directory) => {
    writeFileSync(path.join(directory, "claude"), "placeholder", { mode: 0o755 });
    writeProbe(path.join(directory, "strings"), true, "claude-opus-4-7");
    writeProbe(path.join(directory, "opencode"), false, "custom/model-a");
    for (const [adapter, expected] of [["claude", "claude-opus-4-7"], ["opencode", "custom/model-a"]]) {
      const result = discoverAdapterModels(adapter, {
        runCli: true,
        commandPathResolver: (command) => path.join(directory, command),
        modelConfigPath: path.join(directory, "missing-config.json"),
      });
      assert.equal(result.status, "discovered", adapter);
      assert.ok(result.models.includes(expected), `${adapter}: ${JSON.stringify(result.models)}`);
    }
  });
});
