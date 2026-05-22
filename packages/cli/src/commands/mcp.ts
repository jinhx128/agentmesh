import { buildMcpInventory } from "@agentmesh/runtime/src/mcp/inventory.js";
import {
  appendMcpServerRegistration,
  configPathForMcpWrite,
  loadConfigWithSources,
  removeMcpServerRegistration,
  type ConfigSourceRef,
} from "@agentmesh/runtime/src/config.js";
import { optionValue, optionValues, positionalArgs } from "../flags.js";

const MCP_ADD_USAGE = "usage: agentmesh mcp add <server-id> --command <command> [--arg <arg> ...] [--resource-hint <uri> ...]";

export async function mcpInventory(args: string[], configPath?: string): Promise<number> {
  const json = args.includes("--json");
  const positional = args.filter((arg) => arg !== "--json");
  if (positional.length !== 0) {
    console.error("usage: agentmesh mcp inventory [--json]");
    return 2;
  }
  const report = await buildMcpInventory(configPath);
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  for (const server of report.servers) {
    console.log(`${server.id}\t${server.command}`);
    if (server.list_error) {
      console.log(`  list_error: ${server.list_error}`);
    }
    for (const hint of server.resource_hints) {
      const label = hint.name ? `\t${hint.name}` : "";
      console.log(`  - ${hint.source}\t${hint.uri}${label}`);
    }
  }
  if (report.servers.length === 0) {
    console.log("No MCP servers configured");
  }
  return 0;
}

export interface McpListDiagnostic {
  classification: string;
  message: string;
  hint: string;
}

export interface McpListServer {
  id: string;
  source_layer: ConfigSourceRef["source"] | null;
  source_path: string | null;
  command: string;
  args: string[];
  resource_hints: string[];
  diagnostics: McpListDiagnostic[];
}

export interface McpListReport {
  schema_version: 1;
  servers: McpListServer[];
  diagnostics: McpListDiagnostic[];
}

export function mcpList(args: string[], configPath?: string): number {
  const json = args.includes("--json");
  const unsupported = unsupportedFlags(args, new Set(["--json"]));
  const positional = args.filter((arg) => arg !== "--json" && !arg.startsWith("--"));
  if (unsupported.length !== 0 || positional.length !== 0) {
    console.error("usage: agentmesh mcp list [--json]");
    return 2;
  }
  const report = buildMcpListReport(configPath);
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  for (const diagnostic of report.diagnostics) {
    console.log(`Diagnostic: ${diagnostic.classification}: ${diagnostic.message}`);
    console.log(`  hint: ${diagnostic.hint}`);
  }
  for (const server of report.servers) {
    console.log(`${server.id}\t${server.command}`);
    if (server.args.length) {
      console.log(`  args: ${server.args.join(" ")}`);
    }
    for (const hint of server.resource_hints) {
      console.log(`  resource_hint: ${hint}`);
    }
  }
  if (report.servers.length === 0) {
    console.log("No MCP servers configured");
  }
  return 0;
}

export function mcpAdd(args: string[], configPath?: string): number {
  if (rejectScope(args)) {
    return 2;
  }
  const unsupported = unsupportedFlags(
    args,
    new Set(["--command", "--arg", "--resource-hint"]),
    new Set(["--command", "--arg", "--resource-hint"]),
  );
  const positional = positionalArgs(args);
  const serverId = positional[0];
  const command = requiredOptionValue(args, "--command");
  if (unsupported.length !== 0 || !serverId || positional.length !== 1 || !command) {
    console.error(MCP_ADD_USAGE);
    return 2;
  }
  const existingServers = loadExistingMcpServersForDuplicateCheck(configPath);
  if (Object.hasOwn(existingServers, serverId)) {
    console.error(`mcp server id already exists: ${serverId}`);
    return 1;
  }
  const targetConfigPath = configPathForMcpWrite();
  appendMcpServerRegistration(targetConfigPath, {
    serverId,
    command,
    args: optionValues(args, "--arg"),
    resourceHints: optionValues(args, "--resource-hint"),
  });
  console.log(`Added MCP server: ${serverId}`);
  console.log(`Config: ${targetConfigPath}`);
  return 0;
}

function loadExistingMcpServersForDuplicateCheck(configPath?: string): Record<string, unknown> {
  try {
    return loadConfigWithSources(configPath).config.mcp_servers;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("no config found; searched:")) {
      return {};
    }
    throw error;
  }
}

export function mcpRemove(args: string[]): number {
  if (rejectScope(args)) {
    return 2;
  }
  const unsupported = unsupportedFlags(args, new Set());
  const positional = positionalArgs(args);
  const serverId = positional[0];
  if (unsupported.length !== 0 || !serverId || positional.length !== 1) {
    console.error("usage: agentmesh mcp remove <server-id>");
    return 2;
  }
  const configPath = configPathForMcpWrite();
  try {
    removeMcpServerRegistration(configPath, serverId);
  } catch (error) {
    if (error instanceof Error && error.message === `mcp server not found: ${serverId}`) {
      throw new Error(`mcp server not found in user config: ${serverId}`);
    }
    throw error;
  }
  console.log(`Removed MCP server: ${serverId}`);
  console.log(`Config: ${configPath}`);
  return 0;
}

function buildMcpListReport(configPath?: string): McpListReport {
  try {
    const loaded = loadConfigWithSources(configPath);
    const servers = Object.entries(loaded.config.mcp_servers)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, config]) => {
        const source = loaded.mcpServerSources[id];
        return {
          id,
          source_layer: source?.source ?? null,
          source_path: source?.path ?? null,
          command: config.command as string,
          args: stringList(config.args),
          resource_hints: stringList(config.resource_hints),
          diagnostics: [],
        };
      });
    return { schema_version: 1, servers, diagnostics: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("no config found; searched:")) {
      return { schema_version: 1, servers: [], diagnostics: [] };
    }
    return {
      schema_version: 1,
      servers: [],
      diagnostics: [mcpListDiagnostic(message)],
    };
  }
}

function mcpListDiagnostic(message: string): McpListDiagnostic {
  if (message.includes("duplicate mcp_servers id")) {
    return {
      classification: "duplicate_mcp_server_id",
      message,
      hint: "Rename one MCP server id or remove the duplicate from one config layer.",
    };
  }
  if (message.includes("invalid agentmesh TOML")) {
    return {
      classification: "malformed_config_layer",
      message,
      hint: "Fix the TOML syntax in the reported config layer.",
    };
  }
  return {
    classification: "config_layer_error",
    message,
    hint: "Check MCP server entries in the referenced AgentMesh config layer.",
  };
}

function requiredOptionValue(args: string[], name: string): string | undefined {
  const value = optionValue(args, name);
  return value && !value.startsWith("--") ? value : undefined;
}

function rejectScope(args: string[]): boolean {
  if (!args.includes("--scope")) {
    return false;
  }
  console.error("MCP servers are global user-level resources; --scope is not supported");
  return true;
}

function unsupportedFlags(
  args: string[],
  allowed: Set<string>,
  optionsWithValues: Set<string> = new Set(),
): string[] {
  const unsupported: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    if (!allowed.has(arg)) {
      unsupported.push(arg);
    }
    if (optionsWithValues.has(arg)) {
      index += 1;
    }
  }
  return unsupported;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
