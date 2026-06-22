export const WORKFLOW_STAGE_LABELS: Record<string, string> = {
  archive: "归档",
  decide: "决策",
  execute: "执行",
  gate: "门禁",
  plan: "计划",
  review: "审查",
  run: "运行",
  scope: "范围",
  verify: "验证",
};

export function workflowStageLabel(stage: string): string {
  return WORKFLOW_STAGE_LABELS[stage] ?? stage;
}

export function workflowStageListLabel(stages: string[], separator = " -> "): string {
  return stages.map(workflowStageLabel).join(separator);
}
