import { execFileSync } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeSync,
  closeSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import type { HostScopeInput } from "../flow/types.js";

export const HOST_KINDS = [
  "codex",
  "cursor",
  "claude-code",
  "antigravity",
  "opencode",
  "studio-desktop",
  "headless-cli",
  "unknown",
] as const;

export type HostKind = (typeof HOST_KINDS)[number];

export interface ResolvedHostScope {
  host_kind: HostKind;
  conversation_scope_ref?: string;
  workspace_id: string;
  worktree_id: string;
  scope_source: "native" | "propagated" | "missing";
}

export interface HostScopeOptions {
  hmacKeyPath?: string;
}

const PROPAGATED_SCOPE_TOKEN_PATTERN = /^amscope_v1:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const SCOPE_KEY_FILE_NAME = "reviewer-session-scope.key";

export function resolveHostScope(
  input: HostScopeInput,
  cwd: string,
  options: HostScopeOptions = {},
): ResolvedHostScope {
  const identities = resolveCheckoutIdentities(cwd);
  const hostKind = normalizeHostKind(input.hostKind);
  const nativeConversationId = nonEmptyString(input.nativeConversationId);
  if (nativeConversationId) {
    return {
      host_kind: hostKind,
      conversation_scope_ref: scopeReference(hostKind, "native", nativeConversationId, options),
      ...identities,
      scope_source: "native",
    };
  }

  const propagatedScopeToken = normalizedPropagatedScopeToken(input.propagatedScopeToken);
  if (propagatedScopeToken) {
    return {
      host_kind: hostKind,
      conversation_scope_ref: scopeReference(hostKind, "propagated", propagatedScopeToken, options),
      ...identities,
      scope_source: "propagated",
    };
  }

  return {
    host_kind: hostKind,
    ...identities,
    scope_source: "missing",
  };
}

export function hostScopeKeyPath(): string {
  return path.join(os.homedir(), ".config", "agentmesh", SCOPE_KEY_FILE_NAME);
}

function normalizeHostKind(value: string | undefined): HostKind {
  return typeof value === "string" && HOST_KINDS.includes(value as HostKind)
    ? value as HostKind
    : "unknown";
}

function normalizedPropagatedScopeToken(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const match = PROPAGATED_SCOPE_TOKEN_PATTERN.exec(value);
  return match ? `amscope_v1:${match[1].toLowerCase()}` : undefined;
}

function nonEmptyString(value: string | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function scopeReference(
  hostKind: HostKind,
  source: "native" | "propagated",
  value: string,
  options: HostScopeOptions,
): string {
  const key = loadOrCreateScopeKey(options.hmacKeyPath ?? hostScopeKeyPath());
  const digest = createHmac("sha256", key)
    .update("agentmesh:reviewer-session-scope:v1\0")
    .update(hostKind)
    .update("\0")
    .update(source)
    .update("\0")
    .update(value)
    .digest("hex")
    .slice(0, 16);
  return `cs-${digest}`;
}

function loadOrCreateScopeKey(keyPath: string): Buffer {
  const parent = path.dirname(keyPath);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  chmodSync(parent, 0o700);

  if (!existsSync(keyPath)) {
    const descriptor = createScopeKeyExclusively(keyPath);
    if (descriptor !== undefined) {
      return descriptor;
    }
  }

  const stat = lstatSync(keyPath);
  if (stat.isSymbolicLink()) {
    throw new Error("reviewer session scope key is unsafe");
  }
  chmodSync(keyPath, 0o600);
  const key = readFileSync(keyPath);
  if (key.length === 0) {
    throw new Error("reviewer session scope key is invalid");
  }
  return key;
}

function createScopeKeyExclusively(keyPath: string): Buffer | undefined {
  const key = randomBytes(32);
  let descriptor: number;
  try {
    descriptor = openSync(keyPath, "wx", 0o600);
  } catch (error: unknown) {
    if (isAlreadyExists(error)) {
      return undefined;
    }
    throw new Error("unable to create reviewer session scope key");
  }
  try {
    writeSync(descriptor, key);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(keyPath, 0o600);
  return key;
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "EEXIST";
}

function resolveCheckoutIdentities(cwd: string): { workspace_id: string; worktree_id: string } {
  const realCwd = realpathSync.native(cwd);
  const git = gitCheckoutIdentity(realCwd);
  if (!git) {
    return {
      workspace_id: opaqueIdentity("ws", "non-git-workspace", realCwd),
      worktree_id: opaqueIdentity("wt", "non-git-worktree", realCwd),
    };
  }
  return {
    workspace_id: opaqueIdentity("ws", "git-workspace", git.commonDir),
    worktree_id: opaqueIdentity("wt", "git-worktree", git.topLevel, git.gitDir),
  };
}

function gitCheckoutIdentity(cwd: string): { topLevel: string; commonDir: string; gitDir: string } | undefined {
  try {
    const output = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir", "--git-dir"],
      { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const [topLevel, commonDir, gitDir] = output.trim().split("\n");
    if (!topLevel || !commonDir || !gitDir) {
      return undefined;
    }
    return {
      topLevel: realpathSync.native(topLevel),
      commonDir: realpathSync.native(commonDir),
      gitDir: realpathSync.native(gitDir),
    };
  } catch {
    return undefined;
  }
}

function opaqueIdentity(prefix: "ws" | "wt", domain: string, ...parts: string[]): string {
  const hash = createHash("sha256");
  hash.update(`agentmesh:${domain}:v1\0`);
  for (const part of parts) {
    hash.update(part);
    hash.update("\0");
  }
  return `${prefix}-${hash.digest("hex").slice(0, 16)}`;
}
