import path from "node:path";

const MAX_DISPLAY_TITLE_CHARACTERS = 80;

export interface ResolveDisplayTitleInput {
  title?: string;
  workspace: string;
  summaries: Array<string | undefined>;
  createdAt: Date;
}

export function normalizeDisplayTitle(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/gu, " ");
  if (!normalized) {
    return undefined;
  }
  return truncateTitle(normalized);
}

export function resolveDisplayTitle(input: ResolveDisplayTitleInput): string {
  const explicitTitle = normalizeDisplayTitle(input.title);
  if (explicitTitle) {
    return explicitTitle;
  }
  const workspace = workspaceName(input.workspace);
  const summary = input.summaries
    .map(summaryLine)
    .find((value): value is string => Boolean(value));
  return truncateTitle(`${workspace}-${summary ?? formatLocalTime(input.createdAt)}`);
}

function summaryLine(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  for (const rawLine of value.split(/\r?\n/u)) {
    const line = rawLine
      .trim()
      .replace(/^(?:#{1,6}\s*|[-*+>]\s*|\d+[.)]\s*)/u, "");
    const normalized = normalizeDisplayTitle(line);
    if (normalized && !["general", "request"].includes(normalized.toLowerCase())) {
      return normalized;
    }
  }
  return undefined;
}

function workspaceName(workspace: string): string {
  return normalizeDisplayTitle(path.basename(path.resolve(workspace))) ?? "workspace";
}

function formatLocalTime(date: Date): string {
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function truncateTitle(value: string): string {
  const characters = Array.from(value);
  if (characters.length <= MAX_DISPLAY_TITLE_CHARACTERS) {
    return value;
  }
  return `${characters.slice(0, MAX_DISPLAY_TITLE_CHARACTERS - 1).join("")}…`;
}
