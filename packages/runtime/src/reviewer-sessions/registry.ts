import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

export const REVIEWER_SESSION_SCHEMA_VERSION = 1 as const;
export const REVIEWER_SESSION_IDLE_TTL_MS = 2 * 60 * 60 * 1_000;
export const REVIEWER_SESSION_ABSOLUTE_TTL_MS = 12 * 60 * 60 * 1_000;
export const REVIEWER_SESSION_MAX_SUCCESSFUL_RESUMES = 8;

const REGISTRY_KEY_PATTERN = /^rk-[a-f0-9]{32}$/;
const SESSION_REF_PATTERN = /^rs-[a-f0-9]{16}$/;
const INVOCATION_FINGERPRINT_PATTERN = /^if-[a-f0-9]{32}$/;
const ENVIRONMENT_VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface ReviewerSessionEntry {
  schema_version: 1;
  key: string;
  session_ref: string;
  provider_session_id: string;
  epoch: number;
  created_at: string;
  last_used_at: string;
  expires_at: string;
  successful_resumes: number;
  invocation_fingerprint: string;
  estimated_context_tokens?: number;
}

export interface ReviewerSessionInvocationFingerprintInput {
  command: string;
  args: string[];
  capabilities: string[];
  permissionMode: string;
  contextMode: string;
  reviewerPersonaVersion: string;
  promptSchemaVersion: string;
  adapterPluginVersion: string;
  providerCliVersion: string;
  environmentVariableNames: string[];
}

export interface SessionRegistryKeyInput {
  conversationScopeRef?: string;
  workspaceId: string;
  worktreeId: string;
  agentId: string;
  adapterId: string;
  model: string;
  reasoningEffort: string;
  invocation: ReviewerSessionInvocationFingerprintInput;
}

export interface ReviewerSessionRegistryOptions {
  registryPath?: string;
  now?: Date | string;
}

export interface UpsertReviewerSessionInput {
  key: string;
  sessionRef: string;
  providerSessionId: string;
  invocationFingerprint: string;
  expectedEpoch?: number;
  successfulResume?: boolean;
  estimatedContextTokens?: number;
  providerRetentionMs?: number;
  providerSafetyMarginMs?: number;
}

export type ReviewerSessionUnavailableReason =
  | "missing"
  | "unsafe_directory"
  | "unsafe_entry"
  | "invalid_entry"
  | "expired_idle"
  | "expired_absolute"
  | "resume_limit";

export type ReviewerSessionReadResult =
  | { status: "available"; entry: ReviewerSessionEntry }
  | { status: "unavailable"; reason: ReviewerSessionUnavailableReason; diagnostic: string };

export type ReviewerSessionWriteResult =
  | { status: "written"; entry: ReviewerSessionEntry }
  | {
    status: "conflict";
    reason: "epoch_mismatch" | "expired_idle" | "expired_absolute" | "resume_limit" | "not_successful_resume";
    diagnostic: string;
  }
  | { status: "busy"; diagnostic: string }
  | { status: "unavailable"; reason: "unsafe_directory" | "unsafe_entry" | "invalid_entry"; diagnostic: string };

export type ReviewerSessionCloseResult =
  | { status: "closed"; epoch: number }
  | { status: "already_absent" }
  | { status: "conflict"; reason: "epoch_mismatch"; diagnostic: string }
  | { status: "busy"; diagnostic: string }
  | { status: "unavailable"; reason: "unsafe_directory" | "unsafe_entry" | "invalid_entry"; diagnostic: string };

export type ReviewerSessionLifecycle = "reusable" | "expired_idle" | "expired_absolute" | "resume_limit";

export type ReviewerSessionPurgeResult =
  | { status: "purged"; removed: number }
  | { status: "unavailable"; reason: "unsafe_directory"; diagnostic: string };

interface FileIdentity {
  device: number | bigint;
  inode: number | bigint;
}

type RegistryDirectoryResult =
  | { safe: true; registryPath: string }
  | { safe: false; reason: "unsafe_directory"; diagnostic: string };

type InspectedEntry =
  | { kind: "missing" }
  | { kind: "unsafe" }
  | { kind: "invalid"; identity: FileIdentity }
  | { kind: "valid"; entry: ReviewerSessionEntry; identity: FileIdentity };

