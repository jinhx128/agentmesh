import { readFileSync, statSync } from "node:fs";

export function readOptional(filePath: string): string {
  try {
    if (statSync(filePath).isFile()) {
      return readFileSync(filePath, { encoding: "utf-8" });
    }
  } catch {
    return "";
  }
  return "";
}
