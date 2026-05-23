import { buildDoctorReport } from "@agentmesh/runtime/src/doctor/readiness.js";
import { loadConfigWithSources } from "@agentmesh/runtime/src/config.js";
import { listMcpResourceHints, mcpIngestionError } from "@agentmesh/runtime/src/mcp/client.js";
import { optionValues } from "../flags.js";

const USAGE = "usage: agentmesh doctor [--agent <agent-id>] [--skip-auth-probe] [--probe-timeout-secs <n>] [--json]";

export async function doctor(args: string[], configPath?: string): Promise<number> {
  const json = args.includes("--json");
  const skipAuthProbe = args.includes("--skip-auth-probe");
  const agents = optionValues(args, "--agent");
  const timeoutIndex = args.indexOf("--probe-timeout-secs");
  let probeTimeoutSecs: number | undefined;
  if (timeoutIndex !== -1) {
    const rawTimeout = args[timeoutIndex + 1];
    if (!rawTimeout) {
      console.error(USAGE);
      return 2;
    }
    probeTimeoutSecs = Number.parseInt(rawTimeout, 10);
    if (!/^[1-9]\d*$/.test(rawTimeout) || !Number.isSafeInteger(probeTimeoutSecs)) {
      console.error(USAGE);
      return 2;
    }
  }
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--agent" && (!args[index + 1] || args[index + 1].startsWith("--"))) {
      console.error(USAGE);
      return 2;
    }
  }
  const allowed = new Set([
    "--json",
    "--skip-auth-probe",
    "--probe-timeout-secs",
    "--agent",
  ]);
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--probe-timeout-secs" || arg === "--agent") {
      index += 1;
      continue;
    }
    if (!allowed.has(arg)) {
      positional.push(arg);
    }
  }
  if (positional.length !== 0) {
    console.error(USAGE);
    return 2;
  }
  let report: ReturnType<typeof buildDoctorReport>;
  try {
    report = buildDoctorReport(configPath, {
      probeAuth: !skipAuthProbe,
      probeTimeoutSecs,
      agents,
      providerToolDiscovery: {
        enabled: true,
        workspace: process.cwd(),
      },
    });
    const mcpDiagnostics = await doctorMcpDiagnostics(configPath);
    report = {
      ...report,
      diagnostics: [...report.diagnostics, ...mcpDiagnostics],
      ok: report.ok && mcpDiagnostics.length === 0,
    };
  } catch (error) {
    const diagnostic = doctorConfigDiagnostic(error);
    if (json) {
      console.log(JSON.stringify({
        schema_version: 1,
        config: configPath ?? "",
        config_layers: [],
        probe_auth: !skipAuthProbe,
        ok: false,
        diagnostics: [diagnostic],
        agents: [],
      }, null, 2));
    } else {
      console.error(diagnostic.message);
      console.error(`hint: ${diagnostic.hint}`);
    }
    return 1;
  }
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Config: ${report.config}`);
    for (const layer of report.config_layers) {
      console.log(`Config layer: ${layer.source}\t${layer.path}`);
    }
    for (const diagnostic of report.diagnostics) {
      console.log(`Diagnostic: ${diagnostic.classification}: ${diagnostic.message}`);
      console.log(`  hint: ${diagnostic.hint}`);
    }
    for (const agent of report.agents) {
      console.log(
        `${agent.id}: ${agent.status} (source=${agent.source_layer ?? "unknown"}, readiness=${agent.readiness}, classification=${agent.classification}, help=${agent.help_probe}, version=${agent.version_probe})`,
      );
      for (const hint of agent.hints) {
        console.log(`  hint: ${hint}`);
      }
    }
  }
  return report.ok ? 0 : 1;
}

async function doctorMcpDiagnostics(configPath?: string): Promise<Array<{
  classification: string;
  message: string;
  hint: string;
}>> {
  const loaded = loadConfigWithSources(configPath);
  const diagnostics: Array<{
    classification: string;
    message: string;
    hint: string;
  }> = [];
  for (const [serverId, server] of Object.entries(loaded.config.mcp_servers).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    try {
      await listMcpResourceHints({
        command: server.command as string,
        args: stringList(server.args),
      }, {
        resourceHintLimit: 1,
        initializeTimeoutMs: 2_000,
        listTimeoutMs: 2_000,
      });
    } catch (error) {
      diagnostics.push(
        doctorMcpDiagnostic(serverId, server.command as string, mcpIngestionError(error)),
      );
    }
  }
  return diagnostics;
}

function doctorMcpDiagnostic(serverId: string, command: string, listError: string): {
  classification: string;
  message: string;
  hint: string;
} {
  if (listError.startsWith("server_start_failed") && /\b(?:ENOENT|EACCES)\b/i.test(listError)) {
    return {
      classification: "mcp_command_missing",
      message: `MCP server ${serverId} command is not runnable: ${listError}`,
      hint: `Install the MCP server command or update mcp_servers.${serverId}.command: ${command}`,
    };
  }
  if (listError.startsWith("server_start_failed") || listError.startsWith("initialize_failed")) {
    return {
      classification: "mcp_server_start_failed",
      message: `MCP server ${serverId} could not start or initialize: ${listError}`,
      hint: `Run \`${command}\` directly and check that it starts an MCP stdio server.`,
    };
  }
  return {
    classification: "mcp_resource_list_failed",
    message: `MCP server ${serverId} resources/list failed: ${listError}`,
    hint: `Check the MCP server logs and verify \`${command}\` supports resources/list.`,
  };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function doctorConfigDiagnostic(error: unknown): {
  classification: string;
  message: string;
  hint: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  let classification = "config_layer_error";
  let hint = "Check the referenced AgentMesh config layer and run `agentmesh agents list --json`.";
  if (message.includes("invalid agentmesh TOML")) {
    classification = "malformed_config_layer";
    hint = "Fix the TOML syntax in the reported config layer.";
  } else if (message.includes("unknown agent")) {
    classification = "unknown_agent";
    hint = "Run `agentmesh agents list --json` and use an existing agent id.";
  } else if (message.includes("duplicate agents id")) {
    classification = "duplicate_agent_id";
    hint = "Rename one agent id or keep the agent in only one config layer.";
  } else if (message.includes("duplicate mcp_servers id")) {
    classification = "duplicate_mcp_server_id";
    hint = "Rename one MCP server id or keep the server in only one config layer.";
  } else if (message.includes("references unknown agent")) {
    classification = "missing_referenced_agent";
    hint = "Add the referenced agent to user config or update the workflow default assignment.";
  }
  return { classification, message, hint };
}
