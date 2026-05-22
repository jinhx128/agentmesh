import path from "node:path";

import {
  checkProjectSpec,
  projectSpecPath,
} from "@agentmesh/runtime/src/spec/index.js";
import { optionValue } from "../flags.js";

export function specCheck(args: string[]): number {
  const json = args.includes("--json");
  const filePath = optionValue(args, "--path");
  const report = checkProjectSpec(filePath ? path.resolve(filePath) : projectSpecPath());
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.ok) {
    console.log(`ok\t${report.path}`);
  } else {
    for (const diagnostic of report.diagnostics) {
      console.error(`${diagnostic.classification}: ${diagnostic.message}`);
    }
  }
  return report.ok ? 0 : 1;
}
