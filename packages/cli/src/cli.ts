#!/usr/bin/env node
import {
  adaptersList,
  agentsAdd,
  agentsDisable,
  agentsEnable,
  agentsList,
  agentsRemove,
  agentsShow,
  agentsUpdate,
} from "./commands/agents.js";
import { call } from "./commands/call.js";
import { callsAdopt } from "./commands/calls.js";
import { cliDetect } from "./commands/cli-detect.js";
import { correctionAdd, correctionList, correctionSupersede } from "./commands/correction.js";
import { doctor } from "./commands/doctor.js";
import {
  flowAttach,
  flowDispatch,
  flowEventsCommand,
  flowPrompt,
  flowResume,
  flowRetry,
  flowRun,
  flowStatusCommand,
  workflowRun,
} from "./commands/flow.js";
import { init } from "./commands/init.js";
import { mcpAdd, mcpInventory, mcpList, mcpRemove } from "./commands/mcp.js";
import {
  packetArtifacts,
  packetCompatibility,
  packetEvents,
  packetStatus,
  packetValidate,
} from "./commands/packet.js";
import {
  presetAdd,
  presetDoctor,
  presetInit,
  presetList,
  presetRemove,
  presetShow,
  presetUpdate,
} from "./commands/preset.js";
import { releaseCheckSummary } from "./commands/release-check.js";
import { reviewersList } from "./commands/reviewers.js";
import { sessionsCommand } from "./commands/sessions.js";
import { skillExport, skillInstall, skillShow, skillVerify } from "./commands/skill.js";
import { specCheck } from "./commands/spec.js";
import { studio } from "./commands/studio.js";
import { updateCommand } from "./commands/update.js";
import { versionCommand } from "./commands/version.js";
import { workspacesCommand } from "./commands/workspaces.js";
import { workflowsAdd, workflowsList, workflowsRemove, workflowsShow, workflowsUpdate } from "./commands/workflows.js";
import { parseGlobalArgs } from "./flags.js";

const HELP_FLAGS = new Set(["--help", "-h"]);

