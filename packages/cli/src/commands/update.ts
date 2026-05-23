import { spawnSync } from "node:child_process";

import {
  checkAgentMeshUpdate,
  type AgentMeshUpdateReport,
} from "@agentmesh/runtime/src/update/check.js";
import { optionValue } from "../flags.js";

const CHECK_USAGE = "usage: agentmesh update check [--json]";
const INSTALL_USAGE = "usage: agentmesh update install --target <cli|desktop> [--dry-run] [--json]";

export async function updateCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;
  if (subcommand === "check") {
    return updateCheck(rest);
  }
  if (subcommand === "install") {
    return updateInstall(rest);
  }
  console.error("usage: agentmesh update <check|install>");
  return 2;
}

async function updateCheck(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const positional = args.filter((arg) => arg !== "--json");
  if (positional.length !== 0) {
    console.error(CHECK_USAGE);
    return 2;
  }
  const report = await checkAgentMeshUpdate();
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  printUpdateReport(report);
  return 0;
}

async function updateInstall(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const dryRun = args.includes("--dry-run");
  const target = optionValue(args, "--target");
  const allowed = new Set(["cli", "desktop"]);
  if (!target || !allowed.has(target)) {
    console.error(INSTALL_USAGE);
    return 2;
  }
  const positional = args.filter((arg, index) => {
    if (arg === "--json" || arg === "--dry-run") {
      return false;
    }
    if (arg === "--target" || args[index - 1] === "--target") {
      return false;
    }
    return true;
  });
  if (positional.length !== 0) {
    console.error(INSTALL_USAGE);
    return 2;
  }

  const report = await checkAgentMeshUpdate();
  if (target === "desktop") {
    return updateInstallDesktop(report, json);
  }
  return updateInstallCli(report, { dryRun, json });
}

function updateInstallCli(
  report: AgentMeshUpdateReport,
  options: { dryRun: boolean; json: boolean },
): number {
  if (report.cli.status === "current") {
    printInstallJsonOrText({
      json: options.json,
      payload: {
        target: "cli",
        status: "current",
        current_version: report.current_version,
      },
      text: `CLI is already current: ${report.current_version}`,
    });
    return 0;
  }
  const command = report.cli.install_command;
  if (!command || !report.cli.asset_url) {
    console.error(report.cli.reason ?? "No CLI update asset is available.");
    return 1;
  }
  if (options.dryRun) {
    printInstallJsonOrText({
      json: options.json,
      payload: {
        target: "cli",
        status: "dry_run",
        command,
      },
      text: `CLI update command: ${command.join(" ")}`,
    });
    return 0;
  }
  const result = spawnSync(command[0], command.slice(1), { stdio: "inherit" });
  const exitCode = result.status ?? 1;
  if (options.json) {
    console.log(JSON.stringify({
      target: "cli",
      status: exitCode === 0 ? "installed" : "failed",
      command,
      exit_code: exitCode,
    }, null, 2));
  }
  return exitCode;
}

function updateInstallDesktop(
  report: AgentMeshUpdateReport,
  json: boolean,
): number {
  if (report.desktop.status === "current") {
    printInstallJsonOrText({
      json,
      payload: {
        target: "desktop",
        status: "current",
        current_version: report.current_version,
      },
      text: `Desktop is already current: ${report.current_version}`,
    });
    return 0;
  }
  if (!report.desktop.asset_url) {
    console.error(report.desktop.reason ?? "No Desktop update asset is available.");
    return 1;
  }
  const payload = {
    target: "desktop",
    status: "manual_download",
    asset_name: report.desktop.asset_name,
    asset_url: report.desktop.asset_url,
    reason: report.desktop.reason,
  };
  printInstallJsonOrText({
    json,
    payload,
    text: [
      `Desktop update: ${report.desktop.asset_url}`,
      report.desktop.reason ?? "Download and install the Desktop DMG manually.",
    ].join("\n"),
  });
  return 0;
}

function printUpdateReport(report: AgentMeshUpdateReport): void {
  console.log(`AgentMesh ${report.current_version}`);
  console.log(`Latest ${report.latest_version}`);
  console.log(report.update_available ? "Update available" : "Already current");
  if (report.cli.install_command) {
    console.log(`CLI: ${report.cli.install_command.join(" ")}`);
  } else if (report.cli.reason) {
    console.log(`CLI: ${report.cli.reason}`);
  }
  if (report.desktop.asset_url) {
    console.log(`Desktop: ${report.desktop.asset_url}`);
  } else if (report.desktop.reason) {
    console.log(`Desktop: ${report.desktop.reason}`);
  }
}

function printInstallJsonOrText(input: {
  json: boolean;
  payload: unknown;
  text: string;
}): void {
  if (input.json) {
    console.log(JSON.stringify(input.payload, null, 2));
    return;
  }
  console.log(input.text);
}
