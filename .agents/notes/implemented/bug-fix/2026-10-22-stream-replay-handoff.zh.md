# Agent Note: 流重放与实时投递的交接

Status: implemented

[English](2026-10-22-stream-replay-handoff.md) | 中文

## 问题

`TopicStreamSubscription` 在请求 `ai.stream.attach` 前安装 IPC 监听器。窗口可能已经通过打开流时注册的监听器收到实时增量，而 attach 返回的紧凑重放又包含相同增量。两路数据都送入 `readUIMessageStream` 会产生重复文本块；持久化仍可能只有一份正确内容，因此刷新会掩盖问题。

重放压缩和实时合并产生的块边界不同，比较文本或块数无法可靠识别重叠。如果 Main 不在 attach 时刷新待发送增量，合并后的增量还可能跨越重放边界。

## 决策

`AiStreamManager` 在每个执行 attempt 内为源数据块编号。合并后的载荷携带最后覆盖的 `sequence`，attach 在重放之外返回 `replayThrough[attemptId]`。替换 `WebContentsListener` 前先刷新旧监听器，既保留同一窗口其他消费者的输出，又保证每个实时载荷只位于截止位置的一侧。

Renderer 在 attach 等待期间按顺序暂存实时块和终止事件。Attach 还返回 `replayFrom[attemptId]`，在环形缓冲裁剪或拆分后仍保留合并载荷的首个来源序号。如果暂存的实时投递覆盖整个保留的重放区间，Renderer 只消费一次这份实时序列；否则先应用重放，再消费截止位置之后的实时块。仅收到部分实时数据不足以跳过重放。延迟到达且已经覆盖的 IPC 投递会被丢弃。

终态 attach 响应和失败的 attach 请求都先排空暂存输出，再结束分支。暂存的原生终态优先于 attach 的兜底结果，确保完成只报告一次。在任何读取器 attach 之前就已完成的轮次，直接通过暂存事件收尾；释放订阅时清空队列。

这些元数据属于 Cherry 的临时流传输层，不改变 harness 接口、原生会话或消息持久化。当前契约见 [Stream Manager](../../../../docs/references/ai/stream-manager.md) 和 [Execution Overlay](../../../../docs/references/ai/execution-overlay.md)。

## 考虑过的替代方案

- 按文本去重会丢掉合法的重复输出。
- 收到任何实时数据后就忽略全部重放，会在中途订阅时丢掉前缀。
- 按原始块数去重无法处理重放压缩与实时合并采用不同源块分组的情况。

## 影响

覆盖层的初次消费等待 attach 返回。暂存事件临时占用 Renderer 内存，后续流式传输仍保留原来的合并行为。序号在每个 attempt 内重新开始，截止位置按 `attemptId` 索引，因此并行执行和后续轮次保持独立。现有有界重放缓冲区溢出时仍可能丢失较早历史；本次修复不会把重放变成持久化日志。

## 验证

- Regression — `TopicStreamSubscription.test.ts`：注册前、attach 期间及重放之后的实时与重放重叠；中途订阅；内容相同的新增量；attach 期间的终止事件。
- Regression — `AiStreamManager.test.ts`：重复 attach 时的重放截止位置及待发送增量刷新，保留现有消费者的输出。
- Regression — `TopicStreamSubscription.test.ts`：终态 attach 响应与请求失败保留暂存正文；实时数据覆盖截断重放时，保留被裁剪的前缀且不重复尾部，使用真实 SDK reader 验证。
- Regression — `AiStreamManager.test.ts`：合并后重放覆盖从原始来源序号开始，拆分增量被裁剪后从保留下来的来源序号开始。
- Regression — 定向 Main 和 Renderer 测试还覆盖压缩、监听器合并、暂停、执行覆盖层、续轮及传输消费者。
- Regression — 本地 Electron 接入原生 Pi 和本地 HTTP/SSE 测试服务：两轮自然快速响应与一轮延迟 attach 回包均发生投递重叠，但实时文本块、渲染正文和持久化文本块各只有一份；刷新尚未完成的流不增加模型请求。