type InspectedEpoch =
  | { kind: "missing" }
  | { kind: "unsafe" }
  | { kind: "invalid"; identity: FileIdentity }
  | { kind: "valid"; epoch: number; identity: FileIdentity };

const reviewerSessionEntrySchema = z.object({
  schema_version: z.literal(REVIEWER_SESSION_SCHEMA_VERSION),
  key: z.string().regex(REGISTRY_KEY_PATTERN),
  session_ref: z.string().regex(SESSION_REF_PATTERN),
  provider_session_id: z.string().min(1),
  epoch: z.number().int().nonnegative(),
  created_at: z.string().refine(isValidInstant),
  last_used_at: z.string().refine(isValidInstant),
  expires_at: z.string().refine(isValidInstant),
  successful_resumes: z.number().int().nonnegative().max(REVIEWER_SESSION_MAX_SUCCESSFUL_RESUMES),
  invocation_fingerprint: z.string().regex(INVOCATION_FINGERPRINT_PATTERN),
  estimated_context_tokens: z.number().finite().nonnegative().optional(),
}).strict();

const reviewerSessionEpochSchema = z.object({
  schema_version: z.literal(REVIEWER_SESSION_SCHEMA_VERSION),
  key: z.string().regex(REGISTRY_KEY_PATTERN),
  epoch: z.number().int().nonnegative(),
}).strict();

export function reviewerSessionRegistryPath(): string {
  return path.join(os.homedir(), ".config", "agentmesh", "reviewer-sessions");
}

export function reviewerSessionInvocationFingerprint(
  input: ReviewerSessionInvocationFingerprintInput,
): string {
  const normalized = normalizeInvocation(input);
  return `if-${digest("agentmesh:reviewer-session-invocation:v1", JSON.stringify(normalized), 32)}`;
}

export function sessionRegistryKey(input: SessionRegistryKeyInput): string {
  const conversationScopeRef = requiredString(input.conversationScopeRef, "conversation scope is required");
  const normalized = {
    conversation_scope_ref: conversationScopeRef,
    workspace_id: requiredString(input.workspaceId, "workspace id is required"),
    worktree_id: requiredString(input.worktreeId, "worktree id is required"),
    agent_id: requiredString(input.agentId, "agent id is required"),
    adapter_id: requiredString(input.adapterId, "adapter id is required"),
    model: requiredString(input.model, "model is required"),
    reasoning_effort: requiredString(input.reasoningEffort, "reasoning effort is required"),
    invocation_fingerprint: reviewerSessionInvocationFingerprint(input.invocation),
  };
  return `rk-${digest("agentmesh:reviewer-session-registry-key:v1", JSON.stringify(normalized), 32)}`;
}

export function reviewerSessionRef(key: string): string {
  assertRegistryKey(key);
  return `rs-${digest("agentmesh:reviewer-session-reference:v1", key, 16)}`;
}

export function readReviewerSession(
  key: string,
  options: ReviewerSessionRegistryOptions = {},
): ReviewerSessionReadResult {
  assertRegistryKey(key);
  const directory = ensureRegistryDirectory(options.registryPath ?? reviewerSessionRegistryPath());
  if (!directory.safe) {
    return unavailable(directory.reason, directory.diagnostic);
  }
  const inspected = inspectEntry(directory.registryPath, key);
  if (inspected.kind === "missing") {
    return unavailable("missing", "reviewer session is unavailable");
  }
  if (inspected.kind === "unsafe") {
    return unavailable("unsafe_entry", "reviewer session entry is unsafe");
  }
  if (inspected.kind === "invalid") {
    return unavailable("invalid_entry", "reviewer session entry is invalid");
  }
  const epoch = inspectEpoch(directory.registryPath, key);
  if (epoch.kind === "unsafe") {
    return unavailable("unsafe_entry", "reviewer session entry is unsafe");
  }
  if (epoch.kind !== "valid" || epoch.epoch !== inspected.entry.epoch) {
    return unavailable("invalid_entry", "reviewer session entry is invalid");
  }
  const lifecycle = evaluateReviewerSessionLifecycle(inspected.entry, options);
  if (lifecycle !== "reusable") {
    return unavailable(lifecycle, lifecycleDiagnostic(lifecycle));
  }
  return { status: "available", entry: inspected.entry };
}

