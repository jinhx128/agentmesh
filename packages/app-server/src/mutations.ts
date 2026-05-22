import { readFileSync } from "node:fs";
import path from "node:path";

import {
  attachStageArtifact,
  dispatchFlowStage,
  resumeFlow,
  retryFlowStage,
  type DispatchResult,
} from "@agentmesh/runtime/src/flow/index.js";
import {
  isWorkspaceCompatibilityError,
} from "@agentmesh/runtime/src/packet/compatibility.js";
import {
  isRunMutationLockError,
  type RunMutationLockDetails,
} from "@agentmesh/runtime/src/packet/lock.js";

export type StudioMutationRequest =
  | {
      action: "dispatch";
      run_id: string;
      stage: string;
    }
  | {
      action: "retry";
      run_id: string;
      stage?: string;
    }
  | {
      action: "resume";
      run_id: string;
      stage?: string;
    }
  | {
      action: "attach";
      run_id: string;
      stage: string;
      text?: string;
      file?: string;
      agent?: string;
    };

export interface StudioMutationResult {
  action: StudioMutationRequest["action"];
  command: string[];
  exit_code: number | null;
  stdout: string;
  stderr: string;
  duration_ms: number;
  error_code?: StudioMutationErrorCode;
  retryable?: boolean;
  lock?: RunMutationLockDetails;
}

export type StudioMutationErrorCode =
  | "run_locked"
  | "workspace_read_only"
  | "workspace_refused"
  | "mutation_failed";

export interface StudioMutationOptions {
  cwd?: string;
  configPath?: string;
  entrypoint?: string;
}

type StudioRuntimeMutationOptions = Omit<StudioMutationOptions, "cwd"> & { cwd: string };

export async function runStudioMutation(
  request: StudioMutationRequest,
  options: StudioMutationOptions = {},
): Promise<StudioMutationResult> {
  const startedAt = Date.now();
  const command = studioMutationCommand(request, options);
  const cwd = options.cwd ?? process.cwd();
  const result = await runRuntimeMutation(request, { ...options, cwd });
  return {
    action: request.action,
    command,
    exit_code: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    duration_ms: Date.now() - startedAt,
    ...(result.error_code ? { error_code: result.error_code } : {}),
    ...(result.retryable !== undefined ? { retryable: result.retryable } : {}),
    ...(result.lock ? { lock: result.lock } : {}),
  };
}

export function studioMutationCommand(
  request: StudioMutationRequest,
  options: StudioMutationOptions = {},
): string[] {
  const runId = safeToken(request.run_id, "run_id");
  if (request.action === "dispatch") {
    return [
      "runtime",
      "flow",
      "dispatch",
      runId,
      "--stage",
      safeStage(request.stage, true),
    ];
  }
  if (request.action === "retry") {
    return optionalStageCommand("retry", runId, request.stage);
  }
  if (request.action === "resume") {
    return optionalStageCommand("resume", runId, request.stage);
  }
  if (request.action === "attach") {
    const text = request.text;
    const file = request.file;
    if (text !== undefined && typeof text !== "string") {
      throw new Error("text must be a string");
    }
    if (file !== undefined && typeof file !== "string") {
      throw new Error("file must be a string");
    }
    if ((text === undefined || text.length === 0) && (file === undefined || file.length === 0)) {
      throw new Error("attach requires text or file");
    }
    if (text !== undefined && file !== undefined) {
      throw new Error("attach accepts text or file, not both");
    }
    return [
      "runtime",
      "flow",
      "attach",
      runId,
      "--stage",
      safeStage(request.stage),
      ...(request.agent ? ["--agent", safeToken(request.agent, "agent")] : []),
      ...(text !== undefined ? ["--text", text] : ["--file", safePath(file ?? "")]),
    ];
  }
  return unreachable(request);
}

function optionalStageCommand(
  command: "retry" | "resume",
  runId: string,
  stage?: unknown,
): string[] {
  return [
    "runtime",
    "flow",
    command,
    runId,
    ...(stage ? ["--stage", safeStage(stage)] : []),
  ];
}

