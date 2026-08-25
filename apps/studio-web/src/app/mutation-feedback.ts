import { notifications } from "@mantine/notifications";

export interface StudioMutationResponseLike {
  ok: boolean;
  payload: unknown;
}

const SUCCESS_STATUSES = new Set(["succeeded", "success", "completed"]);

export function studioMutationSucceeded(response: unknown): boolean {
  if (!isRecord(response) || response.ok !== true) {
    return false;
  }
  const payload = isRecord(response.payload) ? response.payload : {};
  if (typeof payload.status === "string" && !SUCCESS_STATUSES.has(payload.status.toLowerCase())) {
    return false;
  }
  return typeof payload.exit_code !== "number" || payload.exit_code === 0;
}

export function studioMutationError(response: unknown, fallback: string): string {
  if (!isRecord(response)) {
    return fallback;
  }
  const payload = isRecord(response.payload) ? response.payload : {};
  return firstNonEmptyString(payload.error, payload.stderr, payload.stdout) ?? fallback;
}

export function requireStudioMutationSuccess(response: unknown, fallback: string): void {
  if (!studioMutationSucceeded(response)) {
    throw new Error(studioMutationError(response, fallback));
  }
}

export function showStudioSuccess(title: string, message = "操作已完成"): void {
  notifications.show({
    title,
    message,
    color: "green",
    autoClose: 3_000,
  });
}

export function showStudioError(title: string, message: string): void {
  notifications.show({
    title,
    message,
    color: "red",
    autoClose: 6_000,
  });
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
