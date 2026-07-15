import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import {
  isInvalidStudioRunIdError,
  isMissingStudioArtifactError,
  isMissingStudioRunError,
  readStudioArtifactPreview,
  readStudioCompatibility,
  readStudioRun,
  listStudioRunIndex,
  listStudioRuns,
} from "./packet-browser.js";
import {
  adoptStudioCall,
  isConflictStudioCallAdoptionError,
  isInvalidStudioCallAdoptionError,
  isInvalidStudioCallIdError,
  isMissingStudioCallError,
  listStudioCalls,
  readStudioCall,
} from "./calls-browser.js";
import { readStudioCatalog } from "./catalog.js";
import {
  readStudioAgent,
  readStudioAgentLifecycleOperation,
  readStudioAgentModels,
  readStudioAgents,
  runStudioAgentLifecycleOperation,
  type StudioAgentCreateRequest,
  type StudioAgentUpdateRequest,
} from "./agent-lifecycle.js";
import {
  readStudioAdvancedSettings,
  updateStudioAdvancedSettings,
  type StudioAdvancedSettingsUpdateRequest,
} from "./advanced-settings.js";
import {
  readStudioWorkflowLifecycleOperation,
  runStudioWorkflowLifecycleOperation,
  type StudioWorkflowCreateRequest,
  type StudioWorkflowUpdateRequest,
} from "./workflow-lifecycle.js";
import {
  readStudioPresetLifecycleOperation,
  runStudioPresetLifecycleOperation,
  type StudioPresetCreateRequest,
  type StudioPresetUpdateRequest,
} from "./preset-lifecycle.js";
import {
  runStudioMutation,
  type StudioMutationOptions,
  type StudioMutationRequest,
} from "./mutations.js";
import {
  installStudioAgentSkills,
  installStudioCommandLineTool,
  readStudioIntegrations,
  type StudioIntegrationOptions,
} from "./integrations.js";
import { checkAgentMeshUpdate } from "@agentmesh/runtime/src/update/check.js";
import { STUDIO_CSS, STUDIO_HTML, STUDIO_JS } from "./assets.js";

export interface StudioServerOptions {
  cwd?: string;
  configPath?: string;
  authToken?: string;
  allowUnauthenticatedBootstrap?: boolean;
  assetDir?: string;
  entrypoint?: string;
  integrations?: StudioIntegrationOptions;
}

export interface StartedStudioServer {
  server: Server;
  url: string;
}

