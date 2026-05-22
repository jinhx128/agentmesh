import { parse, stringify, TomlError } from "smol-toml";

export function parseTomlDocument(
  content: string,
  label: string,
  errorPrefix = "invalid TOML",
): Record<string, unknown> {
  try {
    const payload = parse(content);
    if (!isRecord(payload)) {
      throw new Error("document root must be a table");
    }
    return payload as Record<string, unknown>;
  } catch (error) {
    if (error instanceof TomlError) {
      throw new Error(`${errorPrefix} ${label}: ${error.message}`);
    }
    throw new Error(
      `${errorPrefix} ${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function stringifyTomlDocument(value: Record<string, unknown>): string {
  return (stringify as (payload: Record<string, unknown>) => string)(value);
}

export function stringifyTomlInlineValue(value: string | string[]): string {
  const line = stringifyTomlDocument({ value }).trim();
  const prefix = "value = ";
  if (!line.startsWith(prefix) || line.includes("\n")) {
    throw new Error("generated TOML value must serialize to one inline assignment");
  }
  return line.slice(prefix.length);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
