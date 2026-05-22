import { parseStudioDesktopArgs } from "./options.js";
import {
  redactStudioUrlForLog,
  serializeStudioDesktopLaunchEvent,
  startStudioDesktopHost,
} from "./host.js";

interface StudioDesktopLaunchHandshake {
  schema_version: 1;
  studio_token: string;
}

const rawArgs = process.argv.slice(2);
const launchJson = rawArgs.includes("--launch-json");

try {
  const options = parseStudioDesktopArgs(rawArgs.filter((arg) => arg !== "--launch-json"));
  const launchToken = launchJson ? await readLaunchHandshakeToken() : undefined;
  const started = await startStudioDesktopHost({
    ...options,
    ...(launchToken ? { token: launchToken } : {}),
  });
  if (launchJson) {
    console.log(serializeStudioDesktopLaunchEvent(started));
  } else {
    console.log(`AgentMesh Desktop Studio: ${redactStudioUrlForLog(started.webviewUrl)}`);
    console.log(`Workspace: ${started.workspace}`);
    console.log(`Studio Assets: ${started.assetDir}`);
    console.log("Press Ctrl+C to stop.");
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (launchJson) {
    console.error(JSON.stringify({
      schema_version: 1,
      event: "agentmesh_studio_error",
      message,
    }));
  } else {
    console.error(message);
  }
  process.exitCode = 1;
}

function readLaunchHandshakeToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    let content = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("timed out waiting for Studio launch handshake"));
    }, 5000);
    const cleanup = () => {
      clearTimeout(timeout);
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.off("error", onError);
    };
    const onData = (chunk: Buffer | string) => {
      content += chunk.toString();
      if (content.length > 4096) {
        cleanup();
        reject(new Error("Studio launch handshake is too large"));
        return;
      }
      if (content.includes("\n")) {
        finish(content.slice(0, content.indexOf("\n")));
      }
    };
    const onEnd = () => finish(content);
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const finish = (line: string) => {
      cleanup();
      try {
        const parsed = JSON.parse(line) as Partial<StudioDesktopLaunchHandshake>;
        if (parsed.schema_version !== 1 || typeof parsed.studio_token !== "string" || parsed.studio_token.trim() === "") {
          reject(new Error("invalid Studio launch handshake"));
          return;
        }
        resolve(parsed.studio_token);
      } catch {
        reject(new Error("invalid Studio launch handshake JSON"));
      }
    };
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", onData);
    process.stdin.once("end", onEnd);
    process.stdin.once("error", onError);
    process.stdin.resume();
  });
}
