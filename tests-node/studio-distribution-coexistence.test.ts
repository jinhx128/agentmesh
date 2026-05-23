import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
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

import { startStudioDesktopHost } from "../apps/studio-desktop/src/host.js";
import { withRunMutationLockAsync } from "../packages/runtime/src/packet/lock.js";
import { currentPacketStatus } from "./helpers/current-packet-status.js";

function makeWorkspace(): string {
  return mkdtempSync(path.join(tmpdir(), "agentmesh-studio-coexistence-"));
}

function writeRun(workspace: string, runId: string, schemaVersion = 1): string {
  const runDir = path.join(workspace, ".agentmesh", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    path.join(runDir, "status.json"),
    `${JSON.stringify(currentPacketStatus({
      schema_version: schemaVersion,
      run_id: runId,
      status: "created",
      workflow: "coexistence-test",
      stages: ["plan"],
      completed_stages: [],
    }), null, 2)}\n`,
  );
  writeFileSync(path.join(runDir, "events.jsonl"), "");
  writeFileSync(path.join(runDir, "artifacts.toml"), "schema_version = 1\n");
  return runDir;
}

function writePathAgentmesh(binDir: string, body: string): string {
  mkdirSync(binDir, { recursive: true });
  const cliPath = path.join(binDir, "agentmesh");
  writeFileSync(cliPath, `#!/bin/sh\n${body}\n`);
  chmodSync(cliPath, 0o755);
  return cliPath;
}

async function startCliStudio(workspace: string): Promise<{
  stop: () => Promise<void>;
  url: string;
}> {
  const cliPath = path.join(process.cwd(), "dist-node", "packages", "cli", "src", "cli.js");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: path.join(workspace, ".home"),
    AGENTMESH_STUDIO_OPEN_COMMAND: "agentmesh-open-should-not-run",
  };
  delete env.AGENTMESH_CONFIG;
  const child = spawn(process.execPath, [
    cliPath,
    "studio",
    "--host",
    "127.0.0.1",
    "--port",
    "0",
    "--workspace",
    workspace,
    "--no-open",
  ], {
    cwd: workspace,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    child.kill("SIGTERM");
    await Promise.race([
      once(child, "exit"),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
  };
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      void stop();
      reject(new Error(`timed out waiting for CLI Studio URL\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 5000);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      const match = stdout.match(/AgentMesh: (http:\/\/[^\s]+)/);
      if (!match || !stdout.includes("Press Ctrl+C to stop.")) {
        return;
      }
      clearTimeout(timeout);
      resolve({ stop, url: match[1] });
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
        reject(new Error(`CLI Studio exited before URL with ${code}\nstderr:\n${stderr}`));
      }
    });
  });
}

test("CLI Studio and desktop Studio keep separate sessions while using runtime APIs", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeRun(workspace, "shared-cli-run", 1);
  writeRun(workspace, "shared-desktop-run", 1);

  const cliStudio = await startCliStudio(workspace);
  const desktopStudio = await startStudioDesktopHost({
    workspace,
    port: 0,
    token: "desktop-session-token",
  });
  try {
    assert.notEqual(cliStudio.url, desktopStudio.serverUrl);

    const cliRuns = await fetch(`${cliStudio.url}/api/runs`);
    assert.equal(cliRuns.status, 200, await cliRuns.text());
    const desktopRunsWithoutToken = await fetch(`${desktopStudio.serverUrl}/api/runs`);
    assert.equal(desktopRunsWithoutToken.status, 401, await desktopRunsWithoutToken.text());
    const desktopRuns = await fetch(`${desktopStudio.serverUrl}/api/runs`, {
      headers: { cookie: "agentmesh_studio_token=desktop-session-token" },
    });
    assert.equal(desktopRuns.status, 200, await desktopRuns.text());

    const cliMutation = await fetch(`${cliStudio.url}/api/mutations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "attach",
        run_id: "shared-cli-run",
        stage: "plan",
        text: "cli studio attach",
      }),
    });
    const cliMutationText = await cliMutation.text();
    assert.equal(cliMutation.status, 200, cliMutationText);
    const cliResult = JSON.parse(cliMutationText) as {
      command: string[];
    };
    assert.deepEqual(cliResult.command, [
      "runtime",
      "flow",
      "attach",
      "shared-cli-run",
      "--stage",
      "plan",
      "--text",
      "cli studio attach",
    ]);

    const desktopMutation = await fetch(`${desktopStudio.serverUrl}/api/mutations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "agentmesh_studio_token=desktop-session-token",
      },
      body: JSON.stringify({
        action: "attach",
        run_id: "shared-desktop-run",
        stage: "plan",
        text: "desktop studio attach",
      }),
    });
    const desktopMutationText = await desktopMutation.text();
    assert.equal(desktopMutation.status, 200, desktopMutationText);
    const desktopResult = JSON.parse(desktopMutationText) as {
      command: string[];
      stdout: string;
    };
    assert.deepEqual(desktopResult.command, [
      "runtime",
      "flow",
      "attach",
      "shared-desktop-run",
      "--stage",
      "plan",
      "--text",
      "desktop studio attach",
    ]);
    assert.match(desktopResult.stdout, /Attached:/);
  } finally {
    await desktopStudio.stop();
    await cliStudio.stop();
  }
});

test("desktop App-originated mutations use runtime APIs when PATH has another agentmesh", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeRun(workspace, "app-run");
  const binDir = path.join(workspace, "path-bin");
  writePathAgentmesh(binDir, "echo PATH_AGENTMESH_SHOULD_NOT_RUN \"$@\"; exit 77");

  const previousPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;
  const started = await startStudioDesktopHost({
    workspace,
    port: 0,
    token: "coexistence-token",
  });
  try {
    const response = await fetch(`${started.serverUrl}/api/mutations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "agentmesh_studio_token=coexistence-token",
      },
      body: JSON.stringify({
        action: "attach",
        run_id: "app-run",
        stage: "plan",
        text: "app attach",
      }),
    });
    const responseText = await response.text();
    assert.equal(response.status, 200, responseText);
    const result = JSON.parse(responseText) as {
      command: string[];
      stdout: string;
    };
    assert.deepEqual(result.command, [
      "runtime",
      "flow",
      "attach",
      "app-run",
      "--stage",
      "plan",
      "--text",
      "app attach",
    ]);
    assert.match(result.stdout, /Attached:/);
    assert.doesNotMatch(result.stdout, /PATH_AGENTMESH_SHOULD_NOT_RUN/);
  } finally {
    process.env.PATH = previousPath;
    await started.stop();
  }
});

