import type { Update } from "@tauri-apps/plugin-updater";

export type DesktopAppUpdaterState =
  | { status: "unavailable" }
  | { status: "idle" }
  | { status: "checking" }
  | { status: "current" }
  | { status: "update_available"; currentVersion: string; version: string; notes?: string }
  | { status: "downloading"; downloadedBytes: number; totalBytes?: number }
  | { status: "restarting" }
  | { status: "error"; message: string };

let pendingUpdate: Update | undefined;

const MAX_DESKTOP_UPDATER_ERROR_LENGTH = 240;

export function normalizeDesktopUpdaterError(error: unknown): string {
  const message = error instanceof Error
    ? error.message.trim()
    : typeof error === "string"
      ? error.trim()
      : "";
  if (!message) {
    return "应用更新检查失败";
  }
  return message
    .replace(/https?:\/\/\S+/g, (value) => {
      const sensitiveIndex = value.search(/[?#]/);
      return sensitiveIndex === -1 ? value : `${value.slice(0, sensitiveIndex)}?<redacted>`;
    })
    .replace(/\/Users\/[^/\s]+/g, "~")
    .slice(0, MAX_DESKTOP_UPDATER_ERROR_LENGTH);
}

export function isDesktopUpdaterAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function checkDesktopAppUpdate(): Promise<DesktopAppUpdaterState> {
  if (!isDesktopUpdaterAvailable()) {
    return { status: "unavailable" };
  }
  pendingUpdate = undefined;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check({ timeout: 15_000 });
  if (!update) {
    return { status: "current" };
  }
  pendingUpdate = update;
  return {
    status: "update_available",
    currentVersion: update.currentVersion,
    version: update.version,
    ...(update.body ? { notes: update.body } : {}),
  };
}

export async function installDesktopAppUpdate(
  onProgress: (downloadedBytes: number, totalBytes?: number) => void,
): Promise<void> {
  if (!pendingUpdate) {
    throw new Error("Check for an app update before installing it.");
  }
  let downloadedBytes = 0;
  let totalBytes: number | undefined;
  await pendingUpdate.downloadAndInstall((event) => {
    if (event.event === "Started") {
      totalBytes = event.data.contentLength;
      onProgress(downloadedBytes, totalBytes);
    } else if (event.event === "Progress") {
      downloadedBytes += event.data.chunkLength;
      onProgress(downloadedBytes, totalBytes);
    } else {
      onProgress(totalBytes ?? downloadedBytes, totalBytes);
    }
  });
}

export async function relaunchDesktopApp(): Promise<void> {
  if (!isDesktopUpdaterAvailable()) {
    throw new Error("Desktop app updater is only available from AgentMesh.app.");
  }
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
