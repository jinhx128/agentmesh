import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

export type TimestampedIdKind = "preset" | "workflow" | "call";

export interface ReservedTimestampedId {
  id: string;
  path: string;
}

export function formatLocalTimestamp(date: Date): string {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    twoDigit(date.getMonth() + 1),
    twoDigit(date.getDate()),
    twoDigit(date.getHours()),
    twoDigit(date.getMinutes()),
    twoDigit(date.getSeconds()),
  ].join("");
}

export function nextTimestampedId(
  kind: TimestampedIdKind,
  directory: string,
  date = new Date(),
): string {
  const base = `${kind}-${formatLocalTimestamp(date)}`;
  return nextAvailableId(base, directory);
}

export function reserveTimestampedId(
  kind: TimestampedIdKind,
  directory: string,
  date = new Date(),
): ReservedTimestampedId {
  mkdirSync(directory, { recursive: true });
  const base = `${kind}-${formatLocalTimestamp(date)}`;
  for (let index = 0; ; index += 1) {
    const id = index === 0 ? base : `${base}-${index}`;
    const candidatePath = path.join(directory, id);
    try {
      mkdirSync(candidatePath);
      return { id, path: candidatePath };
    } catch (error) {
      if (isErrnoException(error) && error.code === "EEXIST") {
        continue;
      }
      throw error;
    }
  }
}

function nextAvailableId(base: string, directory: string): string {
  if (!existsSync(path.join(directory, base))) {
    return base;
  }
  for (let index = 1; ; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existsSync(path.join(directory, candidate))) {
      return candidate;
    }
  }
}

function twoDigit(value: number): string {
  return String(value).padStart(2, "0");
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
