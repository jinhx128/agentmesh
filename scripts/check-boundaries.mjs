import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

for (const filePath of sourceFiles(["packages", "apps"])) {
  const relativePath = path.relative(root, filePath).split(path.sep).join("/");
  const content = readFileSync(filePath, "utf-8");
  if (relativePath.startsWith("packages/core/src/")) {
    assertNoMatch(
      relativePath,
      content,
      /from ["']node:(fs|child_process|path|os|http|net|process)["']|from ["'](fs|child_process|path|os|http|net|process)["']/,
      "core must stay free of Node side-effect imports",
    );
  }
  if (relativePath.startsWith("apps/studio-web/src/")) {
    assertNoMatch(
      relativePath,
      content,
      /packages\/(runtime|sdk|cli|core)|from ["']node:|from ["'](fs|child_process|path|os)["']/,
      "Studio frontend must consume App Server HTTP APIs only",
    );
    assertStudioFrontendPackageImports(relativePath, content);
  }
  if (relativePath.startsWith("packages/app-server/src/")) {
    assertNoMatch(
      relativePath,
      content,
      /node:child_process|from ["']child_process["']|\b(?:spawn|exec|execFile|fork)(?:Sync)?\b|process\.execPath|@agentmesh\/cli|packages\/cli/,
      "App Server files must call runtime APIs directly instead of spawning the CLI",
    );
  }
  if (relativePath.startsWith("packages/skills/src/")) {
    assertNoMatch(
      relativePath,
      content,
      /@agentmesh\/(runtime|cli)|packages\/(runtime|cli)/,
      "skills package must own templates and install contracts without importing runtime or CLI",
    );
  }
  assertNoMatch(
    relativePath,
    content,
    /\.\.\/\.\.\/.*(?:packages|runtime|studio)|\.\.\/\.\.\/\.\.\/.*(?:packages|runtime|studio)/,
    "cross-package imports must not use relative path traversal",
  );
  if (relativePath.startsWith("apps/") || relativePath.startsWith("packages/sdk/")) {
    assertNoMatch(
      relativePath,
      content,
      /from ["']@agentmesh\/runtime|import\(["']@agentmesh\/runtime/,
      "apps and SDK must not import the runtime package surface",
    );
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

function assertNoMatch(filePath, content, pattern, message) {
  const match = content.match(pattern);
  if (match) {
    failures.push(`${filePath}: ${message}: ${match[0]}`);
  }
}

function assertStudioFrontendPackageImports(filePath, content) {
  const importPattern =
    /(?:^|\n)\s*(import|export)\s+(type\s+)?[\s\S]*?\sfrom\s+["'](@agentmesh\/[^"']+)["']|import\s*\(\s*["'](@agentmesh\/[^"']+)["']\s*\)/g;
  for (const match of content.matchAll(importPattern)) {
    const specifier = match[3] ?? match[4];
    const typeOnly = Boolean(match[2]) && match[4] === undefined;
    if (typeOnly && (specifier === "@agentmesh/core" || specifier === "@agentmesh/sdk")) {
      continue;
    }
    failures.push(
      `${filePath}: Studio frontend may only use App Server APIs plus type-only @agentmesh/core|sdk contracts: ${specifier}`,
    );
  }
}

function sourceFiles(dirs) {
  return dirs.flatMap((dir) => walk(path.join(root, dir)))
    .filter((filePath) => /\.(ts|tsx)$/.test(filePath))
    .filter((filePath) => !filePath.includes(`${path.sep}src-tauri${path.sep}`));
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
