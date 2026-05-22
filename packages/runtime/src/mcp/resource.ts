export interface McpResourceSpec {
  raw: string;
  serverId: string;
  resourceUri: string;
}

const SERVER_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
export const MAX_MCP_RESOURCES_PER_RUN = 10;

export function parseMcpResourceSpecs(values: string[]): McpResourceSpec[] {
  return values.map((value) => parseMcpResourceSpec(value));
}

export function isValidMcpServerId(value: string): boolean {
  return SERVER_ID_PATTERN.test(value);
}

export function assertMcpResourceServersConfigured(
  specs: McpResourceSpec[],
  config: { mcp_servers: Record<string, unknown> },
): void {
  for (const spec of specs) {
    if (!Object.hasOwn(config.mcp_servers, spec.serverId)) {
      throw new Error(
        `unknown MCP server id: ${spec.serverId}; add [mcp_servers.${spec.serverId}] to ~/.config/agentmesh/config.toml or explicit overlay`,
      );
    }
  }
}

export function assertMcpResourceCount(
  specs: McpResourceSpec[],
  maxResources = MAX_MCP_RESOURCES_PER_RUN,
): void {
  if (specs.length > maxResources) {
    throw new Error(
      `at most ${maxResources} MCP resources can be requested per run; got ${specs.length}`,
    );
  }
}

export function parseMcpResourceSpec(value: string): McpResourceSpec {
  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    throw invalidMcpResourceSpec(value);
  }
  const serverId = value.slice(0, separatorIndex);
  const resourceUri = value.slice(separatorIndex + 1);
  if (!isValidMcpServerId(serverId) || resourceUri.trim() !== resourceUri) {
    throw invalidMcpResourceSpec(value);
  }
  return {
    raw: value,
    serverId,
    resourceUri,
  };
}

function invalidMcpResourceSpec(value: string): Error {
  return new Error(
    `--mcp-resource must be <server-id>:<resource-uri>; got ${JSON.stringify(value)}`,
  );
}
