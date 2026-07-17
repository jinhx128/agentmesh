import { readFileSync } from "node:fs";

export function parseGlobalArgs(argv: string[]): { args: string[]; configPath?: string } {
  const args = [...argv];
  let configPath: string | undefined;
  if (args[0] === "--config") {
    configPath = args[1];
    if (!configPath) {
      throw new Error("--config requires a path");
    }
    args.splice(0, 2);
  }
  return { args, configPath };
}

export function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

export function optionValues(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) {
      values.push(args[index + 1]);
      index += 1;
    }
  }
  return values;
}

export function firstPresent(args: string[], names: string[]): string | undefined {
  return names.find((name) => args.includes(name));
}

export function optionalInteger(args: string[], name: string): number | undefined {
  const value = optionValue(args, name);
  return value ? Number.parseInt(value, 10) : undefined;
}

export function readOptionFile(args: string[], name: string): string | undefined {
  const filePath = optionValue(args, name);
  return filePath ? readFileSync(filePath, { encoding: "utf-8" }) : undefined;
}

export function positionalArgs(args: string[]): string[] {
  const output: string[] = [];
  const optionsWithValues = new Set([
    "--agent",
    "--prompt",
    "--prompt-file",
    "--output-file",
    "--timeout-secs",
    "--timeout-seconds",
    "--model",
    "--reasoning-effort",
    "--workflow",
    "--workflow-file",
    "--plan",
    "--execute",
    "--verify",
    "--review",
    "--decide",
    "--task",
    "--task-file",
    "--title",
    "--statement",
    "--source",
    "--owner",
    "--id",
    "--status",
    "--entrypoint",
    "--reason",
    "--related-commit",
    "--related-run-id",
    "--superseded-by-call-id",
    "--scope",
    "--context-file",
    "--diff-file",
    "--verification-file",
    "--mcp-resource",
    "--exclude-correction",
    "--run-id",
    "--review-session-mode",
    "--host-kind",
    "--conversation-scope",
    "--stage",
    "--file",
    "--text",
    "--target",
    "--output",
    "--adapter",
    "--capability",
    "--command",
    "--arg",
    "--resource-hint",
    "--label",
    "--format",
    "--path",
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--")) {
      if (optionsWithValues.has(arg)) {
        index += 1;
      }
      continue;
    }
    output.push(arg);
  }
  return output;
}