export function upsertReviewerSession(
  input: UpsertReviewerSessionInput,
  options: ReviewerSessionRegistryOptions = {},
): ReviewerSessionWriteResult {
  validateUpsertInput(input);
  const registryPath = options.registryPath ?? reviewerSessionRegistryPath();
  const directory = ensureRegistryDirectory(registryPath);
  if (!directory.safe) {
    return { status: "unavailable", reason: directory.reason, diagnostic: directory.diagnostic };
  }
  return withMutationLock(directory.registryPath, input.key, () => {
    const current = inspectEntry(directory.registryPath, input.key);
    const currentEpoch = inspectEpoch(directory.registryPath, input.key);
    if (current.kind === "unsafe") {
      return { status: "unavailable", reason: "unsafe_entry", diagnostic: "reviewer session entry is unsafe" };
    }
    if (currentEpoch.kind === "unsafe") {
      return { status: "unavailable", reason: "unsafe_entry", diagnostic: "reviewer session entry is unsafe" };
    }
    if (current.kind === "invalid") {
      return { status: "unavailable", reason: "invalid_entry", diagnostic: "reviewer session entry is invalid" };
    }
    if (currentEpoch.kind === "invalid") {
      return { status: "unavailable", reason: "invalid_entry", diagnostic: "reviewer session entry is invalid" };
    }
    if (current.kind === "missing") {
      if (input.expectedEpoch !== undefined) {
        return epochConflict();
      }
      const epoch = currentEpoch.kind === "valid" ? currentEpoch.epoch + 1 : 1;
      const entry = freshEntry(input, epoch, options.now);
      atomicWriteEpoch(directory.registryPath, input.key, epoch, currentEpoch.kind === "valid" ? currentEpoch.identity : undefined);
      atomicWriteEntry(directory.registryPath, entry, undefined);
      return { status: "written", entry };
    }
    if (currentEpoch.kind === "valid" && currentEpoch.epoch > current.entry.epoch) {
      if (input.expectedEpoch !== undefined) {
        return epochConflict();
      }
      const epoch = currentEpoch.epoch + 1;
      const entry = freshEntry(input, epoch, options.now);
      atomicWriteEpoch(directory.registryPath, input.key, epoch, currentEpoch.identity);
      atomicWriteEntry(directory.registryPath, entry, current.identity);
      return { status: "written", entry };
    }
    if (currentEpoch.kind !== "valid" || currentEpoch.epoch !== current.entry.epoch) {
      return { status: "unavailable", reason: "invalid_entry", diagnostic: "reviewer session entry is invalid" };
    }
    if (input.expectedEpoch === undefined || input.expectedEpoch !== current.entry.epoch) {
      return epochConflict();
    }
    if (
      current.entry.session_ref !== input.sessionRef
      || current.entry.invocation_fingerprint !== input.invocationFingerprint
    ) {
      return epochConflict();
    }
    const lifecycle = evaluateReviewerSessionLifecycle(current.entry, options);
    if (lifecycle !== "reusable") {
      return {
        status: "conflict",
        reason: lifecycle,
        diagnostic: lifecycleDiagnostic(lifecycle),
      };
    }
    if (input.successfulResume !== true) {
      return {
        status: "conflict",
        reason: "not_successful_resume",
        diagnostic: "reviewer session update requires a successful resume",
      };
    }
    const entry: ReviewerSessionEntry = {
      ...current.entry,
      provider_session_id: input.providerSessionId,
      epoch: current.entry.epoch + 1,
      last_used_at: instant(options.now),
      successful_resumes: current.entry.successful_resumes + 1,
      ...(input.estimatedContextTokens !== undefined
        ? { estimated_context_tokens: input.estimatedContextTokens }
        : {}),
    };
    atomicWriteEpoch(directory.registryPath, input.key, entry.epoch, currentEpoch.identity);
    atomicWriteEntry(directory.registryPath, entry, current.identity);
    return { status: "written", entry };
  });
}

