import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.js", import.meta.url));

function makeWorkspace(): string {
  return mkdtempSync(path.join(tmpdir(), "agentmesh-update-"));
}

function runCli(
  workspace: string,
  args: string[],
  envOverrides: NodeJS.ProcessEnv = {},
) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: path.join(workspace, ".home"),
    ...envOverrides,
  };
  delete env.AGENTMESH_CONFIG;
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: workspace,
    env,
    encoding: "utf-8",
  });
}

function runCliAsync(
  workspace: string,
  args: string[],
  envOverrides: NodeJS.ProcessEnv = {},
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: path.join(workspace, ".home"),
    ...envOverrides,
  };
  delete env.AGENTMESH_CONFIG;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: workspace,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

test("version commands report the installed AgentMesh version", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));

  const shortVersion = runCli(workspace, ["--version"]);
  assert.equal(shortVersion.status, 0, shortVersion.stderr);
  assert.equal(shortVersion.stdout.trim(), "0.1.4");

  const jsonVersion = runCli(workspace, ["version", "--json"]);
  assert.equal(jsonVersion.status, 0, jsonVersion.stderr);
  const payload = JSON.parse(jsonVersion.stdout) as {
    schema_version: number;
    current_version: string;
    update_check_hint: string;
  };
  assert.equal(payload.schema_version, 1);
  assert.equal(payload.current_version, "0.1.4");
  assert.equal(payload.update_check_hint, "agentmesh update check --json");
});

test("update check reports newer CLI and Desktop release assets", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  await withReleaseServer(releasePayload("0.1.5"), async (releaseUrl) => {
    const check = await runCliAsync(workspace, ["update", "check", "--json"], {
      AGENTMESH_UPDATE_RELEASE_URL: releaseUrl,
    });
    assert.equal(check.status, 0, check.stderr);
    const payload = JSON.parse(check.stdout) as {
      schema_version: number;
      current_version: string;
      latest_version: string;
      update_available: boolean;
      cli: {
        status: string;
        asset_name?: string;
        asset_url?: string;
        install_command?: string[];
      };
      desktop: {
        status: string;
        asset_name?: string;
        asset_url?: string;
      };
    };
    assert.equal(payload.schema_version, 1);
    assert.equal(payload.current_version, "0.1.4");
    assert.equal(payload.latest_version, "0.1.5");
    assert.equal(payload.update_available, true);
    assert.equal(payload.cli.status, "update_available");
    assert.equal(payload.cli.asset_name, "agentmesh-0.1.5.tgz");
    assert.equal(payload.cli.asset_url, "https://example.invalid/agentmesh-0.1.5.tgz");
    assert.deepEqual(payload.cli.install_command, [
      "npm",
      "install",
      "-g",
      "https://example.invalid/agentmesh-0.1.5.tgz",
    ]);
    assert.equal(payload.desktop.status, "manual_update_available");
    assert.equal(payload.desktop.asset_name, "AgentMesh_0.1.5_aarch64.dmg");
    assert.equal(payload.desktop.asset_url, "https://example.invalid/AgentMesh_0.1.5_aarch64.dmg");
  });
});

test("update check falls back to the release page when the API is rate limited", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  await withReleasePageFallbackServer("0.1.5", async ({ apiReleaseUrl, webReleaseUrl }) => {
    const check = await runCliAsync(workspace, ["update", "check", "--json"], {
      AGENTMESH_UPDATE_RELEASE_URL: apiReleaseUrl,
      AGENTMESH_UPDATE_WEB_RELEASE_URL: webReleaseUrl,
    });
    assert.equal(check.status, 0, check.stderr);
    const payload = JSON.parse(check.stdout) as {
      latest_version: string;
      release_url: string;
      update_available: boolean;
      cli: {
        status: string;
        asset_name?: string;
        asset_url?: string;
      };
      desktop: {
        status: string;
        asset_name?: string;
        asset_url?: string;
      };
    };
    assert.equal(payload.latest_version, "0.1.5");
    assert.equal(payload.update_available, true);
    assert.match(payload.release_url, /\/releases\/tag\/v0\.1\.5$/);
    assert.equal(payload.cli.status, "update_available");
    assert.equal(payload.cli.asset_name, "agentmesh-0.1.5.tgz");
    assert.match(payload.cli.asset_url ?? "", /\/releases\/download\/v0\.1\.5\/agentmesh-0\.1\.5\.tgz$/);
    assert.equal(payload.desktop.status, "manual_update_available");
    assert.equal(payload.desktop.asset_name, "AgentMesh_0.1.5_aarch64.dmg");
    assert.match(payload.desktop.asset_url ?? "", /\/releases\/download\/v0\.1\.5\/AgentMesh_0\.1\.5_aarch64\.dmg$/);
  });
});

