import { listAdapters } from "@agentmesh/runtime/src/adapters.js";
import {
  createAgentRegistration,
  deleteAgentRegistration,
  setAgentRegistrationEnabled,
  updateAgentRegistration,
  type AgentLifecycleRuntimeResult,
} from "@agentmesh/runtime/src/agents/lifecycle.js";
import { listAgents as listSdkAgents } from "@agentmesh/sdk";
import { optionalInteger, optionValue, optionValues, positionalArgs } from "../flags.js";

const AGENTS_ADD_USAGE = "usage: agentmesh agents add --adapter <adapter> --model <model-or-alias> [--timeout-seconds <n>] [--skip-verify]";
const AGENTS_UPDATE_USAGE = "usage: agentmesh agents update <agent-id> [--adapter <adapter>] [--model <model-or-alias>] [--timeout-seconds <n>] [--skip-verify] [--reasoning-effort <value>] [--capability <capability> ...] [--label <label>]";

export function agentsList(args: string[], configPath?: string): number {
  const json = args.includes("--json");
  const positional = args.filter((arg) => arg !== "--json");
  if (positional.length !== 0) {
    console.error("usage: agentmesh agents list [--json]");
    return 2;
  }
  const sortedAgents = listSdkAgents({ configPath, cwd: process.cwd() });
  if (json) {
    console.log(JSON.stringify(sortedAgents, null, 2));
    return 0;
  }
  for (const agent of sortedAgents) {
    const capabilities = agent.capabilities.length ? agent.capabilities.join(",") : "-";
    const details = [`status=${agent.status}`];
    if (agent.model) {
      details.push(`model=${agent.model}`);
    }
    if (agent.reasoning_effort) {
      details.push(`reasoning=${agent.reasoning_effort}`);
    }
    console.log(`${agent.id}\t${agent.label}\t${capabilities}\t${details.join("\t")}`);
  }
  return 0;
}

export function agentsShow(args: string[], configPath?: string): number {
  const json = args.includes("--json");
  const positional = positionalArgs(args.filter((arg) => arg !== "--json"));
  const agentId = positional[0];
  if (!agentId || positional.length !== 1) {
    console.error("usage: agentmesh agents show <agent-id> [--json]");
    return 2;
  }
  const agent = listSdkAgents({ configPath, cwd: process.cwd() }).find((candidate) => candidate.id === agentId);
  if (!agent) {
    console.error(`agent not found: ${agentId}`);
    return 1;
  }
  if (json) {
    console.log(JSON.stringify(agent, null, 2));
    return 0;
  }
  const capabilities = agent.capabilities.length ? agent.capabilities.join(",") : "-";
  console.log(`id=${agent.id}`);
  console.log(`label=${agent.label}`);
  console.log(`adapter=${agent.adapter}`);
  console.log(`status=${agent.status}`);
  console.log(`capabilities=${capabilities}`);
  return 0;
}

export function agentsAdd(args: string[], configPath?: string): number {
  if (rejectScope(args)) {
    return 2;
  }
  const positional = positionalArgs(args);
  const adapter = optionValue(args, "--adapter");
  const model = optionValue(args, "--model");
  if (!adapter || !model) {
    console.error(AGENTS_ADD_USAGE);
    return 2;
  }
  if (positional.length !== 0) {
    console.error(AGENTS_ADD_USAGE);
    return 2;
  }
  return printLifecycleResult(createAgentRegistration({
    adapter,
    model,
    label: optionValue(args, "--label"),
    capabilities: optionValues(args, "--capability"),
    reasoningEffort: optionValue(args, "--reasoning-effort"),
    timeoutSeconds: optionalInteger(args, "--timeout-seconds"),
    skipVerify: args.includes("--skip-verify"),
  }, { configPath, cwd: process.cwd() }));
}

export function agentsUpdate(args: string[], configPath?: string): number {
  if (rejectScope(args)) {
    return 2;
  }
  const positional = positionalArgs(args);
  const agentId = positional[0];
  if (!agentId || positional.length !== 1) {
    console.error(AGENTS_UPDATE_USAGE);
    return 2;
  }
  return printLifecycleResult(updateAgentRegistration(agentId, {
    ...(optionValue(args, "--adapter") ? { adapter: optionValue(args, "--adapter") } : {}),
    ...(optionValue(args, "--model") ? { model: optionValue(args, "--model") } : {}),
    ...(optionValue(args, "--label") ? { label: optionValue(args, "--label") } : {}),
    ...(args.includes("--capability") ? { capabilities: optionValues(args, "--capability") } : {}),
    ...(optionValue(args, "--reasoning-effort") ? { reasoningEffort: optionValue(args, "--reasoning-effort") } : {}),
    ...(optionalInteger(args, "--timeout-seconds") !== undefined ? { timeoutSeconds: optionalInteger(args, "--timeout-seconds") } : {}),
    skipVerify: args.includes("--skip-verify"),
  }, { configPath, cwd: process.cwd() }));
}

export function agentsRemove(args: string[]): number {
  if (rejectScope(args)) {
    return 2;
  }
  const positional = positionalArgs(args);
  const agentId = positional[0];
  if (!agentId || positional.length !== 1) {
    console.error("usage: agentmesh agents remove <agent-id>");
    return 2;
  }
  return printLifecycleResult(deleteAgentRegistration(agentId, { cwd: process.cwd() }));
}

export function agentsEnable(args: string[]): number {
  return setAgentEnabled(args, true, "enable");
}

export function agentsDisable(args: string[]): number {
  return setAgentEnabled(args, false, "disable");
}

export function adaptersList(args: string[]): number {
  if (args.length !== 0) {
    console.error("usage: agentmesh adapters list");
    return 2;
  }
  for (const adapter of listAdapters()) {
    console.log(`${adapter.name}\t${adapter.description}`);
  }
  return 0;
}

function setAgentEnabled(args: string[], enabled: boolean, command: "enable" | "disable"): number {
  if (rejectScope(args)) {
    return 2;
  }
  const positional = positionalArgs(args);
  const agentId = positional[0];
  if (!agentId || positional.length !== 1) {
    console.error(`usage: agentmesh agents ${command} <agent-id>`);
    return 2;
  }
  return printLifecycleResult(setAgentRegistrationEnabled(agentId, enabled, { cwd: process.cwd() }));
}

function rejectScope(args: string[]): boolean {
  if (!args.includes("--scope")) {
    return false;
  }
  console.error("agents are global user-level resources; --scope is not supported");
  return true;
}

function printLifecycleResult(result: AgentLifecycleRuntimeResult): number {
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  return result.exitCode;
}
