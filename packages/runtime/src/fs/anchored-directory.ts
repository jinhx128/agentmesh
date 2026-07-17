import { spawnSync } from "node:child_process";
import { closeSync, constants, fstatSync, openSync } from "node:fs";

export type AnchoredDirectoryCleanupFailure =
  | "unavailable"
  | "changed"
  | "timeout"
  | "cleanup_failed";

export interface AnchoredDirectoryCleanupOptions {
  targetPath: string;
  expectedDev: number;
  expectedIno: number;
  afterOpen?: () => void;
}

const ANCHORED_DELETE_TIMEOUT_MS = 15_000;
const ANCHORED_DELETE_CHILD = String.raw`
const fs = require("node:fs");
const anchor = fs.fstatSync(3);
const cwd = fs.statSync(".");
if (!anchor.isDirectory() || anchor.dev !== cwd.dev || anchor.ino !== cwd.ino) {
  process.exit(41);
}
try {
  for (const entry of fs.readdirSync(".")) {
    fs.rmSync(entry, { recursive: true, force: false, maxRetries: 0 });
  }
  const after = fs.statSync(".");
  if (anchor.dev !== after.dev || anchor.ino !== after.ino || fs.readdirSync(".").length !== 0) {
    process.exit(42);
  }
} catch {
  process.exit(43);
}
`;

export class AnchoredDirectoryCleanupError extends Error {
  readonly reason: AnchoredDirectoryCleanupFailure;

  constructor(reason: AnchoredDirectoryCleanupFailure) {
    super(`anchored directory cleanup failed: ${reason}`);
    this.name = "AnchoredDirectoryCleanupError";
    this.reason = reason;
  }
}

export function cleanAnchoredDirectory(options: AnchoredDirectoryCleanupOptions): void {
  const { targetPath, expectedDev, expectedIno, afterOpen } = options;
  if (process.platform !== "darwin" && process.platform !== "linux") {
    throw new AnchoredDirectoryCleanupError("unavailable");
  }

  let targetFd: number;
  try {
    targetFd = openSync(
      targetPath,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
  } catch {
    throw new AnchoredDirectoryCleanupError("unavailable");
  }

  try {
    const anchored = fstatSync(targetFd);
    if (
      !anchored.isDirectory() ||
      anchored.dev !== expectedDev ||
      anchored.ino !== expectedIno
    ) {
      throw new AnchoredDirectoryCleanupError("changed");
    }

    afterOpen?.();
    const result = spawnSync(process.execPath, ["-e", ANCHORED_DELETE_CHILD], {
      cwd: targetPath,
      env: {},
      stdio: ["ignore", "ignore", "ignore", targetFd],
      timeout: ANCHORED_DELETE_TIMEOUT_MS,
      killSignal: "SIGKILL",
      windowsHide: true,
    });
    if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" || result.signal) {
      throw new AnchoredDirectoryCleanupError("timeout");
    }
    if (result.error) {
      throw new AnchoredDirectoryCleanupError("cleanup_failed");
    }
    if (result.status === 41) {
      throw new AnchoredDirectoryCleanupError("changed");
    }
    if (result.status !== 0) {
      throw new AnchoredDirectoryCleanupError("cleanup_failed");
    }
  } catch (error) {
    if (isAnchoredDirectoryCleanupError(error)) {
      throw error;
    }
    throw new AnchoredDirectoryCleanupError("cleanup_failed");
  } finally {
    closeSync(targetFd);
  }
}

export function isAnchoredDirectoryCleanupError(
  error: unknown,
): error is AnchoredDirectoryCleanupError {
  return error instanceof AnchoredDirectoryCleanupError;
}