test("update install dry-run reports CLI command and Desktop manual download", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  await withReleaseServer(releasePayload("0.1.5"), async (releaseUrl) => {
    const cli = await runCliAsync(workspace, ["update", "install", "--target", "cli", "--dry-run", "--json"], {
      AGENTMESH_UPDATE_RELEASE_URL: releaseUrl,
    });
    assert.equal(cli.status, 0, cli.stderr);
    const cliPayload = JSON.parse(cli.stdout) as {
      target: string;
      status: string;
      command: string[];
    };
    assert.equal(cliPayload.target, "cli");
    assert.equal(cliPayload.status, "dry_run");
    assert.deepEqual(cliPayload.command, [
      "npm",
      "install",
      "-g",
      "https://example.invalid/agentmesh-0.1.5.tgz",
    ]);

    const desktop = await runCliAsync(workspace, ["update", "install", "--target", "desktop", "--dry-run", "--json"], {
      AGENTMESH_UPDATE_RELEASE_URL: releaseUrl,
    });
    assert.equal(desktop.status, 0, desktop.stderr);
    const desktopPayload = JSON.parse(desktop.stdout) as {
      target: string;
      status: string;
      asset_url: string;
      reason: string;
    };
    assert.equal(desktopPayload.target, "desktop");
    assert.equal(desktopPayload.status, "manual_download");
    assert.equal(desktopPayload.asset_url, "https://example.invalid/AgentMesh_0.1.5_aarch64.dmg");
    assert.match(desktopPayload.reason, /Desktop auto-update is not enabled/);
  });
});

test("update install dry-run reports current when the release is not newer", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  await withReleaseServer(releasePayload("0.1.4"), async (releaseUrl) => {
    const cli = await runCliAsync(workspace, ["update", "install", "--target", "cli", "--dry-run", "--json"], {
      AGENTMESH_UPDATE_RELEASE_URL: releaseUrl,
    });
    assert.equal(cli.status, 0, cli.stderr);
    const cliPayload = JSON.parse(cli.stdout) as {
      target: string;
      status: string;
      current_version: string;
    };
    assert.deepEqual(cliPayload, {
      target: "cli",
      status: "current",
      current_version: "0.1.4",
    });

    const desktop = await runCliAsync(workspace, ["update", "install", "--target", "desktop", "--dry-run", "--json"], {
      AGENTMESH_UPDATE_RELEASE_URL: releaseUrl,
    });
    assert.equal(desktop.status, 0, desktop.stderr);
    const desktopPayload = JSON.parse(desktop.stdout) as {
      target: string;
      status: string;
      current_version: string;
    };
    assert.deepEqual(desktopPayload, {
      target: "desktop",
      status: "current",
      current_version: "0.1.4",
    });
  });
});

async function withReleaseServer(
  payload: unknown,
  fn: (releaseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(payload));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as AddressInfo;
    await fn(`http://${address.address}:${address.port}/latest`);
  } finally {
    await closeServer(server);
  }
}

async function withReleasePageFallbackServer(
  version: string,
  fn: (urls: { apiReleaseUrl: string; webReleaseUrl: string }) => Promise<void>,
): Promise<void> {
  const server = createServer((request, response) => {
    if (request.url === "/api/releases/latest") {
      response.statusCode = 403;
      response.statusMessage = "rate limit exceeded";
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ message: "API rate limit exceeded" }));
      return;
    }
    if (request.url === "/releases/latest") {
      response.statusCode = 302;
      response.setHeader("location", `/releases/tag/v${version}`);
      response.end();
      return;
    }
    if (request.url === `/releases/tag/v${version}`) {
      response.setHeader("content-type", "text/html");
      response.end(`<title>Release v${version}</title>`);
      return;
    }
    response.statusCode = 404;
    response.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as AddressInfo;
    const origin = `http://${address.address}:${address.port}`;
    await fn({
      apiReleaseUrl: `${origin}/api/releases/latest`,
      webReleaseUrl: `${origin}/releases/latest`,
    });
  } finally {
    await closeServer(server);
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function releasePayload(version: string): unknown {
  return {
    tag_name: `v${version}`,
    html_url: `https://example.invalid/releases/tag/v${version}`,
    assets: [
      {
        name: `agentmesh-${version}.tgz`,
        browser_download_url: `https://example.invalid/agentmesh-${version}.tgz`,
        size: 100,
        state: "uploaded",
      },
      {
        name: `AgentMesh_${version}_aarch64.dmg`,
        browser_download_url: `https://example.invalid/AgentMesh_${version}_aarch64.dmg`,
        size: 200,
        state: "uploaded",
      },
    ],
  };
}
