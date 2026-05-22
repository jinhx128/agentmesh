import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const distRoot = path.join(root, "dist-node");
const packageTargets = new Map([
  ["@agentmesh/core", "packages/core/src/index.js"],
  ["@agentmesh/skills", "packages/skills/src/index.js"],
  ["@agentmesh/sdk", "packages/sdk/src/index.js"],
  ["@agentmesh/app-server", "packages/app-server/src/server.js"],
]);
const subpathPrefixes = new Map([
  ["@agentmesh/core/src/", "packages/core/src/"],
  ["@agentmesh/runtime/src/", "packages/runtime/src/"],
  ["@agentmesh/skills/src/", "packages/skills/src/"],
  ["@agentmesh/sdk/src/", "packages/sdk/src/"],
  ["@agentmesh/app-server/src/", "packages/app-server/src/"],
  ["@agentmesh/studio/src/", "apps/studio/src/"],
]);

for (const filePath of walk(distRoot).filter((item) => item.endsWith(".js"))) {
  const original = readFileSync(filePath, "utf-8");
  const updated = original.replace(
    /((?:from|import)\s*\(?\s*["'])(@agentmesh\/[^"']+)(["'])/g,
    (match, prefix, specifier, suffix) => {
      const target = resolveTarget(specifier);
      return target ? `${prefix}${relativeSpecifier(filePath, target)}${suffix}` : match;
    },
  );
  if (updated !== original) {
    writeFileSync(filePath, updated, "utf-8");
  }
}

function resolveTarget(specifier) {
  const direct = packageTargets.get(specifier);
  if (direct) {
    return path.join(distRoot, direct);
  }
  for (const [prefix, targetPrefix] of subpathPrefixes.entries()) {
    if (specifier.startsWith(prefix)) {
      return path.join(distRoot, targetPrefix, specifier.slice(prefix.length));
    }
  }
  return undefined;
}

function relativeSpecifier(fromFile, toFile) {
  let relative = path.relative(path.dirname(fromFile), toFile).split(path.sep).join("/");
  if (!relative.startsWith(".")) {
    relative = `./${relative}`;
  }
  return relative;
}

function walk(entryPath) {
  let stats;
  try {
    stats = statSync(entryPath);
  } catch {
    return [];
  }
  if (stats.isFile()) {
    return [entryPath];
  }
  if (!stats.isDirectory()) {
    return [];
  }
  return readdirSync(entryPath).flatMap((entry) => walk(path.join(entryPath, entry)));
}
