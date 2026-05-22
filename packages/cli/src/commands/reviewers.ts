import { buildReviewerRegistry } from "@agentmesh/runtime/src/review/registry.js";

export function reviewersList(args: string[], configPath?: string): number {
  const json = args.includes("--json");
  const positional = args.filter((arg) => arg !== "--json");
  if (positional.length !== 0) {
    console.error("usage: agentmesh reviewers list [--json]");
    return 2;
  }
  const registry = buildReviewerRegistry(configPath);
  if (json) {
    console.log(JSON.stringify(registry, null, 2));
    return 0;
  }
  for (const reviewer of registry.reviewers) {
    console.log(
      `${reviewer.id}\t${reviewer.label}\t${reviewer.adapter_target}\t${reviewer.availability.state}\t${reviewer.expected_output_format}`,
    );
  }
  return 0;
}
