import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { McpFailureClassification } from "@agentmesh/core";

export type { McpFailureClassification } from "@agentmesh/core";

export interface StdioMcpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpClientOptions {
  initializeTimeoutMs?: number;
  readTimeoutMs?: number;
  listTimeoutMs?: number;
  maxTextResourceBytes?: number;
  resourceHintLimit?: number;
  cache?: McpClientCache;
  onTiming?: (timing: McpClientTiming) => void;
}

export interface McpClientCache {
  sessions: Map<string, unknown>;
}

export interface McpClientTiming {
  mcp_connect_ms: number;
  cache_hit: boolean;
}

export interface McpTextResource {
  uri: string;
  mimeType?: string;
  text: string;
}

export interface McpResourceHint {
  uri: string;
  name?: string;
  mimeType?: string;
  description?: string;
}

interface McpClientErrorOptions {
  cause?: unknown;
  retryable?: boolean;
  timing?: Partial<McpClientTiming>;
}

interface SdkMcpSession {
  client: Client;
  transport: StdioClientTransport;
  protocolError: Promise<never>;
  timing: McpClientTiming;
  cacheKey?: string;
}

export class McpClientError extends Error {
  readonly classification: McpFailureClassification;
  readonly retryable: boolean;
  readonly timing?: Partial<McpClientTiming>;

  constructor(
    classification: McpFailureClassification,
    message: string,
    options: McpClientErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "McpClientError";
    this.classification = classification;
    this.retryable = options.retryable ?? false;
    this.timing = options.timing;
  }
}

export function mcpFailureClassification(error: unknown): McpFailureClassification {
  return error instanceof McpClientError ? error.classification : "unknown";
}

export function mcpIngestionError(error: unknown): string {
  return `${mcpFailureClassification(error)}: ${errorMessage(error)}`;
}

export function createMcpClientCache(): McpClientCache {
  return { sessions: new Map() };
}

export async function closeMcpClientCache(cache: McpClientCache): Promise<void> {
  const sessions = [...sessionCache(cache).values()];
  sessionCache(cache).clear();
  for (const session of sessions) {
    await closeSdkMcpClient(session);
  }
}

export async function readMcpTextResource(
  config: StdioMcpServerConfig,
  resourceUri: string,
  options: McpClientOptions = {},
): Promise<McpTextResource> {
  const resources = await readMcpTextResources(config, [resourceUri], options);
  return resources[0];
}

export async function readMcpTextResources(
  config: StdioMcpServerConfig,
  resourceUris: string[],
  options: McpClientOptions = {},
): Promise<McpTextResource[]> {
  const session = await connectSdkMcpClientWithTiming(
    config,
    options.initializeTimeoutMs ?? 5_000,
    options.onTiming,
    options.cache,
  );
  try {
    const resources: McpTextResource[] = [];
    for (const resourceUri of resourceUris) {
      const result = await sdkRequest(
        session,
        session.client.readResource(
          { uri: resourceUri },
          { timeout: options.readTimeoutMs ?? 10_000 },
        ),
        "resources/read",
      );
      resources.push(
        textResourceFromReadResult(
          result,
          resourceUri,
          options.maxTextResourceBytes ?? 256 * 1024,
        ),
      );
    }
    return resources;
  } catch (error) {
    await evictCachedMcpSession(options.cache, session);
    throw error;
  } finally {
    if (!options.cache) {
      await closeSdkMcpClient(session);
    }
  }
}

export async function listMcpResourceHints(
  config: StdioMcpServerConfig,
  options: McpClientOptions = {},
): Promise<McpResourceHint[]> {
  const limit = options.resourceHintLimit ?? 50;
  if (limit <= 0) {
    return [];
  }
  const session = await connectSdkMcpClientWithTiming(
    config,
    options.initializeTimeoutMs ?? 5_000,
    options.onTiming,
    options.cache,
  );
  try {
    const hints: McpResourceHint[] = [];
    let cursor: string | undefined;
    do {
      const result = await sdkRequest(
        session,
        session.client.listResources(
          cursor ? { cursor } : {},
          { timeout: options.listTimeoutMs ?? 10_000 },
        ),
        "resources/list",
      );
      const page = resourceHintsFromListResult(result);
      hints.push(...page.resources);
      cursor = page.nextCursor;
    } while (cursor && hints.length < limit);
    return hints.slice(0, limit);
  } catch (error) {
    await evictCachedMcpSession(options.cache, session);
    throw error;
  } finally {
    if (!options.cache) {
      await closeSdkMcpClient(session);
    }
  }
}

