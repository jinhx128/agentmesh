import { spawnSync } from "node:child_process";

export interface AgentProcessEnvOptions {
  baseEnv?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  macProxyOutput?: string;
  macProxyCommand?: string;
  macProxyArgs?: string[];
  macProxyTimeoutMs?: number;
}

let cachedMacProxyEnv: Record<string, string> | undefined;

const MAC_PROXY_SETTING = /^\s*([A-Za-z]+)\s*:\s*(.+?)\s*$/;
const MAC_PROXY_SETTING_KEYS = new Set([
  "HTTPEnable",
  "HTTPProxy",
  "HTTPPort",
  "HTTPSEnable",
  "HTTPSProxy",
  "HTTPSPort",
  "SOCKSEnable",
  "SOCKSProxy",
  "SOCKSPort",
]);

export function buildAgentProcessEnv(
  overrides: Record<string, string> | undefined,
  options: AgentProcessEnvOptions = {},
): NodeJS.ProcessEnv {
  const env = cloneDefinedEnv(options.baseEnv ?? process.env);
  applyMacSystemProxyEnv(env, options);
  if (overrides) {
    Object.assign(env, overrides);
  }
  mirrorProxyAliases(env);
  return env;
}

function cloneDefinedEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

function applyMacSystemProxyEnv(
  env: NodeJS.ProcessEnv,
  options: AgentProcessEnvOptions,
): void {
  if ((options.platform ?? process.platform) !== "darwin") {
    return;
  }
  const proxyEnv = macSystemProxyEnv(options);
  applyProxyPair(env, proxyEnv, "HTTP_PROXY", "http_proxy");
  applyProxyPair(env, proxyEnv, "HTTPS_PROXY", "https_proxy");
  applyProxyPair(env, proxyEnv, "ALL_PROXY", "all_proxy");
  applyProxyPair(env, proxyEnv, "NO_PROXY", "no_proxy");
}

function macSystemProxyEnv(options: AgentProcessEnvOptions): Record<string, string> {
  if (options.macProxyOutput !== undefined) {
    return parseMacSystemProxy(options.macProxyOutput);
  }
  if (cachedMacProxyEnv !== undefined) {
    return cachedMacProxyEnv;
  }
  const result = spawnSync(
    options.macProxyCommand ?? "scutil",
    options.macProxyArgs ?? ["--proxy"],
    {
      encoding: "utf-8",
      timeout: options.macProxyTimeoutMs ?? 1000,
    },
  );
  cachedMacProxyEnv =
    result.status === 0 && result.stdout ? parseMacSystemProxy(result.stdout) : {};
  return cachedMacProxyEnv;
}

export function resetAgentProcessEnvCache(): void {
  cachedMacProxyEnv = undefined;
}

function parseMacSystemProxy(output: string): Record<string, string> {
  const settings = Object.fromEntries(
    output
      .split(/\r?\n/)
      .map((line) => line.match(MAC_PROXY_SETTING))
      .filter((match): match is RegExpMatchArray => match !== null)
      .filter((match) => MAC_PROXY_SETTING_KEYS.has(match[1]))
      .map((match) => [match[1], match[2]]),
  );
  const env: Record<string, string> = {};
  const httpProxy = proxyUrl(settings.HTTPEnable, settings.HTTPProxy, settings.HTTPPort, "http");
  const httpsProxy = proxyUrl(
    settings.HTTPSEnable,
    settings.HTTPSProxy,
    settings.HTTPSPort,
    "http",
  );
  const socksProxy = proxyUrl(
    settings.SOCKSEnable,
    settings.SOCKSProxy,
    settings.SOCKSPort,
    "socks5",
  );
  if (httpProxy) {
    env.HTTP_PROXY = httpProxy;
    env.http_proxy = httpProxy;
  }
  if (httpsProxy) {
    env.HTTPS_PROXY = httpsProxy;
    env.https_proxy = httpsProxy;
  }
  if (socksProxy) {
    env.ALL_PROXY = socksProxy;
    env.all_proxy = socksProxy;
  }
  const exceptions = parseMacProxyExceptions(output);
  if (exceptions.length) {
    env.NO_PROXY = exceptions.join(",");
    env.no_proxy = env.NO_PROXY;
  }
  return env;
}

function proxyUrl(
  enabled: string | undefined,
  host: string | undefined,
  port: string | undefined,
  scheme: "http" | "socks5",
): string | undefined {
  if (enabled !== "1" || !host || !port) {
    return undefined;
  }
  return `${scheme}://${host}:${port}`;
}

function parseMacProxyExceptions(output: string): string[] {
  const entries: string[] = [];
  let inExceptions = false;
  for (const line of output.split(/\r?\n/)) {
    if (/^\s*ExceptionsList\s*:\s*<array>\s*\{\s*$/.test(line)) {
      inExceptions = true;
      continue;
    }
    if (inExceptions && /^\s*}\s*$/.test(line)) {
      break;
    }
    const match = line.match(/^\s*\d+\s*:\s*(.+?)\s*$/);
    if (inExceptions && match) {
      const normalized = normalizeProxyException(match[1]);
      if (normalized !== undefined && !entries.includes(normalized)) {
        entries.push(normalized);
      }
    }
  }
  return entries;
}

/**
 * Rewrite one macOS exception entry into the spelling NO_PROXY parsers agree on.
 *
 * macOS writes host patterns as `*.example.com` and adds the `<local>` token, neither of
 * which every agent CLI understands: the bare `example.com` form is the only one accepted
 * across the Rust, Bun and Node HTTP clients the adapters run on, and it already covers
 * subdomains in all of them. Returns undefined for entries that carry no NO_PROXY meaning.
 */
function normalizeProxyException(entry: string): string | undefined {
  const trimmed = entry.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  // Tokens such as `<local>` describe a macOS-only rule with no NO_PROXY equivalent.
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return undefined;
  }
  // A lone `*` already means "bypass everything" to NO_PROXY parsers.
  if (trimmed === "*") {
    return trimmed;
  }
  const host = trimmed.replace(/^\*?\./, "");
  return host.length > 0 ? host : undefined;
}

function mirrorProxyAliases(env: NodeJS.ProcessEnv): void {
  syncEnvPair(env, "HTTP_PROXY", "http_proxy");
  syncEnvPair(env, "HTTPS_PROXY", "https_proxy");
  syncEnvPair(env, "ALL_PROXY", "all_proxy");
  syncEnvPair(env, "NO_PROXY", "no_proxy");
}

function applyProxyPair(
  env: NodeJS.ProcessEnv,
  proxyEnv: Record<string, string>,
  upper: string,
  lower: string,
): void {
  const value = env[upper] ?? env[lower] ?? proxyEnv[upper] ?? proxyEnv[lower];
  if (value === undefined) {
    return;
  }
  env[upper] ??= value;
  env[lower] ??= value;
}

function syncEnvPair(env: NodeJS.ProcessEnv, upper: string, lower: string): void {
  const value = env[upper] ?? env[lower];
  if (value === undefined) {
    return;
  }
  env[upper] = value;
  env[lower] = value;
}
