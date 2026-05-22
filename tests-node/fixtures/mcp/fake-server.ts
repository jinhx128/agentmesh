import { appendFileSync } from "node:fs";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

const server = new McpServer(
  { name: "fake-mcp", version: "0.0.0" },
  {
    capabilities: {
      resources: {},
    },
  },
);

if (process.env.AGENTMESH_FAKE_MCP_STDERR) {
  process.stderr.write(`${process.env.AGENTMESH_FAKE_MCP_STDERR}\n`);
}

server.server.oninitialized = () => {
  log("initialized");
};

server.registerResource(
  "memory",
  new ResourceTemplate("memory://{name}", {
    list: () => ({
      resources: fakeResourceList(),
    }),
  }),
  {
    mimeType: "text/plain",
    description: "Fake memory resource",
  },
  async (uri) => {
    log("resources/read");
    await delay("AGENTMESH_FAKE_MCP_READ_DELAY_MS");
    if (process.env.AGENTMESH_FAKE_MCP_READ_EXIT) {
      process.exit(71);
    }
    if (process.env.AGENTMESH_FAKE_MCP_METHOD_NOT_FOUND) {
      throw new McpError(ErrorCode.MethodNotFound, "Method not found");
    }
    if (process.env.AGENTMESH_FAKE_MCP_RESOURCE_NOT_FOUND || hasArg("--resource-not-found")) {
      throw new McpError(ErrorCode.InvalidParams, "Resource not found");
    }
    if (process.env.AGENTMESH_FAKE_MCP_NON_TEXT_RESOURCE) {
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/octet-stream",
            blob: "ZmFrZQ==",
          },
        ],
      };
    }
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "text/plain",
          text: fakeText(uri.href),
        },
      ],
    };
  },
);

await delay("AGENTMESH_FAKE_MCP_INITIALIZE_DELAY_MS");
if (process.env.AGENTMESH_FAKE_MCP_INITIALIZE_ERROR) {
  process.exit(70);
}
log("initialize");
await server.connect(new StdioServerTransport());

process.stdin.on("end", () => {
  log("close");
});

function log(event: string): void {
  const logPath = process.env.AGENTMESH_FAKE_MCP_LOG ?? argValue("--log");
  if (logPath) {
    appendFileSync(logPath, `${JSON.stringify({ event })}\n`);
  }
}

function fakeResourceList(): Array<{
  uri: string;
  name: string;
  mimeType: string;
  description: string;
}> {
  log("resources/list");
  if (hasArg("--list-error")) {
    throw new McpError(ErrorCode.InternalError, "List failed");
  }
  const count = numberEnv("AGENTMESH_FAKE_MCP_LIST_COUNT") ?? numberArg("--list-count") ?? 2;
  return Array.from({ length: count }, (_, index) => ({
    uri: `memory://listed-${index + 1}`,
    name: `Listed ${index + 1}`,
    mimeType: "text/plain",
    description: `Fake listed resource ${index + 1}`,
  }));
}

function fakeText(uri: string): string {
  const size = numberEnv("AGENTMESH_FAKE_MCP_TEXT_SIZE");
  return size === undefined ? `Hello from fake MCP: ${uri}` : "x".repeat(size);
}

async function delay(envName: string): Promise<void> {
  const ms = numberEnv(envName);
  if (ms === undefined || ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function numberEnv(name: string): number | undefined {
  const value = process.env[name];
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function numberArg(name: string): number | undefined {
  const value = argValue(name);
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}
