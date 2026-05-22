import {
  SkillTarget,
  agentmeshSkillMarkdown,
  installSkill,
  verifySkillInstall,
} from "@agentmesh/skills";
import { optionValue } from "../flags.js";

export function skillVerify(args: string[]): number {
  const json = args.includes("--json");
  const targetIndex = args.indexOf("--target");
  const target = targetIndex === -1 ? undefined : args[targetIndex + 1];
  if (!target || !isSkillTarget(target)) {
    console.error("usage: agentmesh skill verify --target <host> [--json]");
    return 2;
  }
  const allowed = new Set(["--json", "--target", target]);
  const positional = args.filter((arg) => !allowed.has(arg));
  if (positional.length !== 0) {
    console.error("usage: agentmesh skill verify --target <host> [--json]");
    return 2;
  }
  const report = verifySkillInstall(target);
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const file of report.files) {
      if (file.status === "ok") {
        console.log(`Verified: ${file.path}`);
      } else {
        console.error(`${file.status}: ${file.path}`);
        if (file.hint) {
          console.error(`  hint: ${file.hint}`);
        }
      }
    }
  }
  return report.ok ? 0 : 1;
}

export function skillShow(args: string[]): number {
  if (args.length !== 0) {
    console.error("usage: agentmesh skill show");
    return 2;
  }
  process.stdout.write(agentmeshSkillMarkdown());
  return 0;
}

export function skillExport(args: string[]): number {
  if (args.length !== 0 && !(args.length === 2 && args[0] === "--format" && args[1] === "markdown")) {
    console.error("usage: agentmesh skill export [--format markdown]");
    return 2;
  }
  process.stdout.write(agentmeshSkillMarkdown());
  return 0;
}

export function skillInstall(args: string[]): number {
  const target = optionValue(args, "--target");
  if (!target || !isSkillTarget(target)) {
    console.error("usage: agentmesh skill install --target <host> [--force]");
    return 2;
  }
  const report = installSkill(target, { force: args.includes("--force") });
  for (const file of report.files.filter((item) => item.expected)) {
    console.log(`${file.status}: ${file.path}`);
  }
  return report.ok ? 0 : 1;
}

function isSkillTarget(value: string): value is SkillTarget {
  return ["codex", "claude", "cursor", "antigravity", "opencode", "copilot"].includes(value);
}
