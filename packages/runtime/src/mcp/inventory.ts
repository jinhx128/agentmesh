import {
  loadConfigWithSources,
  type ConfigSourceRef,
} from "../config.js";
import {
  listMcpResourceHints,
  mcpIngestionError,
  type McpResourceHint,
  type StdioMcpServerConfig,
} from "./client.js";

export interface McpInventoryOptions {
  hintLimit?: number;
  initializeTimeoutMs?: number;
  listTimeoutMs?: number;
}

export interface McpInventoryResourceHint extends McpResourceHint {
  source: "config" | "listed";
}

export interface McpInventoryServer {
  id: string;
  source_layer: ConfigSourceRef["source"] | null;
  source_path: string | null;
  command: string;
  args: string[];
  resource_hints: McpInventoryResourceHint[];
  list_error: string | null;
}

export interface McpInventoryReport {
  schema_version: 1;
  hint_limit: number;
  servers: McpInventoryServer[];
}

export async function buildMcpInventory(
  configPath?: string,
  options: McpInventoryOptions = {},
): Promise<McpInventoryReport> {
  const hintLimit = options.hintLimit ?? 50;
  const loaded = loadConfigWithSources(configPath);
  const servers: McpInventoryServer[] = [];
  for (const [id, config] of Object.entries(loaded.config.mcp_servers).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const source = loaded.mcpServerSources[id];
    const configuredHints = configuredResourceHints(config).slice(0, hintLimit);
    let listedHints: McpInventoryResourceHint[] = [];
    let listError: string | null = null;
    if (configuredHints.length < hintLimit) {
      try {
        listedHints = (
          await listMcpResourceHints(stdioConfig(config), {
            initializeTimeoutMs: options.initializeTimeoutMs,
            listTimeoutMs: options.listTimeoutMs,
            resourceHintLimit: hintLimit - configuredHints.length,
          })
        ).map((hint) => ({ ...hint, source: "listed" as const }));
      } catch (error) {
        listError = mcpIngestionError(error);
      }
    }
    servers.push({
      id,
      source_layer: source?.source ?? null,
      source_path: source?.path ?? null,
      command: config.command as string,
      args: configArgs(config),
      resource_hints: [...configuredHints, ...listedHints].slice(0, hintLimit),
      list_error: listError,
    });
  }
  return {
    schema_version: 1,
    hint_limit: hintLimit,
    servers,
  };
}

function configuredResourceHints(
  config: Record<string, unknown>,
): McpInventoryResourceHint[] {
  const hints = config.resource_hints;
  if (!Array.isArray(hints)) {
    return [];
  }
  return hints
    .filter((hint): hint is string => typeof hint === "string")
    .map((uri) => ({ uri, source: "config" }));
}

function stdioConfig(config: Record<string, unknown>): StdioMcpServerConfig {
  return {
    command: config.command as string,
    args: configArgs(config),
  };
}

function configArgs(config: Record<string, unknown>): string[] {
  return Array.isArray(config.args) ? config.args.filter(isString) : [];
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