const COMMAND_USAGE_LINES = [
  "--version",
  "version [--json]",
  "help [command]",
  "init [--output <path>] [--force]",
  "agents list [--json]",
  "agents show <agent-id> [--json]",
  "agents add --adapter <adapter> --model <model-or-alias> [--timeout-seconds <n>] [--skip-verify] [--reasoning-effort <value>] [--capability <capability> ...] [--label <label>]",
  "agents update <agent-id> [--adapter <adapter>] [--model <model-or-alias>] [--timeout-seconds <n>] [--skip-verify] [--reasoning-effort <value>] [--capability <capability> ...] [--label <label>]",
  "agents remove <agent-id>",
  "agents enable <agent-id>",
  "agents disable <agent-id>",
  "adapters list",
  "call --agent <agent-id> [--prompt <text>] [--prompt-file <path>] [--output-file <path>] [--timeout-secs <n>] [--purpose <purpose>] [--title <title>] [--no-record]",
  "cli detect [--json]",
  "calls adopt <call-id> --status accepted|rejected|superseded [--entrypoint <name>] [--reason <text>] [--related-commit <commit>] [--related-run-id <run-id>] [--superseded-by-call-id <call-id>] [--json]",
  "workspaces list [--json]",
  "workspaces add <path> [--label <label>] [--json]",
  "workspaces enable <workspace-id> [--json]",
  "workspaces disable <workspace-id> [--json]",
  "correction add --scope <scope> --statement <text> [--id <id>] [--source <source>] [--owner <owner>] [--json]",
  "correction list [--status <active|superseded>] [--scope <scope>] [--json]",
  "correction supersede <correction-id> --statement <text> [--scope <scope>] [--id <replacement-id>] [--source <source>] [--owner <owner>] [--json]",
  "run [--workflow <id>|--workflow-file <path>] --plan <id> --execute <id> [--verify <id>] --review <id> --decide <id> --task <text> [--task-file <path>] [--title <title>] [--run-id <id>] [--timeout-seconds <n>] [--review-session-mode <auto|interactive_continuous|independent>] [--host-kind <host-kind>] [--conversation-scope <amscope_v1:uuid>] [--user-gate] [--context-file <path> ...] [--diff-file <path>] [--verification-file <path>] [--scope <pathspec> ...] [--mcp-resource <server-id>:<resource-uri> ...] [--include-spec] [--exclude-correction <id> ...]",
  "flow run [--workflow <id>|--workflow-file <path>] --plan <id> --execute <id> [--verify <id>] --review <id> --decide <id> --task <text> [--task-file <path>] [--title <title>] [--run-id <id>] [--timeout-seconds <n>] [--review-session-mode <auto|interactive_continuous|independent>] [--host-kind <host-kind>] [--conversation-scope <amscope_v1:uuid>] [--user-gate] [--context-file <path> ...] [--diff-file <path>] [--verification-file <path>] [--scope <pathspec> ...] [--mcp-resource <server-id>:<resource-uri> ...] [--include-spec] [--exclude-correction <id> ...]",
  "flow dispatch <run> --stage <stage|all> [--timeout-secs <n>]",
  "flow retry <run> [--stage <stage>] [--timeout-secs <n>]",
  "flow resume <run> [--stage <stage>] [--timeout-secs <n>]",
  "flow status <run> [--json]",
  "flow events <run> [--json]",
  "flow prompt <run> --stage <stage>",
  "flow attach <run> --stage <stage> [--text <text>|--file <path>] [--agent <id-or-current>]",
  "packet validate <run> [--json]",
  "packet compatibility [--json]",
  "packet status <run> [--json]",
  "packet events <run> [--json]",
  "packet artifacts <run> [--json]",
  "preset list [--json]",
  "preset show <preset-id> [--json]",
  "preset init --workflow <workflow-id>",
  "preset add <preset-file>",
  "preset update <preset-id> <preset-file>",
  "preset remove <preset-id>",
  "preset doctor <preset-id> [--json]",
  "workflows list [--json]",
  "workflows show <workflow-id> [--json]",
  "workflows add <workflow-file>",
  "workflows update <workflow-id> <workflow-file>",
  "workflows remove <workflow-id>",
  "mcp list [--json]",
  "mcp add <server-id> --command <command> [--arg <arg> ...] [--resource-hint <uri> ...]",
  "mcp remove <server-id>",
  "mcp inventory [--json]",
  "release-check summary <run> [--write] [--json]",
  "reviewers list [--json]",
  "sessions scope create --host <host> [--json]",
  "sessions list [--json]",
  "sessions inspect <session-ref> [--json]",
  "sessions close <session-ref> [--json]",
  "sessions close --scope <scope-ref> [--json]",
  "sessions purge --expired [--json]",
  "doctor [--agent <agent-id> ...] [--skip-auth-probe] [--probe-timeout-secs <n>] [--json]",
  "skill show",
  "skill export [--format markdown]",
  "skill install --target <host> [--force]",
  "skill verify --target <host> [--json]",
  "spec check [--path <path>] [--json]",
  "studio [--host <host>] [--port <port>] [--workspace <path>] [--no-open]",
  "update check [--json]",
  "update install --target <cli|desktop> [--dry-run] [--json]",
];

const COMMAND_HELP_TOPICS = Array.from(new Set(COMMAND_USAGE_LINES.flatMap((line) => {
  const words = commandWordsFromUsage(line);
  return words.map((_, index) => words.slice(0, index + 1).join(" "));
}))).sort((left, right) => right.split(" ").length - left.split(" ").length);

