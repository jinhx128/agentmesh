import {
  addCorrection,
  listCorrections,
  supersedeCorrection,
} from "@agentmesh/runtime/src/corrections/index.js";
import { optionValue } from "../flags.js";

export function correctionAdd(args: string[]): number {
  const json = args.includes("--json");
  const scope = optionValue(args, "--scope");
  const statement = optionValue(args, "--statement");
  if (!scope || !statement) {
    console.error(
      "usage: agentmesh correction add --scope <scope> --statement <text> [--id <id>] [--source <source>] [--owner <owner>] [--json]",
    );
    return 2;
  }
  const result = addCorrection({
    id: optionValue(args, "--id"),
    scope,
    statement,
    source: optionValue(args, "--source"),
    owner: optionValue(args, "--owner"),
  });
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  console.log(`Added correction: ${result.record.id}`);
  console.log(`Scope: ${result.record.scope}`);
  console.log(`Path: ${result.path}`);
  return 0;
}

export function correctionList(args: string[]): number {
  const json = args.includes("--json");
  const entries = listCorrections({
    status: optionValue(args, "--status"),
    scope: optionValue(args, "--scope"),
  });
  if (json) {
    console.log(
      JSON.stringify(
        {
          schema_version: 1,
          corrections: entries.map((entry) => ({
            ...entry.record,
            path: entry.path,
          })),
        },
        null,
        2,
      ),
    );
    return 0;
  }
  for (const entry of entries) {
    console.log(
      [
        entry.record.id,
        entry.record.status,
        entry.record.scope,
        entry.record.owner,
        entry.record.statement,
      ].join("\t"),
    );
  }
  return 0;
}

export function correctionSupersede(args: string[]): number {
  const json = args.includes("--json");
  const targetId = args[0];
  const statement = optionValue(args, "--statement");
  if (!targetId || !statement) {
    console.error(
      "usage: agentmesh correction supersede <correction-id> --statement <text> [--scope <scope>] [--id <replacement-id>] [--source <source>] [--owner <owner>] [--json]",
    );
    return 2;
  }
  const result = supersedeCorrection(targetId, {
    id: optionValue(args, "--id"),
    scope: optionValue(args, "--scope"),
    statement,
    source: optionValue(args, "--source"),
    owner: optionValue(args, "--owner"),
  });
  if (json) {
    console.log(
      JSON.stringify(
        {
          schema_version: 1,
          superseded: {
            ...result.superseded.record,
            path: result.superseded.path,
          },
          replacement: {
            ...result.replacement.record,
            path: result.replacement.path,
          },
        },
        null,
        2,
      ),
    );
    return 0;
  }
  console.log(`Superseded correction: ${result.superseded.record.id}`);
  console.log(`Replacement correction: ${result.replacement.record.id}`);
  console.log(`Path: ${result.replacement.path}`);
  return 0;
}
