export interface DesktopPreferences {
  auto_check_updates: boolean;
  auto_check_cli: boolean;
}

export function isDesktopPreferencesAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function loadDesktopPreferences(): Promise<DesktopPreferences> {
  requireDesktopPreferences();
  const { invoke } = await import("@tauri-apps/api/core");
  return validateDesktopPreferences(await invoke<unknown>("get_desktop_preferences"));
}

export async function saveDesktopAutoUpdatePreference(
  enabled: boolean,
): Promise<DesktopPreferences> {
  return saveDesktopPreferences({ autoCheckUpdates: enabled });
}

export async function saveCliAutoCheckPreference(
  enabled: boolean,
): Promise<DesktopPreferences> {
  return saveDesktopPreferences({ autoCheckCli: enabled });
}

/** Only the provided toggles are written; the rest keep their stored values. */
async function saveDesktopPreferences(
  patch: { autoCheckUpdates?: boolean; autoCheckCli?: boolean },
): Promise<DesktopPreferences> {
  requireDesktopPreferences();
  const { invoke } = await import("@tauri-apps/api/core");
  return validateDesktopPreferences(await invoke<unknown>("set_desktop_preferences", patch));
}

export function normalizeDesktopPreferenceError(error: unknown): string {
  const message = error instanceof Error
    ? error.message.trim()
    : typeof error === "string"
      ? error.trim()
      : "";
  return message || "桌面端更新偏好保存失败";
}

function requireDesktopPreferences(): void {
  if (!isDesktopPreferencesAvailable()) {
    throw new Error("Desktop preferences are only available from AgentMesh.app.");
  }
}

function validateDesktopPreferences(value: unknown): DesktopPreferences {
  if (
    typeof value !== "object"
    || value === null
    || typeof (value as { auto_check_updates?: unknown }).auto_check_updates !== "boolean"
    || typeof (value as { auto_check_cli?: unknown }).auto_check_cli !== "boolean"
  ) {
    throw new Error("Desktop preferences response is invalid.");
  }
  return value as DesktopPreferences;
}
