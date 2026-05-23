import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { currentPacketStatus } from "./helpers/current-packet-status.js";

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.js", import.meta.url));

interface StartedCli {
  stderr: () => string;
  stdout: () => string;
  stop: () => Promise<void>;
  url: string;
}

function makeWorkspace(): string {
  return mkdtempSync(path.join(tmpdir(), "agentmesh-studio-cli-"));
}

function runCli(
  workspace: string,
  args: string[],
  envOverrides: NodeJS.ProcessEnv = {},
  timeoutMs?: number,
) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: workspace,
    env: commandEnv(workspace, envOverrides),
    encoding: "utf-8",
    ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
  });
}

function commandEnv(workspace: string, envOverrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: path.join(workspace, ".home"),
    ...envOverrides,
  };
  if (!("AGENTMESH_CONFIG" in envOverrides)) {
    delete env.AGENTMESH_CONFIG;
  }
  return env;
}

function startStudioCli(
  workspace: string,
  args: string[],
  envOverrides: NodeJS.ProcessEnv = {},
): Promise<StartedCli> {
  const child = spawn(process.execPath, [cliPath, ...args], {
    cwd: workspace,
    env: commandEnv(workspace, envOverrides),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timed out waiting for Studio URL\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 5000);
    let stopped = false;
    const stop = async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      child.kill();
      await Promise.race([
        once(child, "exit"),
        new Promise((timeoutResolve) => setTimeout(timeoutResolve, 1000)),
      ]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await once(child, "exit");
      }
    };
    const maybeResolve = () => {
      const match = stdout.match(/AgentMesh: (http:\/\/[^\s]+)/);
      if (!match || !stdout.includes("Press Ctrl+C to stop.")) {
        return;
      }
      clearTimeout(timeout);
      resolve({
        stderr: () => stderr,
        stdout: () => stdout,
        stop,
        url: match[1],
      });
    };
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      maybeResolve();
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code) => {
      if (!stdout.match(/AgentMesh: (http:\/\/[^\s]+)/)) {
        clearTimeout(timeout);
        reject(new Error(`Studio CLI exited before URL with ${code}\nstderr:\n${stderr}`));
      }
    });
  });
}

function writeRun(workspace: string, runId: string): void {
  const runDir = path.join(workspace, ".agentmesh", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    path.join(runDir, "status.json"),
    JSON.stringify(currentPacketStatus({
      run_id: runId,
      status: "created",
      workflow: "studio-cli-test",
      stages: ["plan"],
      completed_stages: [],
    })) + "\n",
  );
  writeFileSync(path.join(runDir, "events.jsonl"), "");
  writeFileSync(path.join(runDir, "artifacts.toml"), "schema_version = 1\n");
}

function writeConfig(workspace: string): void {
  const configPath = path.join(workspace, ".home", ".config", "agentmesh", "config.toml");
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(
    configPath,
    [
      "schema_version = 1",
      "",
      "[agents.studio-cli-agent]",
      'label = "Studio CLI Agent"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      'model = "gpt-5.5"',
      'capabilities = ["plan", "execute", "review", "decide"]',
      "",
    ].join("\n"),
  );
}

test("agentmesh studio serves the Studio app with explicit host and port", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const started = await startStudioCli(workspace, [
    "studio",
    "--host",
    "127.0.0.1",
    "--port",
    "0",
    "--no-open",
  ]);
  test.after(() => {
    void started.stop();
  });

  assert.match(started.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.match(started.stdout(), /Browser open disabled/);
  const response = await fetch(started.url);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /AgentMesh/);
  assert.doesNotMatch(html, /AgentMesh Studio/);
  await started.stop();
});

test("agentmesh studio serves built React assets by default without taking over APIs", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeRun(workspace, "react-default-run");
  const started = await startStudioCli(workspace, [
    "studio",
    "--host",
    "127.0.0.1",
    "--port",
    "0",
    "--no-open",
  ]);
  test.after(() => {
    void started.stop();
  });

  const htmlResponse = await fetch(started.url);
  assert.equal(htmlResponse.status, 200);
  const html = await htmlResponse.text();
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /\/assets\/index-[^"]+\.js/);
  assert.doesNotMatch(html, /\/studio\.js/);

  const scriptPath = html.match(/src="([^"]+\.js)"/)?.[1];
  assert.ok(scriptPath);
  const scriptResponse = await fetch(`${started.url}${scriptPath}`);
  assert.equal(scriptResponse.status, 200);
  const script = await scriptResponse.text();
  assert.match(script, /Runs/);
  assert.match(script, /Calls/);

  const callsResponse = await fetch(`${started.url}/api/calls`);
  assert.equal(callsResponse.status, 200);
  await started.stop();
});

test("agentmesh studio fails with a build hint when resolved React assets are missing", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const missingAssetDir = path.join(workspace, "missing-frontend");
  const result = runCli(
    workspace,
    ["studio", "--port", "0", "--no-open"],
    { AGENTMESH_STUDIO_ASSET_DIR: missingAssetDir },
    5000,
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /AgentMesh frontend assets were not found/);
  assert.match(result.stderr, /npm run build:studio-frontend/);
  assert.match(result.stderr, /missing-frontend/);
});

test("agentmesh studio uses the requested workspace", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const studioWorkspace = path.join(workspace, "workspace");
  writeRun(studioWorkspace, "workspace-run");
  const started = await startStudioCli(workspace, [
    "studio",
    "--port",
    "0",
    "--workspace",
    studioWorkspace,
    "--no-open",
  ]);
  test.after(() => {
    void started.stop();
  });

  const response = await fetch(`${started.url}/api/runs`);
  assert.equal(response.status, 200);
  const payload = await response.json() as { runs: Array<{ run_id: string }> };
  assert.deepEqual(payload.runs.map((run) => run.run_id), ["workspace-run"]);
  await started.stop();
});

test("agentmesh studio resolves global config before switching workspace", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfig(workspace);
  const studioWorkspace = path.join(workspace, "workspace");
  mkdirSync(studioWorkspace, { recursive: true });
  const started = await startStudioCli(workspace, [
    "--config",
    "agentmesh.toml",
    "studio",
    "--port",
    "0",
    "--workspace",
    studioWorkspace,
    "--no-open",
  ]);
  test.after(() => {
    void started.stop();
  });

  const response = await fetch(`${started.url}/api/catalog`);
  assert.equal(response.status, 200);
  const payload = await response.json() as { agents: Array<{ id: string }> };
  assert.deepEqual(payload.agents.map((agent) => agent.id), ["studio-cli-agent"]);
  await started.stop();
});

test("agentmesh studio rejects invalid ports", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const result = runCli(workspace, ["studio", "--port", "abc", "--no-open"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid --port/);
});

test("agentmesh studio still prints a copyable URL when browser open fails", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const started = await startStudioCli(
    workspace,
    ["studio", "--port", "0"],
    { AGENTMESH_STUDIO_OPEN_COMMAND: "agentmesh-open-browser-that-does-not-exist" },
  );
  test.after(() => {
    void started.stop();
  });

  assert.match(started.stdout(), /AgentMesh: http:\/\/127\.0\.0\.1:\d+/);
  await started.stop();
});
