import { recordWorkspaceActivity } from "@agentmesh/runtime/src/workspaces/registry.js";

export function recordCliWorkspaceActivity(workspace: string): void {
  try {
    recordWorkspaceActivity(workspace, { preserveDisabled: true });
  } catch {
    // Registry visibility is best-effort; the packet or call record remains the source of truth.
  }
}
