import { currentRuntimeVersion } from "@agentmesh/runtime/src/packet/compatibility.js";

const USAGE = "usage: agentmesh version [--json]";

export function versionCommand(args: string[]): number {
  const json = args.includes("--json");
  const positional = args.filter((arg) => arg !== "--json");
  if (positional.length !== 0) {
    console.error(USAGE);
    return 2;
  }
  const currentVersion = currentRuntimeVersion();
  if (json) {
    console.log(JSON.stringify({
      schema_version: 1,
      current_version: currentVersion,
      update_check_hint: "agentmesh update check --json",
    }, null, 2));
    return 0;
  }
  console.log(currentVersion);
  return 0;
}
