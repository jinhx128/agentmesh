export interface StudioArgs {
  host: string;
  port: number;
}

export function parseStudioArgs(args: string[]): StudioArgs {
  return {
    host: optionValue(args, "--host") ?? "127.0.0.1",
    port: parsePort(optionValue(args, "--port") ?? "4777"),
  };
}

function parsePort(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`invalid --port: ${value}`);
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    throw new Error(`invalid --port: ${value}`);
  }
  return port;
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`missing value for ${name}`);
  }
  return value;
}
