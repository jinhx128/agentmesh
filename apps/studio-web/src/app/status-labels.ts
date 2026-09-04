import type {
  StudioCallResultStatus,
  StudioCallStatus,
} from "../api/calls.js";
import type { StudioRunStatus } from "../api/runs.js";
import type { StudioSkillTargetReport } from "../api/integrations.js";

const UNKNOWN_STATUS = "未知状态";

export function callStatusLabel(status: StudioCallStatus): string {
  return {
    aborted: "已中止",
    failed: "失败",
    running: "运行中",
    stale: "已失联",
    success: "成功",
    timeout: "已超时",
  }[status];
}

export function callResultStatusLabel(status: StudioCallResultStatus): string {
  return {
    accepted: "已采纳",
    rejected: "未采用",
    superseded: "已被替换",
    unprocessed: "未处理",
  }[status];
}

export function runStatusLabel(status: string | null | undefined): string {
  if (!status) {
    return UNKNOWN_STATUS;
  }
  const labels: Record<StudioRunStatus, string> = {
    aborted: "已中止",
    completed: "成功",
    failed: "失败",
    awaiting_current: "等待决策",
    pending: "等待中",
    running: "运行中",
    timed_out: "已超时",
  };
  return labels[status as StudioRunStatus] ?? UNKNOWN_STATUS;
}

export function reviewerSessionModeLabel(mode: string): string {
  return {
    auto: "自动模式",
    fallback_fresh: "回退新会话",
    fresh: "新会话",
    fresh_isolated: "隔离新会话",
    independent: "独立会话",
    interactive_continuous: "连续会话",
    resume: "恢复会话",
    resumed: "已恢复会话",
  }[mode] ?? UNKNOWN_STATUS;
}

export function releaseVerdictLabel(verdict: string | null | undefined): string {
  if (!verdict) {
    return "暂无结论";
  }
  return {
    invalid: "无效结论",
    needs_decision: "需要决策",
    not_ready: "暂不可发布",
    ready: "可发布",
  }[verdict] ?? "无效结论";
}

export function skillTargetStatusLabel(status: StudioSkillTargetReport["status"]): string {
  return {
    content_mismatch: "内容不一致",
    failed: "失败",
    legacy_only: "仅有旧版配置",
    missing: "未安装",
    ok: "正常",
    unreadable: "无法读取",
  }[status];
}

export function callErrorKindLabel(kind: string): string {
  return {
    adapter_error: "Agent 调用失败",
    internal: "内部错误",
    network: "网络错误",
    none: "无错误",
    process_failed: "进程执行失败",
    provider_auth: "Provider 登录失败",
    provider_missing: "Provider 不可用",
    schema: "数据格式错误",
    spawn_failed: "启动失败",
    timeout: "调用超时",
    unknown: "未知错误",
    user_aborted: "用户已中止",
  }[kind] ?? "未知错误";
}

export function viewStateLabel(status: string): string {
  return {
    empty: "暂无内容",
    error: "错误",
    failed: "失败",
    idle: "尚未开始",
    loading: "加载中",
    ready: "已就绪",
    running: "运行中",
    saving: "保存中",
    submitting: "提交中",
    success: "成功",
  }[status] ?? UNKNOWN_STATUS;
}