function safeStage(stage: unknown, allowAll = false): string {
  if (allowAll && stage === "all") {
    return stage;
  }
  return safeToken(stage, "stage");
}

function safeToken(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  if (!value || value.trim().length === 0) {
    throw new Error(`${label} cannot be empty`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`${label} contains unsupported characters: ${value}`);
  }
  return value;
}

function safePath(value: string): string {
  if (value.trim().length === 0) {
    throw new Error("file cannot be empty");
  }
  if (value.includes("\0")) {
    throw new Error("file cannot contain null bytes");
  }
  return value;
}

async function runRuntimeMutation(
  request: StudioMutationRequest,
  options: StudioRuntimeMutationOptions,
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  error_code?: StudioMutationErrorCode;
  retryable?: boolean;
  lock?: RunMutationLockDetails;
}> {
  try {
    if (request.action === "dispatch") {
      const result = await dispatchFlowStage(
        safeToken(request.run_id, "run_id"),
        safeStage(request.stage, true),
        { configPath: options.configPath, entrypoint: options.entrypoint },
        options.cwd,
      );
      return ok(dispatchOutput(result));
    }
    if (request.action === "retry") {
      const result = await retryFlowStage(
        safeToken(request.run_id, "run_id"),
        request.stage === undefined ? undefined : safeStage(request.stage),
        { configPath: options.configPath, entrypoint: options.entrypoint },
        options.cwd,
      );
      return ok(dispatchOutput(result));
    }
    if (request.action === "resume") {
      const result = await resumeFlow(
        safeToken(request.run_id, "run_id"),
        request.stage === undefined ? undefined : safeStage(request.stage),
        { configPath: options.configPath, entrypoint: options.entrypoint },
        options.cwd,
      );
      return ok(dispatchOutput(result));
    }
    const content = attachContent(request, options.cwd);
    const artifactPath = attachStageArtifact(
      safeToken(request.run_id, "run_id"),
      safeStage(request.stage),
      content,
      request.agent ? safeToken(request.agent, "agent") : "current",
      options.cwd,
      { entrypoint: options.entrypoint },
    );
    return ok(`Attached: ${artifactPath}\n`);
  } catch (error) {
    if (isRunMutationLockError(error)) {
      return fail(error.message, "run_locked", true, { lock: error.lock });
    }
    if (isWorkspaceCompatibilityError(error)) {
      return fail(error.message, error.code, false);
    }
    const message = error instanceof Error ? error.message : String(error);
    return fail(message, "mutation_failed", false);
  }
}

function fail(
  message: string,
  errorCode: StudioMutationErrorCode,
  retryable: boolean,
  extra: { lock?: RunMutationLockDetails } = {},
): {
  exitCode: number;
  stdout: string;
  stderr: string;
  error_code: StudioMutationErrorCode;
  retryable: boolean;
  lock?: RunMutationLockDetails;
} {
  return {
    exitCode: 1,
    stdout: "",
    stderr: `${message}\n`,
    error_code: errorCode,
    retryable,
    ...extra,
  };
}

function attachContent(request: Extract<StudioMutationRequest, { action: "attach" }>, cwd: string): string {
  if (request.text !== undefined) {
    return request.text;
  }
  return readFileSync(path.resolve(cwd, safePath(request.file ?? "")), "utf-8");
}

function ok(stdout: string): { exitCode: number; stdout: string; stderr: string } {
  return {
    exitCode: 0,
    stdout,
    stderr: "",
  };
}

function dispatchOutput(result: DispatchResult): string {
  const lines: string[] = [];
  if (result.dispatched.length > 0) {
    lines.push(`Dispatched: ${result.dispatched.join(", ")}`);
  }
  if (result.awaitingCurrent) {
    lines.push(`Awaiting current: ${result.awaitingCurrent}`);
  }
  if (result.dispatched.length === 0 && !result.awaitingCurrent) {
    lines.push("Nothing to dispatch");
  }
  return `${lines.join("\n")}\n`;
}

function unreachable(value: never): never {
  throw new Error(`unsupported mutation action: ${String(value)}`);
}