export function createStudioServer(options: StudioServerOptions = {}): Server {
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath;
  const entrypoint = options.entrypoint ?? "cli";
  const mutationOptions: StudioMutationOptions = {
    cwd,
    entrypoint,
    ...(options.configPath ? { configPath: options.configPath } : {}),
  };
  const assetDir = options.assetDir;
  return createServer((request, response) => {
    try {
      void handleStudioRequest(request, response, {
        cwd,
        configPath,
        mutationOptions,
        authToken: options.authToken,
        allowUnauthenticatedBootstrap: options.allowUnauthenticatedBootstrap,
        assetDir,
        entrypoint,
        integrations: options.integrations,
      });
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

export function startStudioServer(options: StudioServerOptions & {
  host?: string;
  port?: number;
} = {}): Promise<StartedStudioServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4777;
  const server = createStudioServer({
    cwd: options.cwd,
    configPath: options.configPath,
    authToken: options.authToken,
    allowUnauthenticatedBootstrap: options.allowUnauthenticatedBootstrap,
    assetDir: options.assetDir,
    entrypoint: options.entrypoint,
    integrations: options.integrations,
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address() as AddressInfo;
      resolve({
        server,
        url: `http://${address.address}:${address.port}`,
      });
    });
  });
}

function handleStudioRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: {
    cwd: string;
    configPath?: string;
    mutationOptions: StudioMutationOptions;
    authToken?: string;
    allowUnauthenticatedBootstrap?: boolean;
    assetDir?: string;
    entrypoint: string;
    integrations?: StudioIntegrationOptions;
  },
): Promise<void> | void {
  const cwd = options.cwd;
  const url = new URL(request.url ?? "/", "http://studio.local");
  const rawPathname = rawRequestPathname(request.url ?? "/");
  if (!enforceLocalRequestBoundary(request, response)) {
    return;
  }
  if (request.method === "OPTIONS") {
    sendCorsPreflight(response, request);
    return;
  }
  if (url.pathname === "/") {
    if (!requireMethod(request, response, "GET")) {
      return;
    }
    if (!authorizeRequest(request, response, options.authToken, { allowQueryToken: true })) {
      return;
    }
    const initialHeaders = studioInitialHeaders(options.authToken);
    if (options.assetDir) {
      if (sendBuiltStudioAsset(response, options.assetDir, "/index.html", initialHeaders)) {
        return;
      }
      sendText(
        response,
        500,
        `AgentMesh frontend assets were not found at ${options.assetDir}. Run npm run build:studio-frontend before starting agentmesh studio.\n`,
        "text/plain; charset=utf-8",
        initialHeaders,
      );
      return;
    }
    sendText(response, 200, STUDIO_HTML, "text/html; charset=utf-8", initialHeaders);
    return;
  }
  if (!authorizeRequest(request, response, options.authToken)) {
    return;
  }
  if (url.pathname === "/api/health") {
    if (!requireMethod(request, response, "GET")) {
      return;
    }
    sendJson(response, 200, { ok: true });
    return;
  }
  if (url.pathname === "/api/bootstrap") {
    if (!requireMethod(request, response, "GET")) {
      return;
    }
    const authenticated = Boolean(options.authToken);
    if (!authenticated && !options.allowUnauthenticatedBootstrap) {
      sendJson(response, 401, {
        error: "bootstrap requires launch auth",
      });
      return;
    }
    sendJson(response, 200, {
      schema_version: 1,
      authenticated,
      workspace: cwd,
      api_base_url: "",
    });
    return;
  }
  if (url.pathname === "/style.css") {
    if (!requireMethod(request, response, "GET")) {
      return;
    }
    sendText(response, 200, STUDIO_CSS, "text/css; charset=utf-8");
    return;
  }
  if (url.pathname === "/studio.js") {
    if (!requireMethod(request, response, "GET")) {
      return;
    }
    sendText(response, 200, STUDIO_JS, "text/javascript; charset=utf-8");
    return;
  }
  if (url.pathname === "/api/runs") {
    if (!requireMethod(request, response, "GET")) {
      return;
    }
    sendJson(response, 200, listStudioRunIndex({
      cwd,
      ...studioWorkspaceQueryOptions(url.searchParams),
    }));
    return;
  }
  if (url.pathname === "/api/calls") {
    if (!requireMethod(request, response, "GET")) {
      return;
    }
    sendJson(response, 200, listStudioCalls({
      cwd,
      ...studioWorkspaceQueryOptions(url.searchParams),
    }));
    return;
  }
  if (url.pathname === "/api/catalog") {
    if (!requireMethod(request, response, "GET")) {
      return;
    }
    sendJson(response, 200, readStudioCatalog({
      cwd,
      ...(options.configPath ? { configPath: options.configPath } : {}),
    }));
    return;
  }
  if (url.pathname === "/api/compatibility") {
    if (!requireMethod(request, response, "GET")) {
      return;
    }
    sendJson(response, 200, readStudioCompatibility({ cwd, entrypoint: options.entrypoint }));
    return;
  }
  if (url.pathname === "/api/v1/update/check") {
    if (!requireMethod(request, response, "GET")) {
      return;
    }
    return checkAgentMeshUpdate()
      .then((report) => {
        sendJson(response, 200, report);
      })
      .catch((error) => {
        sendJson(response, 502, {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
  if (url.pathname === "/api/desktop/integrations") {
    if (!requireMethod(request, response, "GET")) {
      return;
    }
    return readStudioIntegrations({
      cwd,
      entrypoint: options.entrypoint,
      integrations: options.integrations,
    }).then((report) => {
      sendJson(response, 200, report);
    }).catch((error) => {
      sendJson(response, 502, {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
  if (url.pathname === "/api/desktop/integrations/command-line-tool") {
    if (!requireMethod(request, response, "POST")) {
      return;
    }
    return readJsonBody(request)
      .then(async (body) => {
        const result = await installStudioCommandLineTool(body as Record<string, never>, {
          cwd,
          entrypoint: options.entrypoint,
          integrations: options.integrations,
        });
        sendJson(response, 200, result);
      })
      .catch((error) => {
        sendJson(response, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
  if (url.pathname === "/api/desktop/integrations/skills") {
    if (!requireMethod(request, response, "POST")) {
      return;
    }
    return readJsonBody(request)
      .then(async (body) => {
        sendJson(response, 200, await installStudioAgentSkills(body as Record<string, unknown>, {
          cwd,
          entrypoint: options.entrypoint,
          integrations: options.integrations,
        }));
      })
      .catch((error) => {
        sendJson(response, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
  if (url.pathname === "/api/v1/agents") {
    if (request.method === "GET") {
      sendJson(response, 200, readStudioAgents({
        cwd,
        ...(options.configPath ? { configPath: options.configPath } : {}),
      }));
      return;
    }
    if (request.method === "POST") {
      return readJsonBody(request)
        .then((body) => {
          rejectGlobalResourceScopeBody(body, "agent");
          return runStudioAgentLifecycleOperation({
            action: "create",
            create: body as StudioAgentCreateRequest,
          }, {
            cwd,
            ...(options.configPath ? { configPath: options.configPath } : {}),
          });
        })
        .then((operation) => {
          sendJson(response, lifecycleStatusCode(operation.status), operation);
        })
        .catch((error) => {
          sendJson(response, 400, {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }
    sendJson(response, 405, { error: "method not allowed" });
    return;
  }
  if (url.pathname === "/api/v1/agents/models") {
    if (!requireMethod(request, response, "GET")) {
      return;
    }
    const adapter = url.searchParams.get("adapter")?.trim();
    if (!adapter) {
      sendJson(response, 400, { error: "adapter is required" });
      return;
    }
    sendJson(response, 200, readStudioAgentModels(adapter, { cwd }));
    return;
  }
  if (url.pathname === "/api/v1/settings/advanced") {
    if (request.method === "GET") {
      try {
        sendJson(response, 200, readStudioAdvancedSettings({
          cwd,
          ...(options.configPath ? { configPath: options.configPath } : {}),
        }));
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    if (request.method === "PUT") {
      return readJsonBody(request)
        .then((body) => updateStudioAdvancedSettings(body as StudioAdvancedSettingsUpdateRequest, {
          cwd,
          ...(options.configPath ? { configPath: options.configPath } : {}),
        }))
        .then((settings) => {
          sendJson(response, 200, settings);
        })
        .catch((error) => {
          sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
        });
    }
    sendJson(response, 405, { error: "method not allowed" });
    return;
  }
  if (url.pathname === "/api/v1/workflows") {
    if (!requireMethod(request, response, "POST")) {
      return;
    }
    return readJsonBody(request)
      .then((body) => {
        rejectGlobalResourceScopeBody(body, "workflow");
        return runStudioWorkflowLifecycleOperation({
          action: "create",
          create: body as StudioWorkflowCreateRequest,
        }, {
          cwd,
          ...(options.configPath ? { configPath: options.configPath } : {}),
        });
      })
      .then((operation) => {
        sendJson(response, lifecycleStatusCode(operation.status), operation);
      })
      .catch((error) => {
        sendJson(response, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
  const workflowMatch = url.pathname.match(/^\/api\/v1\/workflows\/([^/]+)$/);
  if (workflowMatch) {
    const workflowId = decodeURIComponent(workflowMatch[1]);
    if (request.method === "DELETE") {
      try {
        rejectGlobalResourceScopeQuery(url.searchParams, "workflow");
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
        return;
      }
      return runStudioWorkflowLifecycleOperation({
        action: "delete",
        workflowId,
      }, {
        cwd,
        ...(options.configPath ? { configPath: options.configPath } : {}),
      })
        .then((operation) => {
          sendJson(response, lifecycleStatusCode(operation.status), operation);
        })
        .catch((error) => {
          sendJson(response, 400, {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }
    if (!requireMethod(request, response, "PUT")) {
      return;
    }
    return readJsonBody(request)
      .then((body) => {
        rejectGlobalResourceScopeBody(body, "workflow");
        return runStudioWorkflowLifecycleOperation({
          action: "update",
          workflowId,
          update: body as StudioWorkflowUpdateRequest,
        }, {
          cwd,
          ...(options.configPath ? { configPath: options.configPath } : {}),
        });
      })
      .then((operation) => {
        sendJson(response, lifecycleStatusCode(operation.status), operation);
      })
      .catch((error) => {
        sendJson(response, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
  if (url.pathname === "/api/v1/presets") {
    if (!requireMethod(request, response, "POST")) {
      return;
    }
    return readJsonBody(request)
      .then((body) => {
        rejectGlobalResourceScopeBody(body, "preset");
        return runStudioPresetLifecycleOperation({
          action: "create",
          create: body as StudioPresetCreateRequest,
        }, {
          cwd,
          ...(options.configPath ? { configPath: options.configPath } : {}),
        });
      })
      .then((operation) => {
        sendJson(response, lifecycleStatusCode(operation.status), operation);
      })
      .catch((error) => {
        sendJson(response, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
  const presetMatch = url.pathname.match(/^\/api\/v1\/presets\/([^/]+)$/);
  if (presetMatch) {
    const presetId = decodeURIComponent(presetMatch[1]);
    if (request.method === "DELETE") {
      try {
        rejectGlobalResourceScopeQuery(url.searchParams, "preset");
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
        return;
      }
      return runStudioPresetLifecycleOperation({
        action: "delete",
        presetId,
      }, {
        cwd,
        ...(options.configPath ? { configPath: options.configPath } : {}),
      })
        .then((operation) => {
          sendJson(response, lifecycleStatusCode(operation.status), operation);
        })
        .catch((error) => {
          sendJson(response, 400, {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }
    if (!requireMethod(request, response, "PUT")) {
      return;
    }
    return readJsonBody(request)
      .then((body) => {
        rejectGlobalResourceScopeBody(body, "preset");
        return runStudioPresetLifecycleOperation({
          action: "update",
          presetId,
          update: body as StudioPresetUpdateRequest,
        }, {
          cwd,
          ...(options.configPath ? { configPath: options.configPath } : {}),
        });
      })
      .then((operation) => {
        sendJson(response, lifecycleStatusCode(operation.status), operation);
      })
      .catch((error) => {
        sendJson(response, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
  const workflowOperationMatch = url.pathname.match(/^\/api\/v1\/workflows\/operations\/([^/]+)$/);
  if (workflowOperationMatch) {
    if (!requireMethod(request, response, "GET")) {
      return;
    }
    const operation = readStudioWorkflowLifecycleOperation(decodeURIComponent(workflowOperationMatch[1]));
    if (!operation) {
      sendJson(response, 404, { error: "operation not found" });
      return;
    }
    sendJson(response, 200, operation);
    return;
  }
  const presetOperationMatch = url.pathname.match(/^\/api\/v1\/presets\/operations\/([^/]+)$/);
  if (presetOperationMatch) {
    if (!requireMethod(request, response, "GET")) {
      return;
    }
    const operation = readStudioPresetLifecycleOperation(decodeURIComponent(presetOperationMatch[1]));
    if (!operation) {
      sendJson(response, 404, { error: "operation not found" });
      return;
    }
    sendJson(response, 200, operation);
    return;
  }
  const agentOperationMatch = url.pathname.match(/^\/api\/v1\/agents\/operations\/([^/]+)$/);
  if (agentOperationMatch) {
    if (!requireMethod(request, response, "GET")) {
      return;
    }
    const operation = readStudioAgentLifecycleOperation(decodeURIComponent(agentOperationMatch[1]));
    if (!operation) {
      sendJson(response, 404, { error: "operation not found" });
      return;
    }
    sendJson(response, 200, operation);
    return;
  }
  const agentActionMatch = url.pathname.match(/^\/api\/v1\/agents\/([^/]+)\/(enable|disable)$/);
  if (agentActionMatch) {
    if (!requireMethod(request, response, "POST")) {
      return;
    }
    return readJsonBody(request)
      .then((body) => {
        rejectGlobalResourceScopeBody(body, "agent");
        return runStudioAgentLifecycleOperation({
          action: agentActionMatch[2] as "enable" | "disable",
          agentId: decodeURIComponent(agentActionMatch[1]),
        }, {
          cwd,
          ...(options.configPath ? { configPath: options.configPath } : {}),
        });
      })
      .then((operation) => {
        sendJson(response, lifecycleStatusCode(operation.status), operation);
      })
      .catch((error) => {
        sendJson(response, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
  const agentMatch = url.pathname.match(/^\/api\/v1\/agents\/([^/]+)$/);
  if (agentMatch) {
    if (request.method === "GET") {
      try {
        sendJson(response, 200, readStudioAgent(decodeURIComponent(agentMatch[1]), {
          cwd,
          ...(options.configPath ? { configPath: options.configPath } : {}),
        }));
      } catch (error) {
        sendJson(response, 404, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    if (request.method === "DELETE") {
      try {
        rejectGlobalResourceScopeQuery(url.searchParams, "agent");
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
        return;
      }
      const agentId = decodeURIComponent(agentMatch[1]);
      const refusal = activeAgentDeletionRefusal(agentId, cwd);
      if (refusal) {
        sendJson(response, 409, { error: refusal });
        return;
      }
      return runStudioAgentLifecycleOperation({
        action: "delete",
        agentId,
      }, {
        cwd,
        ...(options.configPath ? { configPath: options.configPath } : {}),
      })
        .then((operation) => {
          sendJson(response, lifecycleStatusCode(operation.status), operation);
        })
        .catch((error) => {
          sendJson(response, 400, {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }
    if (request.method === "PUT") {
      const agentId = decodeURIComponent(agentMatch[1]);
      return readJsonBody(request)
        .then((body) => {
          rejectGlobalResourceScopeBody(body, "agent");
          return runStudioAgentLifecycleOperation({
            action: "update",
            agentId,
            update: body as StudioAgentUpdateRequest,
          }, {
            cwd,
            ...(options.configPath ? { configPath: options.configPath } : {}),
          });
        })
        .then((operation) => {
          sendJson(response, lifecycleStatusCode(operation.status), operation);
        })
        .catch((error) => {
          sendJson(response, 400, {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }
    sendJson(response, 405, { error: "method not allowed" });
    return;
  }
  const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (runMatch) {
    if (!requireMethod(request, response, "GET")) {
      return;
    }
    try {
      sendJson(response, 200, readStudioRun(decodeURIComponent(runMatch[1]), {
        cwd,
        ...eventPageOptions(url.searchParams),
        ...studioWorkspaceQueryOptions(url.searchParams),
      }));
    } catch (error) {
      if (isInvalidStudioRunIdError(error)) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
        return;
      }
      if (isMissingStudioRunError(error)) {
        sendJson(response, 404, { error: error instanceof Error ? error.message : String(error) });
        return;
      }
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  const callAdoptionMatch = rawPathname.match(/^\/api\/calls\/([^/]+)\/adoption$/);
  if (callAdoptionMatch) {
    if (!requireMethod(request, response, "POST")) {
      return;
    }
    let callId: string;
    try {
      callId = decodeURIComponent(callAdoptionMatch[1]);
    } catch {
      sendJson(response, 400, { error: "invalid call id" });
      return;
    }
    return readJsonBody(request)
      .then((body) => {
        sendJson(response, 200, adoptStudioCall(callId, body as Record<string, unknown>, {
          cwd,
          ...studioWorkspaceQueryOptions(url.searchParams),
        }));
      })
      .catch((error) => {
        if (isInvalidStudioCallIdError(error) || isInvalidStudioCallAdoptionError(error)) {
          sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
          return;
        }
        if (isMissingStudioCallError(error)) {
          sendJson(response, 404, { error: error instanceof Error ? error.message : String(error) });
          return;
        }
        if (isConflictStudioCallAdoptionError(error)) {
          sendJson(response, 409, { error: error instanceof Error ? error.message : String(error) });
          return;
        }
        sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
      });
  }
  const callMatch = rawPathname.match(/^\/api\/calls\/([^/]+)$/);
  if (callMatch) {
    if (!requireMethod(request, response, "GET")) {
      return;
    }
    let callId: string;
    try {
      callId = decodeURIComponent(callMatch[1]);
    } catch {
      sendJson(response, 400, { error: "invalid call id" });
      return;
    }
    try {
      sendJson(response, 200, readStudioCall(callId, {
        cwd,
        ...studioWorkspaceQueryOptions(url.searchParams),
      }));
    } catch (error) {
      if (isInvalidStudioCallIdError(error)) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
        return;
      }
      if (isMissingStudioCallError(error)) {
        sendJson(response, 404, { error: error instanceof Error ? error.message : String(error) });
        return;
      }
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  const artifactMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/artifacts\/([^/]+)$/);
  if (artifactMatch) {
    if (!requireMethod(request, response, "GET")) {
      return;
    }
    try {
      sendJson(
        response,
        200,
        readStudioArtifactPreview(
          decodeURIComponent(artifactMatch[1]),
          decodeURIComponent(artifactMatch[2]),
          {
            cwd,
            ...studioWorkspaceQueryOptions(url.searchParams),
          },
        ),
      );
    } catch (error) {
      if (isInvalidStudioRunIdError(error)) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
        return;
      }
      if (isMissingStudioRunError(error) || isMissingStudioArtifactError(error)) {
        sendJson(response, 404, { error: error instanceof Error ? error.message : String(error) });
        return;
      }
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  if (url.pathname === "/api/mutations") {
    if (!requireMethod(request, response, "POST")) {
      return;
    }
    return readJsonBody(request)
      .then((body) =>
        runStudioMutation(body as StudioMutationRequest, options.mutationOptions),
      )
      .then((result) => {
        sendJson(response, mutationStatusCode(result), result);
      })
      .catch((error) => {
        sendJson(response, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
  if (options.assetDir && url.pathname.startsWith("/assets/")) {
    if (!requireMethod(request, response, "GET")) {
      return;
    }
    if (sendBuiltStudioAsset(response, options.assetDir, url.pathname)) {
      return;
    }
    sendJson(response, 404, { error: "not found" });
    return;
  }
  sendJson(response, 404, { error: "not found" });
}

function studioWorkspaceQueryOptions(searchParams: URLSearchParams): {
  scope?: "all" | "current" | "workspace";
  workspaceId?: string;
} {
  const scope = searchParams.get("scope");
  const workspaceId = searchParams.get("workspace_id") ?? undefined;
  return {
    ...(scope === "all" || scope === "current" || scope === "workspace" ? { scope } : {}),
    ...(workspaceId ? { workspaceId } : {}),
  };
}

function mutationStatusCode(result: { exit_code: number | null; error_code?: string }): number {
  if (result.exit_code === 0) {
    return 200;
  }
  return result.error_code === "run_locked" ? 423 : 409;
}

function rawRequestPathname(requestUrl: string): string {
  const stop = requestUrl.search(/[?#]/);
  return stop === -1 ? requestUrl : requestUrl.slice(0, stop);
}

function requireMethod(
  request: IncomingMessage,
  response: ServerResponse,
  expected: string,
): boolean {
  if (request.method !== expected) {
    sendJson(response, 405, { error: "method not allowed" });
    return false;
  }
  return true;
}

function authorizeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  authToken?: string,
  options: { allowQueryToken?: boolean } = {},
): boolean {
  if (!authToken) {
    return true;
  }
  const provided = bearerToken(request.headers.authorization)
    ?? cookieToken(request.headers.cookie)
    ?? (options.allowQueryToken ? requestQueryToken(request.url) : undefined);
  if (provided === authToken) {
    return true;
  }
  sendJson(response, 401, { error: "unauthorized" });
  return false;
}

function enforceLocalRequestBoundary(request: IncomingMessage, response: ServerResponse): boolean {
  const localHost = localHostFromHeader(request.headers.host);
  if (!localHost) {
    sendJson(response, 403, { error: "forbidden host" });
    return false;
  }
  const origin = originFromHeader(request.headers.origin);
  if (!origin) {
    sendJson(response, 403, { error: "forbidden origin" });
    return false;
  }
  if (origin !== "absent" && origin !== localHost.origin) {
    sendJson(response, 403, { error: "forbidden origin" });
    return false;
  }
  return true;
}

function sendCorsPreflight(response: ServerResponse, request: IncomingMessage): void {
  const origin = originFromHeader(request.headers.origin);
  const headers: Record<string, string> = {};
  if (origin && origin !== "absent") {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-credentials"] = "true";
    headers["access-control-allow-methods"] = "GET,POST,PUT,DELETE,OPTIONS";
    headers["access-control-allow-headers"] = "authorization,content-type";
  }
  sendText(response, 204, "", "text/plain; charset=utf-8", headers);
}

function localHostFromHeader(value: string | undefined): { hostname: string; origin: string } | undefined {
  if (!value || value.trim().length === 0) {
    return undefined;
  }
  try {
    const url = new URL(`http://${value}`);
    if (!isLoopbackHostname(url.hostname)) {
      return undefined;
    }
    return {
      hostname: url.hostname,
      origin: url.origin,
    };
  } catch {
    return undefined;
  }
}

function originFromHeader(value: string | undefined): string | "absent" | undefined {
  if (value === undefined || value.trim().length === 0) {
    return "absent";
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" || !isLoopbackHostname(url.hostname)) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]" || hostname === "::1";
}

function bearerToken(value: string | undefined): string | undefined {
  const prefix = "Bearer ";
  return value?.startsWith(prefix) ? value.slice(prefix.length) : undefined;
}

function cookieToken(value: string | undefined): string | undefined {
  const cookies = value?.split(";").map((cookie) => cookie.trim()) ?? [];
  const tokenCookie = cookies.find((cookie) => cookie.startsWith("agentmesh_studio_token="));
  if (!tokenCookie) {
    return undefined;
  }
  try {
    return decodeURIComponent(tokenCookie.slice("agentmesh_studio_token=".length));
  } catch {
    return undefined;
  }
}

function requestQueryToken(requestUrl: string | undefined): string | undefined {
  const url = new URL(requestUrl ?? "/", "http://studio.local");
  const token = url.searchParams.get("token")?.trim();
  return token && token.length > 0 ? token : undefined;
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let content = "";
    request.setEncoding("utf-8");
    request.on("data", (chunk) => {
      content += chunk;
      if (content.length > 64 * 1024) {
        reject(new Error("request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(content || "{}"));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    request.on("error", reject);
  });
}

function eventPageOptions(searchParams: URLSearchParams): {
  eventOffset?: number;
  eventLimit?: number;
} {
  return {
    ...optionalIntegerSearchParam(searchParams, "event_offset", "eventOffset"),
    ...optionalIntegerSearchParam(searchParams, "event_limit", "eventLimit"),
  };
}

function optionalIntegerSearchParam(
  searchParams: URLSearchParams,
  name: string,
  key: "eventOffset" | "eventLimit",
): { eventOffset?: number; eventLimit?: number } {
  const value = searchParams.get(name);
  if (value === null || value.trim().length === 0) {
    return {};
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? { [key]: parsed } : {};
}

function lifecycleStatusCode(status: "running" | "succeeded" | "failed" | "conflict"): number {
  if (status === "succeeded") {
    return 200;
  }
  return status === "conflict" ? 409 : 422;
}

function rejectGlobalResourceScopeBody(body: unknown, resource: "agent" | "workflow" | "preset"): void {
  if (!isRecord(body)) {
    return;
  }
  if (Object.hasOwn(body, "scope") || Object.hasOwn(body, "project_dir")) {
    throw new Error(`${resource} scope is not supported; resources are global user-level entries`);
  }
}

function rejectGlobalResourceScopeQuery(searchParams: URLSearchParams, resource: "agent" | "workflow" | "preset"): void {
  if (searchParams.has("scope") || searchParams.has("project_dir")) {
    throw new Error(`${resource} scope is not supported; resources are global user-level entries`);
  }
}

function activeAgentDeletionRefusal(agentId: string, cwd: string): string | undefined {
  for (const run of listStudioRuns({ cwd, scope: "current" })) {
    if (!String(run.status ?? "").includes("running")) {
      continue;
    }
    try {
      const detail = readStudioRun(run.run_id, { cwd, eventLimit: 0 });
      if (summaryReferencesAgent(detail.summary, agentId)) {
        return `agent ${agentId} is assigned to active run ${run.run_id}; stop or finish that run before deleting the agent`;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

function summaryReferencesAgent(summary: unknown, agentId: string): boolean {
  if (!isRecord(summary)) {
    return false;
  }
  const assignments = summary.stage_assignments;
  if (isRecord(assignments)) {
    for (const value of Object.values(assignments)) {
      if (Array.isArray(value) && value.includes(agentId)) {
        return true;
      }
    }
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  sendText(response, status, `${JSON.stringify(value, null, 2)}\n`, "application/json; charset=utf-8");
}

function sendText(
  response: ServerResponse,
  status: number,
  content: string,
  contentType: string,
  extraHeaders: Record<string, string> = {},
): void {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    ...extraHeaders,
  });
  response.end(content);
}

function sendBuiltStudioAsset(
  response: ServerResponse,
  assetDir: string,
  requestPath: string,
  extraHeaders: Record<string, string> = {},
): boolean {
  const assetPath = resolveBuiltStudioAssetPath(assetDir, requestPath);
  if (!assetPath) {
    return false;
  }
  response.writeHead(200, {
    "content-type": contentTypeForPath(assetPath),
    "cache-control": "no-store",
    ...extraHeaders,
  });
  response.end(readFileSync(assetPath));
  return true;
}

function resolveBuiltStudioAssetPath(assetDir: string, requestPath: string): string | undefined {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch {
    return undefined;
  }
  const relativePath = decodedPath.replace(/^\/+/, "");
  const pathSegments = relativePath.split(/[\\/]+/);
  if (
    relativePath.length === 0
    || relativePath.includes("\0")
    || pathSegments.includes("..")
  ) {
    return undefined;
  }
  try {
    const root = realpathSync(assetDir);
    const candidate = path.resolve(root, relativePath);
    if (!isPathInside(candidate, root)) {
      return undefined;
    }
    if (!existsSync(candidate) || !statSync(candidate).isFile()) {
      return undefined;
    }
    const realCandidate = realpathSync(candidate);
    return isPathInside(realCandidate, root) ? realCandidate : undefined;
  } catch {
    return undefined;
  }
}

function isPathInside(candidate: string, root: string): boolean {
  const normalizedRoot = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return candidate === root || candidate.startsWith(normalizedRoot);
}

function contentTypeForPath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function authCookie(authToken: string | undefined): Record<string, string> {
  return authToken
    ? {
        "set-cookie": `agentmesh_studio_token=${encodeURIComponent(authToken)}; Path=/; HttpOnly; SameSite=Strict`,
      }
    : {};
}

function studioInitialHeaders(authToken: string | undefined): Record<string, string> {
  return {
    ...authCookie(authToken),
    "referrer-policy": "no-referrer",
  };
}