export function closeReviewerSession(
  key: string,
  options: ReviewerSessionRegistryOptions & { expectedEpoch?: number } = {},
): ReviewerSessionCloseResult {
  assertRegistryKey(key);
  if (options.expectedEpoch !== undefined) {
    nonNegativeInteger(options.expectedEpoch, "expected epoch");
  }
  const registryPath = options.registryPath ?? reviewerSessionRegistryPath();
  const directory = ensureRegistryDirectory(registryPath);
  if (!directory.safe) {
    return { status: "unavailable", reason: directory.reason, diagnostic: directory.diagnostic };
  }
  return withMutationLock(directory.registryPath, key, () => {
    const current = inspectEntry(directory.registryPath, key);
    const currentEpoch = inspectEpoch(directory.registryPath, key);
    if (current.kind === "missing") {
      if (currentEpoch.kind === "unsafe") {
        return { status: "unavailable", reason: "unsafe_entry", diagnostic: "reviewer session entry is unsafe" };
      }
      if (currentEpoch.kind === "invalid") {
        return { status: "unavailable", reason: "invalid_entry", diagnostic: "reviewer session entry is invalid" };
      }
      if (options.expectedEpoch === undefined) {
        return { status: "already_absent" };
      }
      return currentEpoch.kind === "valid" && currentEpoch.epoch === options.expectedEpoch + 1
        ? { status: "closed", epoch: currentEpoch.epoch }
        : epochConflict();
    }
    if (current.kind === "unsafe") {
      return { status: "unavailable", reason: "unsafe_entry", diagnostic: "reviewer session entry is unsafe" };
    }
    if (current.kind === "invalid") {
      return { status: "unavailable", reason: "invalid_entry", diagnostic: "reviewer session entry is invalid" };
    }
    if (currentEpoch.kind === "unsafe") {
      return { status: "unavailable", reason: "unsafe_entry", diagnostic: "reviewer session entry is unsafe" };
    }
    if (currentEpoch.kind === "valid" && currentEpoch.epoch > current.entry.epoch) {
      if (
        options.expectedEpoch !== undefined
        && (current.entry.epoch !== options.expectedEpoch || currentEpoch.epoch !== options.expectedEpoch + 1)
      ) {
        return epochConflict();
      }
      unlinkSync(entryPath(directory.registryPath, key));
      syncDirectory(directory.registryPath);
      return { status: "closed", epoch: currentEpoch.epoch };
    }
    if (currentEpoch.kind !== "valid" || currentEpoch.epoch !== current.entry.epoch) {
      return { status: "unavailable", reason: "invalid_entry", diagnostic: "reviewer session entry is invalid" };
    }
    if (options.expectedEpoch !== undefined && options.expectedEpoch !== current.entry.epoch) {
      return epochConflict();
    }
    const epoch = current.entry.epoch + 1;
    atomicWriteEpoch(directory.registryPath, key, epoch, currentEpoch.identity);
    unlinkSync(entryPath(directory.registryPath, key));
    syncDirectory(directory.registryPath);
    return { status: "closed", epoch };
  });
}

export function purgeReviewerSessions(
  options: ReviewerSessionRegistryOptions = {},
): ReviewerSessionPurgeResult {
  const directory = ensureRegistryDirectory(options.registryPath ?? reviewerSessionRegistryPath());
  if (!directory.safe) {
    return { status: "unavailable", reason: directory.reason, diagnostic: directory.diagnostic };
  }
  let removed = 0;
  for (const name of readdirSync(directory.registryPath)) {
    const candidatePath = path.join(directory.registryPath, name);
    if (isTemporaryArtifact(name)) {
      if (removeSafeRegularFile(candidatePath)) {
        removed += 1;
      }
      continue;
    }
    const match = /^(rk-[a-f0-9]{32})\.json$/.exec(name);
    if (!match) {
      continue;
    }
    const key = match[1];
    const inspection = inspectEntry(directory.registryPath, key);
    const inspectedEpoch = inspectEpoch(directory.registryPath, key);
    if (inspection.kind === "unsafe" || inspection.kind === "missing") {
      continue;
    }
    if (inspectedEpoch.kind === "unsafe" || inspectedEpoch.kind === "invalid") {
      continue;
    }
    if (
      inspection.kind === "invalid"
      || inspectedEpoch.kind !== "valid"
      || inspectedEpoch.epoch !== inspection.entry.epoch
      || evaluateReviewerSessionLifecycle(inspection.entry, options) !== "reusable"
    ) {
      const result = withMutationLock(directory.registryPath, key, () => {
        const current = inspectEntry(directory.registryPath, key);
        const currentEpoch = inspectEpoch(directory.registryPath, key);
        if (current.kind === "unsafe" || current.kind === "missing") {
          return false;
        }
        if (currentEpoch.kind === "unsafe" || currentEpoch.kind === "invalid") {
          return false;
        }
        if (
          current.kind === "valid"
          && currentEpoch.kind === "valid"
          && currentEpoch.epoch === current.entry.epoch
          && evaluateReviewerSessionLifecycle(current.entry, options) === "reusable"
        ) {
          return false;
        }
        unlinkSync(candidatePath);
        syncDirectory(directory.registryPath);
        return true;
      });
      if (typeof result === "boolean" && result) {
        removed += 1;
      }
    }
  }
  return { status: "purged", removed };
}

