import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const cliPath = fileURLToPath(new URL("../../packages/cli/src/cli.js", import.meta.url));
export const fakeServerPath = fileURLToPath(
  new URL("../fixtures/mcp/fake-server.js", import.meta.url),
);

export function makeWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "agentmesh-write-side-"));
  mkdirSync(path.join(workspace, ".home"), { recursive: true });
  return workspace;
}

export function runCli(
  workspace: string,
  args: string[],
  envOverrides: NodeJS.ProcessEnv = {},
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
    encoding: "utf-8",
    env,
  });
}

export function writeExecutable(filePath: string, content: string): void {
  writeFileSync(filePath, content);
  chmodSync(filePath, 0o755);
}

export function writeConfig(workspace: string, agents: string): string {
  const configPath = path.join(workspace, "agentmesh.toml");
  const userConfigPath = path.join(workspace, ".home", ".config", "agentmesh", "config.toml");
  const split = splitUserResourceTables(agents);
  mkdirSync(path.dirname(userConfigPath), { recursive: true });
  writeFileSync(userConfigPath, "schema_version = 1\n\n" + split.user);
  writeFileSync(configPath, "schema_version = 1\n\n" + split.project);
  return configPath;
}

function splitUserResourceTables(content: string): { user: string; project: string } {
  const user: string[] = [];
  const project: string[] = [];
  let target = project;
  for (const line of content.split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+)\]/.exec(line);
    if (header) {
      const table = header[1].trim();
      target = table.startsWith("agents.") || table.startsWith("mcp_servers.")
        ? user
        : project;
    }
    target.push(line);
  }
  return {
    user: trimConfigFragment(user),
    project: trimConfigFragment(project),
  };
}

function trimConfigFragment(lines: string[]): string {
  return `${lines.join("\n").trim()}\n`;
}

export function workflowHash(filePath: string): string {
  return "sha256:" + createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function writeRunMutationLock(
  runDir: string,
  operation: string,
  expiresAt: Date,
): string {
  const lockDir = path.join(runDir, ".agentmesh.lock");
  mkdirSync(lockDir, { recursive: true });
  writeFileSync(
    path.join(lockDir, "lease.json"),
    JSON.stringify(
      {
        schema_version: 1,
        operation,
        pid: 12345,
        created_at: new Date(Date.now() - 1000).toISOString(),
        expires_at: expiresAt.toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
  return lockDir;
}