async function connectSdkMcpClientWithTiming(
  config: StdioMcpServerConfig,
  initializeTimeoutMs: number,
  onTiming?: (timing: McpClientTiming) => void,
  cache?: McpClientCache,
): Promise<SdkMcpSession> {
  const cacheKey = mcpClientCacheKey(config);
  const cachedSession = cache ? sessionCache(cache).get(cacheKey) : undefined;
  if (cachedSession) {
    onTiming?.({ mcp_connect_ms: 0, cache_hit: true });
    return cachedSession;
  }
  try {
    const session = await connectSdkMcpClient(config, initializeTimeoutMs);
    session.cacheKey = cacheKey;
    if (cache) {
      sessionCache(cache).set(cacheKey, session);
    }
    onTiming?.(session.timing);
    return session;
  } catch (error) {
    if (error instanceof McpClientError && error.timing?.mcp_connect_ms !== undefined) {
      onTiming?.({ mcp_connect_ms: error.timing.mcp_connect_ms, cache_hit: false });
    }
    throw error;
  }
}

async function connectSdkMcpClient(
  config: StdioMcpServerConfig,
  initializeTimeoutMs: number,
): Promise<SdkMcpSession> {
  const connectStartedAt = Date.now();
  const client = new Client({ name: "agentmesh", version: "0.1.7" }, { capabilities: {} });
  let rejectProtocolError: (error: Error) => void = () => {};
  const protocolError = new Promise<never>((_, reject) => {
    rejectProtocolError = reject;
  });
  protocolError.catch(() => {});
  client.onerror = (error) => {
    if (isMissingCommandError(error)) {
      rejectProtocolError(sdkErrorToMcpClientError(error, "initialize"));
      return;
    }
    rejectProtocolError(new McpClientError(
      "invalid_json_rpc",
      `Invalid MCP JSON-RPC message: ${errorMessage(error)}`,
      { cause: error },
    ));
  };
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args ?? [],
    env: mergedEnv(config.env),
    stderr: "pipe",
  });
  const session: SdkMcpSession = {
    client,
    transport,
    protocolError,
    timing: { mcp_connect_ms: 0, cache_hit: false },
  };
  try {
    await sdkRequest(session, client.connect(transport, { timeout: initializeTimeoutMs }), "initialize");
    session.timing = { mcp_connect_ms: elapsedMs(connectStartedAt), cache_hit: false };
  } catch (error) {
    const timing = { mcp_connect_ms: elapsedMs(connectStartedAt), cache_hit: false };
    await closeSdkMcpClient(session);
    throw errorWithMcpTiming(error, timing);
  }
  return session;
}

async function sdkRequest<T>(
  session: SdkMcpSession,
  request: Promise<T>,
  method: string,
): Promise<T> {
  try {
    return await Promise.race([request, session.protocolError]);
  } catch (error) {
    throw sdkErrorToMcpClientError(error, method);
  }
}

async function closeSdkMcpClient(session: SdkMcpSession): Promise<void> {
  try {
    await session.client.close();
  } catch {
    try {
      await session.transport.close();
    } catch {
      // Preserve the request/initialize error that triggered cleanup.
    }
  }
}

async function evictCachedMcpSession(
  cache: McpClientCache | undefined,
  session: SdkMcpSession,
): Promise<void> {
  if (!cache || !session.cacheKey) {
    return;
  }
  const sessions = sessionCache(cache);
  if (sessions.get(session.cacheKey) === session) {
    sessions.delete(session.cacheKey);
  }
  await closeSdkMcpClient(session);
}

function sessionCache(cache: McpClientCache): Map<string, SdkMcpSession> {
  return cache.sessions as Map<string, SdkMcpSession>;
}