export function evaluateReviewerSessionLifecycle(
  entry: Pick<ReviewerSessionEntry, "created_at" | "last_used_at" | "expires_at" | "successful_resumes">,
  options: Pick<ReviewerSessionRegistryOptions, "now"> = {},
): ReviewerSessionLifecycle {
  const now = instantMilliseconds(options.now);
  const expiresAt = parseInstant(entry.expires_at, "entry expiry");
  const lastUsedAt = parseInstant(entry.last_used_at, "entry last use");
  if (now >= expiresAt) {
    return "expired_absolute";
  }
  if (now >= lastUsedAt + REVIEWER_SESSION_IDLE_TTL_MS) {
    return "expired_idle";
  }
  if (entry.successful_resumes >= REVIEWER_SESSION_MAX_SUCCESSFUL_RESUMES) {
    return "resume_limit";
  }
  return "reusable";
}

/**
 * Uses estimated total context against a known provider limit. Without a
 * provider limit there is no defensible percentage, so the result stays
 * `keep`; the caller may surface telemetry uncertainty separately.
 */
export function shouldRotateForContext(input: {
  estimatedHistory: number;
  currentPacket: number;
  reservedOutput: number;
  reasoningHeadroom: number;
  providerLimit?: number;
}): "keep" | "warn" | "rotate" {
  for (const [label, value] of Object.entries(input)) {
    if (value !== undefined) {
      nonNegativeFinite(value, label);
    }
  }
  if (input.providerLimit === undefined) {
    return "keep";
  }
  const total = input.estimatedHistory + input.currentPacket + input.reservedOutput + input.reasoningHeadroom;
  if (total >= input.providerLimit * 0.8) {
    return "rotate";
  }
  if (total >= input.providerLimit * 0.6) {
    return "warn";
  }
  return "keep";
}

function normalizeInvocation(input: ReviewerSessionInvocationFingerprintInput): Record<string, unknown> {
  if (!Array.isArray(input.args) || input.args.some((argument) => typeof argument !== "string")) {
    throw new Error("invocation arguments are invalid");
  }
  if (!Array.isArray(input.environmentVariableNames)
    || input.environmentVariableNames.some((name) => !ENVIRONMENT_VARIABLE_NAME_PATTERN.test(name))) {
    throw new Error("environment variable names are invalid");
  }
  return {
    command: requiredString(input.command, "invocation command is required"),
    args: [...input.args],
    capabilities: normalizedStringSet(input.capabilities, "invocation capabilities are invalid"),
    permission_mode: requiredString(input.permissionMode, "permission mode is required"),
    context_mode: requiredString(input.contextMode, "context mode is required"),
    reviewer_persona_version: requiredString(input.reviewerPersonaVersion, "reviewer persona version is required"),
    prompt_schema_version: requiredString(input.promptSchemaVersion, "prompt schema version is required"),
    adapter_plugin_version: requiredString(input.adapterPluginVersion, "adapter plugin version is required"),
    provider_cli_version: requiredString(input.providerCliVersion, "provider CLI version is required"),
    environment_variable_names: [...new Set(input.environmentVariableNames)].sort(),
  };
}

