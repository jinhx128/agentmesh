import { buildReleaseEvidenceSummary, refreshReleaseEvidenceSummary } from "@agentmesh/runtime/src/release/check.js";
import { loadStatus, resolveRunDirectory } from "@agentmesh/runtime/src/packet/io.js";
import { withRunMutationLock } from "@agentmesh/runtime/src/packet/lock.js";

export function releaseCheckSummary(args: string[]): number {
  const json = args.includes("--json");
  const write = args.includes("--write");
  const positional = args.filter((arg) => arg !== "--json" && arg !== "--write");
  const run = positional[0];
  if (!run || positional.length !== 1) {
    console.error("usage: agentmesh release-check summary <run> [--write] [--json]");
    return 2;
  }
  const runDir = resolveRunDirectory(run);
  const status = loadStatus(runDir);
  const result = write
    ? withRunMutationLock(runDir, "release-check.summary", () =>
        refreshReleaseEvidenceSummary(runDir, status),
      )
    : {
        runDir,
        summaryPath: `${runDir}/release-summary.md`,
        summary: buildReleaseEvidenceSummary(runDir, status),
        written: false,
      };
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    process.stdout.write(result.summary);
  }
  return 0;
}
