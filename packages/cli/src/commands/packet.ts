import { loadArtifacts, loadEvents, loadStatus, resolveRunDirectory } from "@agentmesh/runtime/src/packet/io.js";
import { validatePacket } from "@agentmesh/runtime/src/packet/validate.js";
import { workspaceCompatibilityDiagnostics } from "@agentmesh/runtime/src/packet/compatibility.js";

export function packetValidate(args: string[]): number {
  const json = args.includes("--json");
  const positional = args.filter((arg) => arg !== "--json");
  const run = positional[0];
  if (!run || positional.length !== 1) {
    console.error("usage: agentmesh packet validate <run> [--json]");
    return 2;
  }

  const result = validatePacket(run);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(`Packet OK: ${result.runDir}`);
    console.log(`Artifacts: ${result.artifactCount}`);
    console.log(`Events: ${result.eventCount}`);
  } else {
    console.error(`Packet invalid: ${result.runDir}`);
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
  }
  return result.ok ? 0 : 1;
}

export function packetCompatibility(args: string[]): number {
  const json = args.includes("--json");
  const positional = args.filter((arg) => arg !== "--json");
  if (positional.length !== 0) {
    console.error("usage: agentmesh packet compatibility [--json]");
    return 2;
  }
  const diagnostics = workspaceCompatibilityDiagnostics(process.cwd(), {
    entrypoint: "cli",
  });
  if (json) {
    console.log(JSON.stringify(diagnostics, null, 2));
  } else {
    console.log(`Decision: ${diagnostics.decision}`);
    console.log(`Metadata: ${diagnostics.metadata_state}`);
    console.log(`Runtime: ${diagnostics.current_runtime_version}`);
    console.log(`Entrypoint: ${diagnostics.current_entrypoint}`);
    for (const reason of diagnostics.reasons) {
      console.log(`Reason: ${reason}`);
    }
  }
  return 0;
}

export function packetStatus(args: string[]): number {
  const json = args.includes("--json");
  const positional = args.filter((arg) => arg !== "--json");
  const run = positional[0];
  if (!run || positional.length !== 1) {
    console.error("usage: agentmesh packet status <run> [--json]");
    return 2;
  }
  const runDir = resolveRunDirectory(run);
  const status = loadStatus(runDir);
  if (json) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    console.log(`Run: ${status.run_id}`);
    console.log(`Status: ${status.status}`);
    console.log(`Stages: ${status.stages.join(", ")}`);
    console.log(`Completed: ${status.completed_stages.join(", ") || "(none)"}`);
  }
  return 0;
}

export function packetEvents(args: string[]): number {
  const json = args.includes("--json");
  const positional = args.filter((arg) => arg !== "--json");
  const run = positional[0];
  if (!run || positional.length !== 1) {
    console.error("usage: agentmesh packet events <run> [--json]");
    return 2;
  }
  const runDir = resolveRunDirectory(run);
  const events = loadEvents(runDir);
  if (json) {
    console.log(JSON.stringify(events, null, 2));
  } else {
    for (const event of events) {
      console.log(`${event.timestamp}\t${event.event}`);
    }
  }
  return 0;
}

export function packetArtifacts(args: string[]): number {
  const json = args.includes("--json");
  const positional = args.filter((arg) => arg !== "--json");
  const run = positional[0];
  if (!run || positional.length !== 1) {
    console.error("usage: agentmesh packet artifacts <run> [--json]");
    return 2;
  }
  const runDir = resolveRunDirectory(run);
  const artifacts = loadArtifacts(runDir);
  if (json) {
    console.log(JSON.stringify(artifacts, null, 2));
  } else {
    for (const [name, artifact] of Object.entries(artifacts)) {
      console.log(
        [
          name,
          artifact.stage,
          artifact.kind,
          artifact.path,
          artifact.agent ?? "",
        ].join("\t"),
      );
    }
  }
  return 0;
}