function validateUpsertInput(input: UpsertReviewerSessionInput): void {
  assertRegistryKey(input.key);
  if (input.sessionRef !== reviewerSessionRef(input.key)) {
    throw new Error("reviewer session reference does not match registry key");
  }
  if (!INVOCATION_FINGERPRINT_PATTERN.test(input.invocationFingerprint)) {
    throw new Error("reviewer session invocation fingerprint is invalid");
  }
  requiredString(input.providerSessionId, "provider session identity is required");
  if (input.expectedEpoch !== undefined) {
    nonNegativeInteger(input.expectedEpoch, "expected epoch");
  }
  if (input.estimatedContextTokens !== undefined) {
    nonNegativeFinite(input.estimatedContextTokens, "estimated context tokens");
  }
  if (input.providerRetentionMs !== undefined) {
    nonNegativeFinite(input.providerRetentionMs, "provider retention");
  }
  if (input.providerSafetyMarginMs !== undefined) {
    nonNegativeFinite(input.providerSafetyMarginMs, "provider safety margin");
    if (input.providerRetentionMs === undefined) {
      throw new Error("provider safety margin requires provider retention");
    }
  }
}

function freshEntry(
  input: UpsertReviewerSessionInput,
  epoch: number,
  nowInput: Date | string | undefined,
): ReviewerSessionEntry {
  const now = instant(nowInput);
  return {
    schema_version: REVIEWER_SESSION_SCHEMA_VERSION,
    key: input.key,
    session_ref: input.sessionRef,
    provider_session_id: input.providerSessionId,
    epoch,
    created_at: now,
    last_used_at: now,
    expires_at: absoluteExpiry(now, input.providerRetentionMs, input.providerSafetyMarginMs),
    successful_resumes: 0,
    invocation_fingerprint: input.invocationFingerprint,
    ...(input.estimatedContextTokens !== undefined
      ? { estimated_context_tokens: input.estimatedContextTokens }
      : {}),
  };
}

function ensureRegistryDirectory(registryPath: string): RegistryDirectoryResult {
  try {
    try {
      const stat = lstatSync(registryPath);
      if (!stat.isDirectory() || !hasSafeModeAndOwner(stat, 0o700)) {
        return unsafeDirectory();
      }
      return { safe: true, registryPath };
    } catch (error: unknown) {
      if (!isNotFound(error)) {
        return unsafeDirectory();
      }
    }
    mkdirSync(registryPath, { recursive: true, mode: 0o700 });
    const stat = lstatSync(registryPath);
    if (!stat.isDirectory() || !hasSafeModeAndOwner(stat, 0o700)) {
      return unsafeDirectory();
    }
    return { safe: true, registryPath };
  } catch {
    return unsafeDirectory();
  }
}

function inspectEntry(registryPath: string, key: string): InspectedEntry {
  const filePath = entryPath(registryPath, key);
  let initial: ReturnType<typeof lstatSync>;
  try {
    initial = lstatSync(filePath);
  } catch (error: unknown) {
    return isNotFound(error) ? { kind: "missing" } : { kind: "unsafe" };
  }
  if (!initial.isFile() || !hasSafeModeAndOwner(initial, 0o600)) {
    return { kind: "unsafe" };
  }
  const identity = fileIdentity(initial);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(filePath, constants.O_RDONLY | noFollowFlag());
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || !sameFileIdentity(identity, fileIdentity(opened)) || !hasSafeModeAndOwner(opened, 0o600)) {
      return { kind: "unsafe" };
    }
    const payload: unknown = JSON.parse(readFileSync(descriptor, "utf-8"));
    const parsed = reviewerSessionEntrySchema.safeParse(payload);
    if (!parsed.success || parsed.data.key !== key || parsed.data.session_ref !== reviewerSessionRef(key)) {
      return { kind: "invalid", identity };
    }
    return { kind: "valid", entry: parsed.data, identity };
  } catch {
    return { kind: "invalid", identity };
  } finally {
    if (descriptor !== undefined) {
      bestEffortClose(descriptor);
    }
  }
}

