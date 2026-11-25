# Agent Note: Agent 追踪内存限制与恢复回复归属

Status: implemented

[English](2026-11-14-agent-trace-memory-recovery.md) | 中文

## Problem

包含大量图片的模型历史会被序列化到 SDK 遥测，并同时保留为原始 JSON 和解析后的输入。追踪存储为计量大小再次序列化。长期活动的根 span 阻止已结束请求被回收，旧预算无法限制内存。Windows 事故 dump 已确认主进程在 JSON 序列化时发生 V8 OOM；无法恢复确切业务 JS 栈帧。

恢复用户负载后还发现有界 HTTP 捕获的隐藏保留：很小的 V8 字符串切片仍可能引用整份序列化请求。因此，开发者 HTTP 追踪、轮次文本属性和开发环境网络检查器会保留大型底层字符串，而计量只看到可见前缀。

恢复中的 Durable 活动输入可能先于产品投影 checkpoint 到达。Main 找不到所属回复后忽略活动事件，随后向已活动的连接发送新输入。

## Decision

通过 SDK 选项在序列化前关闭完整输入输出遥测。保留执行元数据、usage、有界 HTTP 捕获和轮次文本。适配器排除已由转换字段表示的原始载荷命名空间，并在解析前省略超过 512 Ki 字符的 JSON 输入。

HTTP 追踪、轮次文本和网络检查器通过 UTF-16 缓冲区复制有界预览后再保留，释放大型底层字符串，并在截断边界拆开代理对时仍保持原始代码单元。只复制诊断预览，提供商请求和模型历史继续保持完整。

收到请求响应头后，后台 HTTP 响应捕获只保留取消信号，不引用请求初始化对象及其完整正文。缓慢响应不应仅因为追踪而延长请求正文的生命周期。

递归估算保留 span 的大小，不序列化整份 span。现有数量与大小预算覆盖活动 trace：依次回收已结束 trace、已结束 span，必要时回收最旧的活动诊断 span。删除使查看器游标重置；终止导出可在预算允许时恢复已回收 span。舍弃的是诊断详情，不是执行状态。整份 span 和增删事件的占用使用相同估算方法，避免 JSON 转义干扰滚动保留计量。没有保留 span 的 trace 元数据单独按最近访问顺序保留 1,000 条；仍有保留 span 的 trace 元数据继续受到保护。

Durable 在恢复活动事件中携带已放置、未结束输入的绑定身份。Main 在同一 context 下解析唯一直接 assistant 回复，即使首次 checkpoint 尚未写入，也将输出接回原回复。歧义或其他 context 的绑定不能用于选择回复。已有后台来源信息继续作为后备。

在已放置输入尚未结束时附加观察，该逻辑用户输入唯一边界之后的已提交 assistant／工具输出仍作为原回复的活动内容恢复。更早回复、排队输入和有歧义的边界继续视为历史，不重发输入或重启原生任务。

## Alternatives considered

- 提高 V8 堆上限：延迟无限增长并增加资源消耗。
- 只在导出时截断或设置 OTel 属性上限：SDK 序列化及其临时分配已经发生。
- 保留所有活动 trace：长轮次可以无限增长。
- 清除连接忙碌标记或重发输入：造成原生工作重叠或重复副作用。
- 裁剪模型图片历史：改变模型可见上下文，需要单独确定产品规则。

## Consequences

SDK span 的内容详情减少；有界 HTTP 捕获仍是敏感的本地诊断。活动诊断详情可能被回收。完整会话历史和模型请求保持不变。恢复需要已有且唯一的输入绑定或投影归属；不凭空制造缺失的来源关系。

## Verification

- Regression — `projection.test.ts`：工具运行时重新附加，恢复未结束且已放置输入的已提交输出；已完成、排队或边界有歧义的输入不能将旧历史重放到回复。

- Regression — `buildTelemetry.test.ts`：真实 AI SDK 使用大型合成输入流式调用，保留提供商输入和 token usage，span 不含完整输入输出属性。
- Regression — `aiSdkSpanAdapter.test.ts` 与 `TraceSpanStore.test.ts`：载荷去重、超大输入省略、长期活动 trace 和超大活动 span 的限制，以及旧查看器游标重置。
- Regression — `httpTraceFetch.test.ts` 与 `MainNetworkDevtoolsService.test.ts`：保留二十份大型合成请求的小段预览（包括已经受限的切片），执行垃圾回收后验证保留堆内存低于 16 MiB。修复底层字符串保留前，两项均在约 80 MiB 处失败。`turnSpanAttributes.test.ts` 对提示词和回答预览验证相同的保留契约，预算为 32 MiB。截断处拆开的代理对保持不变。
- Regression — `httpTraceFetch.test.ts`：二十份仍打开的响应流不会继续保留已经发送的请求正文；移除请求初始化对象的闭包捕获之前，16 MiB 保留堆内存检查在约 82 MiB 处失败。
- Regression — `TraceStorageService.test.ts` 与 `TraceSpanStore.test.ts`：滚动裁剪转义事件时仍计入属性预算；已淘汰和仅有元数据的 trace 数量受限，同时保留近期归属。这三个用例在后续修复前失败。
- Regression — `PiDurableRuntimeConnection.test.ts` 与 `AgentSessionRuntimeService.handoff.test.ts`：已放置输入身份先于内容到达；无 checkpoint 恢复时写回原回复，释放忙碌状态，并允许同一会话继续输入。

本地定向检查不能证明 Windows 安装包已在用户原始负载下通过验收。用户诊断数据库和 dump 不作为可执行测试夹具。
