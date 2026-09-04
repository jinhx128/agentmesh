# Call Record v3 设计

## 背景

Run 已统一使用 `run_status` 和 `completed / timed_out`，但直接调用仍使用 `status = running / success / failed / aborted / timeout / stale`。`stale` 是读取时推导的健康信息，却被混入生命周期；Runtime、SDK、App Server 和 Studio 也因此存在不同的状态契约。

## 目标

- 将直接调用生命周期统一为 `running / completed / failed / timed_out / aborted`。
- 将失联健康度从生命周期中拆出为读取投影。
- 保留 `result_status`，准确表达调用方是否使用调用结果。
- 严格约束状态、时间、退出码、错误类型和结果处置之间的不变量。
- 以 schema v3 破坏性升级，不迁移、不静默兼容旧 v2 数据。

## 最终模型

```ts
type CallStatus = "running" | "completed" | "failed" | "timed_out" | "aborted";
type CallHealthStatus = "active" | "stale" | null;
type CallResultStatus = "unprocessed" | "accepted" | "rejected" | "superseded";
```

`call_status` 持久化；`health_status` 由读取层根据 `call_status` 和 `heartbeat_at` 推导。终态的 `health_status` 为 `null`。心跳每 60 秒刷新，连续 5 分钟未刷新才判定 `stale`。

状态不变量：

- `running`：`completed_at`、`duration_ms` 必须为 `null`，`error_kind` 必须为 `none`。
- `completed`：必须有结束时间和耗时，`error_kind` 为 `none`；`exit_code` 为 0 表示成功，非 0 归为 `failed`。
- `failed`：必须有结束时间和错误摘要；错误类型为非 `none`、非 `timeout`，退出码可为空或有值。
- `timed_out`：必须有结束时间和错误摘要，`error_kind = timeout`，退出码允许为空或有值。
- `aborted`：必须有结束时间和错误摘要，`error_kind = user_aborted`，退出码允许为空或有值。
- 时间满足 `created_at <= started_at <= completed_at`；启动失败允许 `started_at` 为空。
- `result_status` 非 `unprocessed` 时，调用必须是终态且存在输出产物；`superseded` 只能由同一比较组的 `select` 产生。

## 兼容与诊断

Runtime/SDK 对 v2 记录拒绝业务读取和写入；Studio 列表层逐条捕获解析错误，生成 `unsupported_schema` 诊断并跳过该记录，不能因单条旧记录导致列表整体失败。新建和更新只写 v3。升级清理旧本地 Call Record，不提供迁移器。

## 实施范围

同步 Runtime、CLI、SDK、App Server、Studio、测试、文档和 skill。Call 不引入 Run 的阶段字段；结果处置仍由实际消费调用结果的入口负责，Studio 只读展示。

## 验收标准

- 所有 Call 生命周期消费者使用同一组 v3 状态。
- 长调用按心跳正常保持 active，失联才显示 stale。
- 运行中调用不能被标记结果；有产物的失败/超时终态可以被调用方明确采纳或拒绝。
- v2 记录不会被静默当作 v3 使用，也不会阻断 Studio 其他记录展示。
- Runtime、CLI JSON、SDK、Server 和 Studio 对同一记录给出一致状态。