function inspectEpoch(registryPath: string, key: string): InspectedEpoch {
  const filePath = epochPath(registryPath, key);
  let initial: ReturnType<typeof lstatSync>;
  try {
    initial = lstatSync(filePath);
  } catch (error: unknown) {
    return isNotFound(error) ? { kind: "missing" } : { kind: "unsafe" };
  }
  if (!initial.isFile() || !hasSafeModeAndOwner(initial, 0o600)) {
    return { kind: "unsafe" };
  }
  const identity = fileIdentity(initial);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(filePath, constants.O_RDONLY | noFollowFlag());
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || !sameFileIdentity(identity, fileIdentity(opened)) || !hasSafeModeAndOwner(opened, 0o600)) {
      return { kind: "unsafe" };
    }
    const payload: unknown = JSON.parse(readFileSync(descriptor, "utf-8"));
    const parsed = reviewerSessionEpochSchema.safeParse(payload);
    if (!parsed.success || parsed.data.key !== key) {
      return { kind: "invalid", identity };
    }
    return { kind: "valid", epoch: parsed.data.epoch, identity };
  } catch {
    return { kind: "invalid", identity };
  } finally {
    if (descriptor !== undefined) {
      bestEffortClose(descriptor);
    }
  }
}

function atomicWriteEpoch(
  registryPath: string,
  key: string,
  epoch: number,
  expectedIdentity: FileIdentity | undefined,
): void {
  atomicWriteJson(
    registryPath,
    epochPath(registryPath, key),
    { schema_version: REVIEWER_SESSION_SCHEMA_VERSION, key, epoch },
    expectedIdentity,
  );
}

function atomicWriteEntry(
  registryPath: string,
  entry: ReviewerSessionEntry,
  expectedIdentity: FileIdentity | undefined,
): void {
  atomicWriteJson(registryPath, entryPath(registryPath, entry.key), entry, expectedIdentity);
}

function atomicWriteJson(
  registryPath: string,
  filePath: string,
  payload: unknown,
  expectedIdentity: FileIdentity | undefined,
): void {
  const temporaryPath = path.join(
    registryPath,
    `.${path.basename(filePath)}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`,
  );
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag(),
      0o600,
    );
    writeFully(descriptor, Buffer.from(`${JSON.stringify(payload, null, 2)}\n`));
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    assertTargetIdentity(filePath, expectedIdentity);
    renameSync(temporaryPath, filePath);
    syncDirectory(registryPath);
  } finally {
    if (descriptor !== undefined) {
      bestEffortClose(descriptor);
    }
    bestEffortUnlink(temporaryPath);
  }
}

function withMutationLock<T>(
  registryPath: string,
  key: string,
  operation: () => T,
): T | { status: "busy"; diagnostic: string } {
  const lockPath = path.join(registryPath, `.${key}.mutation`);
  let descriptor: number | undefined;
  let identity: FileIdentity | undefined;
  try {
    try {
      descriptor = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag(), 0o600);
    } catch (error: unknown) {
      if (isAlreadyExists(error)) {
        return { status: "busy", diagnostic: "reviewer session registry mutation is busy" };
      }
      throw error;
    }
    identity = fileIdentity(fstatSync(descriptor));
    return operation();
  } finally {
    if (descriptor !== undefined) {
      bestEffortClose(descriptor);
    }
    if (identity) {
      removeIfCurrent(lockPath, identity);
    }
  }
}

function removeSafeRegularFile(filePath: string): boolean {
  try {
    const stat = lstatSync(filePath);
    if (!stat.isFile() || !hasSafeModeAndOwner(stat, 0o600)) {
      return false;
    }
    unlinkSync(filePath);
    syncDirectory(path.dirname(filePath));
    return true;
  } catch {
    return false;
  }
}

function removeIfCurrent(filePath: string, expectedIdentity: FileIdentity): void {
  try {
    const stat = lstatSync(filePath);
    if (stat.isFile() && sameFileIdentity(fileIdentity(stat), expectedIdentity)) {
      unlinkSync(filePath);
    }
  } catch {
    // Cleanup cannot replace the primary mutation result.
  }
}

function assertTargetIdentity(filePath: string, expectedIdentity: FileIdentity | undefined): void {
  try {
    const stat = lstatSync(filePath);
    if (!expectedIdentity
      || !stat.isFile()
      || !hasSafeModeAndOwner(stat, 0o600)
      || !sameFileIdentity(fileIdentity(stat), expectedIdentity)) {
      throw new Error("reviewer session entry changed during mutation");
    }
  } catch (error: unknown) {
    if (expectedIdentity === undefined && isNotFound(error)) {
      return;
    }
    throw error;
  }
}

