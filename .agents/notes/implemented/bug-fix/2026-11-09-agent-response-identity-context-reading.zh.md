# Agent Note: 响应身份与上下文读数时效

Status: implemented

[English](2026-11-09-agent-response-identity-context-reading.md) | 中文

## 问题

Gemini 响应没有携带网关的响应身份。原生客户端因此无法把已经完成的供应商用量记录关联到产品消息，尽管用量本身仍然保留。

未知响应模型使上下文读数失效后，Claude 的流式 delta 会退回配置模型，可能按错误的容量确认输入用量。上下文读取失败时只向调用方返回 unknown，没有更新观察者，使已有和稍后订阅的消费者继续拿到旧 confirmed。

## 决策

Gemini 的最终 SSE 帧与完整 JSON 响应使用标准 [responseId](https://ai.google.dev/api/generate-content#GenerateContentResponse) 字段，输出 adapter 已有的计费身份。Main 继续依据明确的原生身份关联用量，不推断当前回复。

Claude delta 使用已经保存的活动流模型。上下文读取通过同一路径发布有效的 confirmed 和 unknown 结果。模型／上下文代次屏障隔离重置、模型变化和关闭期间的读取；独立的读取代次还防止同一上下文代次内，较早读取的迟到成功或失败覆盖较新的读取。它只用于比较时效，不构成另一套 pending 队列。这延续了现有的[被动上下文契约](../../proposed/architecture/2026-10-30-agent-context-usage.md)。

## 考虑过的替代方案

- 按当前回复猜用量归属：迟到的根线程或子线程响应可能把费用关联到错误消息。
- 未知流模型继续复用配置容量：输入计数与窗口可能来自不同模型。
- 只向调用方返回 unknown：现有观察者与未来快照继续保留旧确认结果。
- 只按模型代次隔离读取：同一代次内的两个并发读取仍可能乱序完成。

## 影响

Gemini 只补充已有协议元数据，不增加 ID 映射或 migration。Claude 在活动模型窗口不可知或有效读取失败时可以展示未知上下文。已被替代的读取返回 `context-changed`，不再发布。观察仍为被动行为，不启动模型请求或子进程。

## 验证

- Regression — `AiSdkToGeminiSse.test.ts`：空输出和非空输出的最终 SSE 与完整 JSON 均保留计费响应 ID。
- Regression — `gatewayIntegration.test.ts`：生产网关、已安装的 Google 客户端与完成迁移的 SQLite 数据库，在两种响应形式下将不同响应 ID 关联到独立的根／子线程消息归属，不重复计费。
- Regression — `contextUsage.test.ts` 与真实 SDK 传输：未知活动模型经过仅含输出计数的 delta 后仍为 unknown；有效读取失败及未知窗口会通知已有和稍后加入的观察者；迟到失败不能覆盖新模型代次或更新的读取。
- Regression — `runtime.test.ts -t 'does not spawn a CLI for context reads'`：真实 Claude CLI 在受控原生回合后报告上下文；读取不会额外启动进程或供应商请求。

定向 Google 客户端身份检查与四项 Claude wire 用例在修复前失败。受控传输与供应商 fixture 不代表真实供应商故障，也不证明所有桌面模型切换路径均受支持。