async function main(argv = process.argv.slice(2)): Promise<number> {
  const parsed = parseGlobalArgs(argv);
  const [command, subcommand, ...rest] = parsed.args;
  try {
    const helpTopic = helpTopicFromArgs(parsed.args);
    if (helpTopic) {
      return printHelp(helpTopic);
    }
    if (command === "--version" || command === "-v") {
      return versionCommand([]);
    }
    if (command === "version") {
      return versionCommand([subcommand, ...rest].filter((arg): arg is string => Boolean(arg)));
    }
    if (command === "init") {
      return init([subcommand, ...rest].filter((arg): arg is string => Boolean(arg)));
    }
    if (command === "agents" && subcommand === "list") {
      return agentsList(rest, parsed.configPath);
    }
    if (command === "agents" && subcommand === "show") {
      return agentsShow(rest, parsed.configPath);
    }
    if (command === "agents" && subcommand === "add") {
      return agentsAdd(rest, parsed.configPath);
    }
    if (command === "agents" && subcommand === "update") {
      return agentsUpdate(rest, parsed.configPath);
    }
    if (command === "agents" && subcommand === "remove") {
      return agentsRemove(rest);
    }
    if (command === "agents" && subcommand === "enable") {
      return agentsEnable(rest);
    }
    if (command === "agents" && subcommand === "disable") {
      return agentsDisable(rest);
    }
    if (command === "adapters" && subcommand === "list") {
      return adaptersList(rest);
    }
    if (command === "call") {
      return call([subcommand, ...rest].filter((arg): arg is string => Boolean(arg)), parsed.configPath);
    }
    if (command === "cli" && subcommand === "detect") {
      return cliDetect(rest);
    }
    if (command === "calls" && subcommand === "adopt") {
      return callsAdopt(rest);
    }
    if (command === "workspaces") {
      return workspacesCommand([subcommand, ...rest].filter((arg): arg is string => Boolean(arg)));
    }
    if (command === "correction" && subcommand === "add") {
      return correctionAdd(rest);
    }
    if (command === "correction" && subcommand === "list") {
      return correctionList(rest);
    }
    if (command === "correction" && subcommand === "supersede") {
      return correctionSupersede(rest);
    }
    if (command === "run") {
      return workflowRun(
        [subcommand, ...rest].filter((arg): arg is string => Boolean(arg)),
        parsed.configPath,
      );
    }
    if (command === "flow" && subcommand === "run") {
      return flowRun(rest, parsed.configPath);
    }
    if (command === "flow" && subcommand === "dispatch") {
      return flowDispatch(rest, parsed.configPath);
    }
    if (command === "flow" && subcommand === "retry") {
      return flowRetry(rest, parsed.configPath);
    }
    if (command === "flow" && subcommand === "resume") {
      return flowResume(rest, parsed.configPath);
    }
    if (command === "flow" && subcommand === "status") {
      return flowStatusCommand(rest);
    }
    if (command === "flow" && subcommand === "events") {
      return flowEventsCommand(rest);
    }
    if (command === "flow" && subcommand === "prompt") {
      return flowPrompt(rest);
    }
    if (command === "flow" && subcommand === "attach") {
      return flowAttach(rest);
    }
    if (command === "packet" && subcommand === "validate") {
      return packetValidate(rest);
    }
    if (command === "packet" && subcommand === "compatibility") {
      return packetCompatibility(rest);
    }
    if (command === "packet" && subcommand === "status") {
      return packetStatus(rest);
    }
    if (command === "packet" && subcommand === "events") {
      return packetEvents(rest);
    }
    if (command === "packet" && subcommand === "artifacts") {
      return packetArtifacts(rest);
    }
    if (command === "preset" && subcommand === "list") {
      return presetList(rest, parsed.configPath);
    }
    if (command === "preset" && subcommand === "show") {
      return presetShow(rest, parsed.configPath);
    }
    if (command === "preset" && subcommand === "init") {
      return presetInit(rest, parsed.configPath);
    }
    if (command === "preset" && subcommand === "add") {
      return presetAdd(rest, parsed.configPath);
    }
    if (command === "preset" && subcommand === "update") {
      return presetUpdate(rest, parsed.configPath);
    }
    if (command === "preset" && subcommand === "remove") {
      return presetRemove(rest, parsed.configPath);
    }
    if (command === "preset" && subcommand === "doctor") {
      return presetDoctor(rest, parsed.configPath);
    }
    if (command === "workflows" && subcommand === "list") {
      return workflowsList(rest, parsed.configPath);
    }
    if (command === "workflows" && subcommand === "show") {
      return workflowsShow(rest, parsed.configPath);
    }
    if (command === "workflows" && subcommand === "add") {
      return workflowsAdd(rest, parsed.configPath);
    }
    if (command === "workflows" && subcommand === "update") {
      return workflowsUpdate(rest, parsed.configPath);
    }
    if (command === "workflows" && subcommand === "remove") {
      return workflowsRemove(rest, parsed.configPath);
    }
    if (command === "mcp" && subcommand === "inventory") {
      return await mcpInventory(rest, parsed.configPath);
    }
    if (command === "mcp" && subcommand === "list") {
      return mcpList(rest, parsed.configPath);
    }
    if (command === "mcp" && subcommand === "add") {
      return mcpAdd(rest, parsed.configPath);
    }
    if (command === "mcp" && subcommand === "remove") {
      return mcpRemove(rest);
    }
    if (command === "release-check" && subcommand === "summary") {
      return releaseCheckSummary(rest);
    }
    if (command === "reviewers" && subcommand === "list") {
      return reviewersList(rest, parsed.configPath);
    }
    if (command === "sessions") {
      return sessionsCommand([subcommand, ...rest].filter((arg): arg is string => Boolean(arg)));
    }
    if (command === "doctor") {
      return doctor([subcommand, ...rest].filter((arg): arg is string => Boolean(arg)), parsed.configPath);
    }
    if (command === "skill" && subcommand === "show") {
      return skillShow(rest);
    }
    if (command === "skill" && subcommand === "export") {
      return skillExport(rest);
    }
    if (command === "skill" && subcommand === "install") {
      return skillInstall(rest);
    }
    if (command === "skill" && subcommand === "verify") {
      return skillVerify(rest);
    }
    if (command === "spec" && subcommand === "check") {
      return specCheck(rest);
    }
    if (command === "studio") {
      return await studio([subcommand, ...rest].filter((arg): arg is string => Boolean(arg)), parsed.configPath);
    }
    if (command === "update") {
      return await updateCommand([subcommand, ...rest].filter((arg): arg is string => Boolean(arg)));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  usage();
  return 2;
}

function usage(): void {
  console.error(
    [
      "usage: agentmesh [--config <path>] <command>",
      "commands:",
      ...COMMAND_USAGE_LINES.map((line) => `  ${line}`),
    ].join("\n"),
  );
}

function helpTopicFromArgs(args: string[]): string[] | undefined {
  if (args.length === 0) {
    return undefined;
  }
  if (args[0] === "help") {
    return helpTopicFromTokens(args.slice(1).filter((arg) => !HELP_FLAGS.has(arg)));
  }
  const helpIndex = args.findIndex((arg) => HELP_FLAGS.has(arg));
  if (helpIndex === -1) {
    return undefined;
  }
  return helpTopicFromTokens(args.slice(0, helpIndex));
}

function commandWordsFromUsage(line: string): string[] {
  const tokens = line.split(/\s+/).filter(Boolean);
  if (tokens[0]?.startsWith("--")) {
    return [tokens[0]];
  }
  const words: string[] = [];
  for (const token of tokens) {
    if (token.startsWith("[") || token.startsWith("<") || token.startsWith("--")) {
      break;
    }
    words.push(token);
  }
  return words;
}

function helpTopicFromTokens(tokens: string[]): string[] {
  if (tokens.length === 0) {
    return [];
  }
  const candidates = new Set(tokens.map((_, index) => tokens.slice(0, index + 1).join(" ")));
  const match = COMMAND_HELP_TOPICS.find((topic) => candidates.has(topic));
  if (match) {
    return match.split(" ");
  }
  const firstOptionIndex = tokens.findIndex((arg) => arg.startsWith("-"));
  return firstOptionIndex > 0 ? tokens.slice(0, firstOptionIndex) : tokens;
}

function printHelp(topicParts: string[]): number {
  if (topicParts.length === 0) {
    usage();
    return 0;
  }
  const topic = topicParts.join(" ");
  const matches = COMMAND_USAGE_LINES.filter((line) => line === topic
    || line.startsWith(`${topic} `)
    || line.startsWith(`${topic} [`));
  if (matches.length === 0) {
    console.error(`unknown help topic: ${topic}`);
    usage();
    return 2;
  }
  if (matches.length === 1) {
    console.error(`usage: agentmesh ${matches[0]}`);
    return 0;
  }
  console.error([
    `usage: agentmesh ${topic} <command>`,
    "commands:",
    ...matches.map((line) => `  ${line}`),
  ].join("\n"));
  return 0;
}

process.exitCode = await main();