function absoluteExpiry(
  createdAt: string,
  providerRetentionMs: number | undefined,
  providerSafetyMarginMs: number | undefined,
): string {
  const localCap = REVIEWER_SESSION_ABSOLUTE_TTL_MS;
  const providerCap = providerRetentionMs === undefined
    ? localCap
    : Math.max(0, providerRetentionMs - (providerSafetyMarginMs ?? 0));
  return new Date(parseInstant(createdAt, "entry creation") + Math.min(localCap, providerCap)).toISOString();
}

function instant(value: Date | string | undefined): string {
  return new Date(instantMilliseconds(value)).toISOString();
}

function instantMilliseconds(value: Date | string | undefined): number {
  if (value === undefined) {
    return Date.now();
  }
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new Error("registry clock must be a valid instant");
  }
  return milliseconds;
}

function parseInstant(value: string, label: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`${label} must be a valid instant`);
  }
  return milliseconds;
}

function isValidInstant(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function writeFully(descriptor: number, data: Buffer): void {
  let offset = 0;
  while (offset < data.length) {
    const written = writeSync(descriptor, data, offset, data.length - offset, offset);
    if (written === 0) {
      throw new Error("unable to persist reviewer session entry");
    }
    offset += written;
  }
}

function syncDirectory(directory: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(directory, constants.O_RDONLY);
    fsyncSync(descriptor);
  } catch {
    // Some supported filesystems do not permit directory fsync.
  } finally {
    if (descriptor !== undefined) {
      bestEffortClose(descriptor);
    }
  }
}

function digest(domain: string, value: string, length: number): string {
  return createHash("sha256").update(domain).update("\0").update(value).digest("hex").slice(0, length);
}

function normalizedStringSet(values: string[], diagnostic: string): string[] {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value.trim().length === 0)) {
    throw new Error(diagnostic);
  }
  return [...new Set(values.map((value) => value.trim()))].sort();
}

function requiredString(value: string | undefined, diagnostic: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(diagnostic);
  }
  return value.trim();
}

function nonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be non-negative finite`);
  }
}

function nonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

function assertRegistryKey(key: string): void {
  if (!REGISTRY_KEY_PATTERN.test(key)) {
    throw new Error("reviewer session registry key is invalid");
  }
}

function entryPath(registryPath: string, key: string): string {
  return path.join(registryPath, `${key}.json`);
}

function epochPath(registryPath: string, key: string): string {
  return path.join(registryPath, `${key}.epoch.json`);
}

function isTemporaryArtifact(name: string): boolean {
  return /^\.rk-[a-f0-9]{32}\..+\.tmp$/.test(name);
}

function hasSafeModeAndOwner(stat: { mode: number; uid: number }, mode: number): boolean {
  const getuid = process.getuid;
  return (stat.mode & 0o777) === mode && (typeof getuid !== "function" || stat.uid === getuid.call(process));
}

function fileIdentity(stat: { dev: number | bigint; ino: number | bigint }): FileIdentity {
  return { device: stat.dev, inode: stat.ino };
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function noFollowFlag(): number {
  return "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
}

function unavailable(
  reason: ReviewerSessionUnavailableReason,
  diagnostic: string,
): ReviewerSessionReadResult {
  return { status: "unavailable", reason, diagnostic };
}

function unsafeDirectory(): RegistryDirectoryResult {
  return { safe: false, reason: "unsafe_directory", diagnostic: "reviewer session registry directory is unsafe" };
}

function epochConflict(): { status: "conflict"; reason: "epoch_mismatch"; diagnostic: string } {
  return { status: "conflict", reason: "epoch_mismatch", diagnostic: "reviewer session epoch mismatch" };
}

function lifecycleDiagnostic(lifecycle: Exclude<ReviewerSessionLifecycle, "reusable">): string {
  if (lifecycle === "resume_limit") {
    return "reviewer session resume limit reached";
  }
  return "reviewer session expired";
}

function bestEffortClose(descriptor: number): void {
  try {
    closeSync(descriptor);
  } catch {
    // Cleanup cannot replace the primary operation result.
  }
}

function bestEffortUnlink(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch {
    // Cleanup cannot replace the primary operation result.
  }
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "EEXIST";
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT";
}
