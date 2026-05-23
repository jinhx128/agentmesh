import { detectSupportedProviderClis } from "@agentmesh/runtime/src/adapters/provider-cli-diagnostics.js";

const USAGE = "usage: agentmesh cli detect [--json]";

export function cliDetect(args: string[]): number {
  const json = args.includes("--json");
  const positional = args.filter((arg) => arg !== "--json");
  if (positional.length !== 0) {
    console.error(USAGE);
    return 2;
  }
  const report = detectSupportedProviderClis({
    enabled: true,
    workspace: process.cwd(),
  });
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  for (const tool of report.tools) {
    console.log([
      tool.tool,
      tool.label,
      tool.found ? tool.source : "missing",
      tool.path ?? "-",
      tool.version,
    ].join("\t"));
  }
  return 0;
}