function mcpClientCacheKey(config: StdioMcpServerConfig): string {
  return JSON.stringify({
    command: config.command,
    args: config.args ?? [],
    env: stableRecord(config.env ?? {}),
    cwd: process.cwd(),
  });
}

function stableRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function mergedEnv(env: Record<string, string> = {}): Record<string, string> {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  return { ...inherited, ...env };
}

function textResourceFromReadResult(
  result: unknown,
  fallbackUri: string,
  maxTextResourceBytes: number,
): McpTextResource {
  if (!isRecord(result) || !Array.isArray(result.contents)) {
    throw new McpClientError(
      "unknown",
      "MCP resources/read result must include contents",
    );
  }
  const content = result.contents.find((item) => isRecord(item) && typeof item.text === "string");
  if (!isRecord(content) || typeof content.text !== "string") {
    throw new McpClientError(
      "non_text_resource",
      "MCP resources/read result did not include a text content item",
    );
  }
  const textBytes = Buffer.byteLength(content.text, "utf-8");
  if (textBytes > maxTextResourceBytes) {
    throw new McpClientError(
      "resource_too_large",
      `MCP text resource exceeds ${maxTextResourceBytes} bytes: ${textBytes}`,
    );
  }
  const uri = typeof content.uri === "string" ? content.uri : fallbackUri;
  const mimeType = typeof content.mimeType === "string" ? content.mimeType : undefined;
  return {
    uri,
    ...(mimeType ? { mimeType } : {}),
    text: content.text,
  };
}

function resourceHintsFromListResult(result: unknown): {
  resources: McpResourceHint[];
  nextCursor?: string;
} {
  if (!isRecord(result) || !Array.isArray(result.resources)) {
    throw new McpClientError(
      "unknown",
      "MCP resources/list result must include resources",
    );
  }
  const resources = result.resources.flatMap((item): McpResourceHint[] => {
    if (!isRecord(item) || typeof item.uri !== "string") {
      return [];
    }
    return [
      {
        uri: item.uri,
        ...(typeof item.name === "string" ? { name: item.name } : {}),
        ...(typeof item.mimeType === "string" ? { mimeType: item.mimeType } : {}),
        ...(typeof item.description === "string" ? { description: item.description } : {}),
      },
    ];
  });
  return {
    resources,
    ...(typeof result.nextCursor === "string" ? { nextCursor: result.nextCursor } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sdkErrorToMcpClientError(error: unknown, method: string): McpClientError {
  if (error instanceof McpClientError) {
    return error;
  }
  if (isMissingCommandError(error)) {
    return new McpClientError(
      "server_start_failed",
      `Failed to start MCP server: ${errorMessage(error)}`,
      { cause: error },
    );
  }
  if (error instanceof McpError && error.code === ErrorCode.RequestTimeout) {
    return new McpClientError("timeout", `MCP request timed out: ${method}`, {
      cause: error,
      retryable: true,
    });
  }
  if (method === "initialize") {
    return new McpClientError(
      "initialize_failed",
      `MCP initialize failed: ${errorMessage(error)}`,
      { cause: error },
    );
  }
  if (method === "resources/read" && isResourceNotFoundError(error)) {
    return new McpClientError(
      "resource_not_found",
      `MCP resource not found: ${errorMessage(error)}`,
      { cause: error },
    );
  }
  return new McpClientError("unknown", `MCP request failed: ${errorMessage(error)}`, {
    cause: error,
  });
}

function errorWithMcpTiming(error: unknown, timing: McpClientTiming): unknown {
  if (error instanceof McpClientError) {
    return new McpClientError(error.classification, error.message, {
      cause: error,
      retryable: error.retryable,
      timing,
    });
  }
  return error;
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function isMissingCommandError(error: unknown): boolean {
  return isRecord(error) && (error.code === "ENOENT" || error.code === "EACCES");
}

function isResourceNotFoundError(error: unknown): boolean {
  if (error instanceof McpError) {
    return (
      error.code === -32002 ||
      (error.code === ErrorCode.InvalidParams && isResourceNotFoundMessage(error.message))
    );
  }
  return isResourceNotFoundMessage(errorMessage(error));
}

function isResourceNotFoundMessage(message: string): boolean {
  return /\bresource not found\b/i.test(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
