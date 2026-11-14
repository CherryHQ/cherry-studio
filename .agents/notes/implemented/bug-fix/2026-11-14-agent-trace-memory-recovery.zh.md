# Agent Note: Agent 追踪内存限制与恢复回复归属

Status: implemented

[English](2026-11-14-agent-trace-memory-recovery.md) | 中文

## Problem

包含大量图片的模型历史会被序列化到 SDK 遥测，并同时保留为原始 JSON 和解析后的输入。追踪存储为计量大小再次序列化。长期活动的根 span 阻止已结束请求被回收，旧预算无法限制内存。Windows 事故 dump 已确认主进程在 JSON 序列化时发生 V8 OOM；无法恢复确切业务 JS 栈帧。

恢复中的 Durable 活动输入可能先于产品投影 checkpoint 到达。Main 找不到所属回复后忽略活动事件，随后向已活动的连接发送新输入。

## Decision

通过 SDK 选项在序列化前关闭完整输入输出遥测。保留执行元数据、usage、有界 HTTP 捕获和轮次文本。适配器排除已由转换字段表示的原始载荷命名空间，并在解析前省略超过 512 Ki 字符的 JSON 输入。

递归估算保留 span 的大小，不序列化整份 span。现有数量与大小预算覆盖活动 trace：依次回收已结束 trace、已结束 span，必要时回收最旧的活动诊断 span。删除使查看器游标重置；终止导出可在预算允许时恢复已回收 span。舍弃的是诊断详情，不是执行状态。整份 span 和增删事件的占用使用相同估算方法，避免 JSON 转义干扰滚动保留计量。没有保留 span 的 trace 元数据单独按最近访问顺序保留 1,000 条；仍有保留 span 的 trace 元数据继续受到保护。

Durable 在恢复活动事件中携带已放置、未结束输入的绑定身份。Main 在同一 context 下解析唯一直接 assistant 回复，即使首次 checkpoint 尚未写入，也将输出接回原回复。歧义或其他 context 的绑定不能用于选择回复。已有后台来源信息继续作为后备。

## Alternatives considered

- 提高 V8 堆上限：延迟无限增长并增加资源消耗。
- 只在导出时截断或设置 OTel 属性上限：SDK 序列化及其临时分配已经发生。
- 保留所有活动 trace：长轮次可以无限增长。
- 清除连接忙碌标记或重发输入：造成原生工作重叠或重复副作用。
- 裁剪模型图片历史：改变模型可见上下文，需要单独确定产品规则。

## Consequences

SDK span 的内容详情减少；有界 HTTP 捕获仍是敏感的本地诊断。活动诊断详情可能被回收。完整会话历史和模型请求保持不变。恢复需要已有且唯一的输入绑定或投影归属；不凭空制造缺失的来源关系。

## Verification

- Regression — `buildTelemetry.test.ts`：真实 AI SDK 使用大型合成输入流式调用，保留提供商输入和 token usage，span 不含完整输入输出属性。
- Regression — `aiSdkSpanAdapter.test.ts` 与 `TraceSpanStore.test.ts`：载荷去重、超大输入省略、长期活动 trace 和超大活动 span 的限制，以及旧查看器游标重置。
- Regression — `TraceStorageService.test.ts` 与 `TraceSpanStore.test.ts`：滚动裁剪转义事件时仍计入属性预算；已淘汰和仅有元数据的 trace 数量受限，同时保留近期归属。这三个用例在后续修复前失败。
- Regression — `PiDurableRuntimeConnection.test.ts` 与 `AgentSessionRuntimeService.handoff.test.ts`：已放置输入身份先于内容到达；无 checkpoint 恢复时写回原回复，释放忙碌状态，并允许同一会话继续输入。

本地定向检查不能证明 Windows 安装包已在用户原始负载下通过验收。用户诊断数据库和 dump 不作为可执行测试夹具。