test("terminal and entry-agent style invocations resolve the PATH-visible agentmesh", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const binDir = path.join(workspace, "path-bin");
  writePathAgentmesh(binDir, "echo PATH_VISIBLE_AGENTMESH \"$@\"");

  const output = execFileSync("agentmesh", ["studio", "--from-entry-agent"], {
    encoding: "utf-8",
    env: {
      ...process.env,
      PATH: binDir,
    },
  });

  assert.equal(output.trim(), "PATH_VISIBLE_AGENTMESH studio --from-entry-agent");
});

test("app and npm CLI channels share the filesystem run lock for the same run", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const runDir = writeRun(workspace, "locked-run");
  const started = await startStudioDesktopHost({
    workspace,
    port: 0,
    token: "lock-token",
  });
  try {
    await withRunMutationLockAsync(runDir, "npm-cli-dispatch", async () => {
      const response = await fetch(`${started.serverUrl}/api/mutations`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "agentmesh_studio_token=lock-token",
        },
        body: JSON.stringify({
          action: "dispatch",
          run_id: "locked-run",
          stage: "plan",
        }),
      });
      assert.equal(response.status, 423);
      const result = await response.json() as {
        error_code?: string;
        exit_code: number;
        retryable?: boolean;
        stderr: string;
        lock?: {
          operation?: string;
          entrypoint?: string;
          runtime_version?: string;
          command?: string;
          expires_at?: string;
        };
      };
      assert.equal(result.error_code, "run_locked");
      assert.equal(result.retryable, true);
      assert.equal(result.exit_code, 1);
      assert.equal(result.lock?.operation, "npm-cli-dispatch");
      assert.equal(result.lock?.entrypoint, "cli");
      assert.match(result.lock?.runtime_version ?? "", /^\d+\.\d+\.\d+/);
      assert.equal(result.lock?.command, "npm-cli-dispatch");
      assert.match(result.lock?.expires_at ?? "", /^\d{4}-/);
      assert.match(result.stderr, /run is locked by another mutation: npm-cli-dispatch/);
    });
  } finally {
    await started.stop();
  }
});

test("desktop mutations fail fast on unsupported newer packets without overwriting data", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const runDir = writeRun(workspace, "newer-run", 3);
  const statusPath = path.join(runDir, "status.json");
  const beforeStatus = readFileSync(statusPath, "utf-8");
  const artifactPath = path.join(runDir, "plan.md");
  const started = await startStudioDesktopHost({
    workspace,
    port: 0,
    token: "schema-token",
  });
  try {
    const response = await fetch(`${started.serverUrl}/api/mutations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "agentmesh_studio_token=schema-token",
      },
      body: JSON.stringify({
        action: "attach",
        run_id: "newer-run",
        stage: "plan",
        text: "must not be written",
      }),
    });
    assert.equal(response.status, 409);
    const result = await response.json() as {
      exit_code: number;
      stderr: string;
    };
    assert.equal(result.exit_code, 1);
    assert.match(result.stderr, /unsupported packet schema version: 3/);
    assert.equal(readFileSync(statusPath, "utf-8"), beforeStatus);
    assert.equal(existsSync(artifactPath), false);
  } finally {
    await started.stop();
  }
});
