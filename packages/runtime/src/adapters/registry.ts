import { STAGE_TYPES, type AdapterCapabilityMetadata } from "@agentmesh/core";

export interface RuntimeAdapterMetadata {
  id: string;
  aliases: string[];
  description: string;
  command: string;
  args: string[];
  label: string;
  capabilities: AdapterCapabilityMetadata;
}

const DEFAULT_STAGES = [...STAGE_TYPES];
const DEFAULT_ROLES = ["planner", "worker", "verifier", "reviewer", "decider"];

const RUNTIME_ADAPTERS: RuntimeAdapterMetadata[] = [
  {
    id: "command",
    aliases: [],
    description: "Invoke a configured executable command.",
    command: "",
    args: [],
    label: "Command Agent",
    capabilities: {
      roles: [...DEFAULT_ROLES],
      stages: [...DEFAULT_STAGES],
    },
  },
  {
    id: "codex-cli",
    aliases: ["codex"],
    description: "Codex CLI.",
    command: "codex",
    args: ["exec"],
    label: "Codex CLI",
    capabilities: aiCliCapabilities(false),
  },
  {
    id: "claude-code-cli",
    aliases: ["claude"],
    description: "Claude Code CLI.",
    command: "claude",
    args: ["-p"],
    label: "Claude Code CLI",
    capabilities: aiCliCapabilities(true),
  },
  {
    id: "cursor-agent",
    aliases: ["cursor"],
    description: "Cursor Agent.",
    command: "cursor-agent",
    args: ["--print", "--trust"],
    label: "Cursor Agent",
    capabilities: aiCliCapabilities(false),
  },
  {
    id: "antigravity-cli",
    aliases: ["antigravity"],
    description: "Antigravity CLI.",
    command: "agy",
    args: [],
    label: "Antigravity CLI",
    capabilities: aiCliCapabilities(false),
  },
  {
    id: "opencode-cli",
    aliases: ["opencode"],
    description: "OpenCode CLI.",
    command: "opencode",
    args: ["run"],
    label: "OpenCode CLI",
    capabilities: aiCliCapabilities(true),
  },
];

export function listRuntimeAdapters(): RuntimeAdapterMetadata[] {
  return [...RUNTIME_ADAPTERS].sort((left, right) => left.id.localeCompare(right.id));
}

export function lookupRuntimeAdapter(idOrAlias: string): RuntimeAdapterMetadata {
  const id = normalizeRuntimeAdapterId(idOrAlias);
  const adapter = RUNTIME_ADAPTERS.find((candidate) => candidate.id === id);
  if (!adapter) {
    throw new Error(`unknown adapter: ${idOrAlias}`);
  }
  return cloneAdapter(adapter);
}

export function normalizeRuntimeAdapterId(idOrAlias: string): string {
  return (
    RUNTIME_ADAPTERS.find((adapter) => adapter.aliases.includes(idOrAlias))?.id ??
    idOrAlias
  );
}

export function isAiCliRuntimeAdapter(idOrAlias: string): boolean {
  const id = normalizeRuntimeAdapterId(idOrAlias);
  return id !== "command" && RUNTIME_ADAPTERS.some((adapter) => adapter.id === id);
}

export function runtimeAdapterSupportsStructuredSessions(idOrAlias: string): boolean {
  const adapter = lookupRuntimeAdapter(idOrAlias);
  return (
    adapter.capabilities.supports_resume === true &&
    adapter.capabilities.supports_structured_session_id === true
  );
}

function aiCliCapabilities(supportsStructuredSessions: boolean): AdapterCapabilityMetadata {
  return {
    roles: [...DEFAULT_ROLES],
    stages: [...DEFAULT_STAGES],
    supports_non_interactive: true,
    supports_resume: supportsStructuredSessions,
    supports_structured_session_id: supportsStructuredSessions,
  };
}

function cloneAdapter(adapter: RuntimeAdapterMetadata): RuntimeAdapterMetadata {
  return {
    ...adapter,
    aliases: [...adapter.aliases],
    args: [...adapter.args],
    capabilities: {
      roles: [...adapter.capabilities.roles],
      stages: [...adapter.capabilities.stages],
      ...(adapter.capabilities.supports_non_interactive === undefined
        ? {}
        : { supports_non_interactive: adapter.capabilities.supports_non_interactive }),
      ...(adapter.capabilities.supports_resume === undefined
        ? {}
        : { supports_resume: adapter.capabilities.supports_resume }),
      ...(adapter.capabilities.supports_structured_session_id === undefined
        ? {}
        : { supports_structured_session_id: adapter.capabilities.supports_structured_session_id }),
    },
  };
}
