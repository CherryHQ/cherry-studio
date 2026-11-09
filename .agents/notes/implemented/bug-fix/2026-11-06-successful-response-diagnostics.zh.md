# Agent Note: 保留成功响应无法处理时的安全诊断证据

Status: implemented

[English](2026-11-06-successful-response-diagnostics.md) | 中文

## 问题

#23706 暴露了提供商错误序列化边界上的诊断信息丢失。SDK 处理响应失败时，可能抛出 HTTP 状态为 200、消息为 `Failed to process successful response` 的 `APICallError`。清除其原因和响应体可以保护隐私，但原先的处理也丢弃了区分空响应体、无效 JSON、结构不符和读取器终止的证据。包装错误随后被归为 `unknown`。

直接抛出的 SDK `JSONParseError` 和 `TypeValidationError` 还会进入通用应用错误序列化分支，保留解析文本、校验值、堆栈和原因。这些字段可能包含提示词、凭据或完整响应。

## 决策

共享序列化器通过 SDK 的 `EmptyResponseBodyError`、`JSONParseError` 和 `TypeValidationError` 身份检查函数，选择固定、不含载荷的英文说明。包装错误的诊断要求错误是实际 SDK `APICallError`，状态码表示成功，且外层消息在忽略大小写后精确等于 `Failed to process successful response` 或 `Invalid JSON response`。没有实际空响应体原因时，只有后一种处理器的原始 `responseBody === ''` 才能证明响应体为空；字段缺失和空白字符都不能证明这一点。

对于已识别的包装错误，如果其原因恰好是 `TypeError('terminated')`，则给出保守的响应处理建议。不支持的原因使用固定的通用恢复建议。对 Anthropic 合成状态 500 的解析错误记录进行有界解码，通过其 `AI_JSONParseError` 名称和字符串 `text` 识别错误，输出固定的 JSON 说明，并保留 `server → provider_unavailable`。不复制记录中的任何字段。替换说明前，保留已有的更高优先级分类。

共享分类器在已有的解析分支中识别成功响应包装消息，该分支位于更强的诊断之后。主进程除已有的 API 调用错误路由外，只把直接抛出的 SDK 解析和校验错误身份路由到安全序列化器。API 调用错误的原始字段仍为 null，`url` 仍为空字符串，状态码和重试标记保持不变。已有的输入、解码、输出、嵌套、脱敏和 SDK 字段限制继续适用。缺少结束原因的归一化及部分内容保留行为保持不变。

`2026-10-25-request-body-parse-classification.md` 中的请求体分类决策继续负责请求侧拒绝的优先级；本响应侧决策不取代它。

## 备选方案

- 透传原始原因消息：不采用，因为即使是已识别的 SDK 错误，也可能回显任意解析输入、校验值或自定义消息。
- 把所有 2xx 错误归为 parse：不采用，因为 HTTP 成功本身不能确定哪个操作失败，也不能覆盖更强的证据。
- 添加渲染层专用映射或新的本地化标题：不采用，因为现有解析错误标题及提供商、模型信息组合已经能够呈现归一化后的错误。
- 修补适配器或根据 MIME 拒绝响应：不采用，因为协议校验属于独立策略；目前以 `text/html` 返回的有效 JSON 可以成功处理。

## 后果

新错误保留可操作的诊断含义，同时不保留其载荷。在 `message` 中使用英文协议说明是接受的代价；已有本地化标题保持不变。不重写已有的失败快照或显式 `unknown` 分类。

Anthropic 在不完整 EOF 后仍静默接受的流没有错误可供诊断。不检测或拒绝 MIME 错误的响应。本修复不增加自动重试或专用 Work 重试操作。对于错误附带的成功 HTTP 状态码，网关继续将其映射为 502。

## 验证

- Regression — `src/shared/ai/__tests__/providerError.test.ts`：验证固定说明、SDK 身份门槛、精确空字符串、更强分类、Anthropic 有界解码、隐私哨兵、脱敏、输入输出限制、深度限制和循环引用。
- Regression — `src/shared/utils/__tests__/errorCategory.test.ts` 与 `src/shared/ai/__tests__/executionFailure.test.ts`：验证响应包装消息的解析分类、仅有状态码及请求侧的反例、分类优先级和已有失败转换；3 个共享测试文件的全部 245 项测试通过。
- Regression — `src/main/ai/utils/__tests__/successfulResponse.test.ts`：验证零重试的真实兼容接口和 Anthropic SDK 错误、经 Agent 捕获原始错误、终态持久化与投影、读取器终止前已消费的部分文本、缺少结束原因的元数据、安全的网关 502 输出、有效 JSON/SSE/空文本/纯工具调用对照，以及取消。
- Regression — `src/main/ai/utils/__tests__/serializeError.test.ts`：已有直接 API 调用错误的结构测试保持不变并通过，包括空字符串 URL 和为 null 的原始字段。
- Regression — `src/main/ai/runtime/aiSdk/loop/__tests__/agentLoop.test.ts`、`src/main/ai/streamManager/__tests__/pipeStreamLoop.test.ts`、`src/main/ai/streamManager/listeners/__tests__/PersistenceListener.test.ts` 和 `src/main/ai/streamManager/__tests__/TopicMessageProjection.test.ts`：验证已有的终态错误捕获、累积、持久化和投影契约；这 4 个文件与 2 个序列化测试文件的全部 124 项测试通过。
- Regression — `src/main/features/apiGateway/__tests__/errors.http.test.ts`：夹具和用例表的期望值断言新的结构说明，同时保留原始 SDK 消息和网关 502 状态。`sdk-anthropic-200-non-message` 的精确字节长度断言对 Anthropic / OpenAI / OpenAI Responses / Gemini 分别使用 147 / 159 / 159 / 144 字节。全部 1,015 项测试均执行并通过，无跳过；不再有过时的字节长度期望值。
- Regression — `src/renderer/components/chat/messages/blocks/__tests__/ErrorBlock.test.tsx`、`src/renderer/utils/__tests__/errorClassifier.test.ts`、`src/renderer/services/__tests__/toast.test.ts` 和 `src/renderer/pages/home/hooks/__tests__/useChatWriteActions.test.tsx`：验证已有错误呈现、分类、提示和聊天写入契约；4 个渲染层测试文件的全部 213 项测试通过。

所有报告中的测试套件均使用仓库的 Vitest 配置。最终运行中，单独运行的网关测试文件全部 1,015 项测试、7 个主进程文件合并运行的全部 1,139 项测试，以及 3 个共享文件的全部 245 项测试均通过，无失败或跳过。前一次修正还通过了 4 个渲染层文件的全部 213 项测试，以及无诊断错误的 Node TypeScript 检查；本次最终字节长度期望值修改未重新运行这些检查。未测试 Electron 或原生智能体会话。
