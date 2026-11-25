---
description: 已支持的生成协议转换、适配器特定控制、不支持的请求及验证边界
sources:
  - src/main/features/apiGateway/adapters
  - src/main/features/apiGateway/prepareGatewayMessage.ts
  - src/main/features/apiGateway/errors.ts
---

# 生成协议兼容性

[English](protocol-compatibility.md) | 中文

[API Gateway](README.md) 通过一个 Cherry 提供商和一次 AI SDK 执行转换请求。
HTTP 与原生 object 调用使用相同转换器。选定的 SDK 适配器和模型决定支持哪些输出选项和媒体。
这些契约针对 `ai@6.0.185`、`@ai-sdk/openai@3.0.137`、
`@ai-sdk/anthropic@3.0.125` 和 `@ai-sdk/google@3.0.146` 验证。

## 已支持的转换

| 输入 | 保留的语义 | 目标边界 |
| --- | --- | --- |
| Chat Completions | `tool_choice` none/auto/required/指定函数；`parallel_tool_calls`；seed 和 frequency/presence penalties | 函数选择使用 SDK 标准选项。禁止并行调用需要适配器能够表达该约束。 |
| Responses | 函数选择；并行限制；标准 `reasoning.effort/summary`；`text.verbosity`、`truncation`、已支持的 `include`/logprobs、`service_tier` | OpenAI 特定选项需要 SDK 适配器支持。Responses 目标会拒绝 seed/penalties，而不是静默丢弃它们。标准 `reasoning.effort` 优先于旧顶层 `reasoning_effort`。 |
| Chat / Responses | `response_format` / `text.format` JSON object 或 JSON schema | 使用 SDK `Output.json` / `Output.object`，包括 schema 名称/描述及已支持的严格度控制。通用 Open Responses 支持 schema 输出，但无法表达 JSON object 模式。 |
| Anthropic | `output_config.format` JSON schema；原生工具选择及并行限制；adaptive thinking 的 `display` 和 `block_binding` | 使用 SDK Output 和原生 thinking 选项。可信 Cherry 推理选择替换请求的 thinking/effort，同时保留无关选项。锁定 SDK 无法表达非 adaptive thinking 的 display/binding 控制。 |
| Chat 内容 | 图片 detail、WAV/MP3 `input_audio`、携带文件名和媒体类型的内联 `file.file_data` | 音频需要模型具备音频输入能力。文件/媒体能否接收仍取决于适配器。 |
| Responses 内容 | 用户及工具结果 URL/base64 文件；用户图片 detail | 仅附件消息不会消失。工具结果文件带有调用 ID 锚点并迁移到用户内容中。 |
| Anthropic 内容 | 用户及工具结果 PDF URL/base64 和纯文本文档；title、context 及缓存元数据 | 工具结果文档带有调用 ID 锚点并迁移到用户内容中。不支持复合文档来源。 |
| 原生输出 | Anthropic 停止原因/停止串；SDK 提供的 OpenAI logprobs；已报告的 Responses 服务档位 | 流式终态事件和完整响应保留可用元数据。长度限制/过滤/错误结果的优先级高于原生元数据及已完成的工具调用。 |

Gemini 保留既有安全/缓存配置、JSON/schema 输出、函数选择、penalties/seed、已支持的媒体配置、
签名及原生终态元数据。Pi 文字会话保留既有显示能力。

## 适配器差异

原生 OpenAI/Azure 适配器及 Cherry 基于 OpenAI 语言模型派生的适配器能够序列化原生 OpenAI 控制。
通用 OpenAI-compatible 适配器不会仅因使用 OpenAI 形状的端点就获得这些控制能力。
锁定的通用 `open-responses` 适配器支持函数选择、schema 输出和推理摘要，
但缺少并行限制以及表中的其他原生 OpenAI 选项。需要这些缺失控制的请求会明确失败。
改进这些适配器属于上游工作；网关不会注入第二套原始请求体传输。

并行限制可在已支持的 OpenAI 和 Anthropic 目标之间转换。
选定适配器无法执行明确的禁止要求时，请求失败。允许并行执行并不要求模型发出多个调用。

## 明确的能力失败

网关在上游执行前拒绝以下已知不支持的语义：

- 原生内置工具及不支持的内置历史内容块，包括 web search、code execution 和 tool search 声明。
  调用方执行的函数工具继续受支持。
- Responses `previous_response_id`、`conversation`、启用的 `background` 及 `store:true`。
  请使用无状态请求、`store:false` 及完整的调用方重放历史。不提供 GET/cancel 及服务端响应生命周期。
- 多个 Chat 或 Gemini 候选、Chat 音频输出、不支持的 Responses 工具选择，
  以及加密推理和输出文字 logprobs 以外的 `include` 值。
- 提供商绑定的 `file_id` 引用。请提供可移植的 URL/base64 内容，
  避免假定文件句柄可在选定提供商账户中解析。
- 已知不支持的适配器控制及模型不兼容的图片/音频/视频输入。

HTTP 返回本地无效请求错误，指出不支持的功能。Object 调用保留 `UnsupportedFunctionalityError`，
不会伪造上游 HTTP 状态。真实上游 HTTP 失败保留其实际状态。任意未知字段不保证原生透传；
这是一套范围有限的语义转换器。

## 元数据与验证边界

网关消费受控的 SDK 元数据，不会从生成文字推断缺失的提供商信息。
锁定 OpenAI SDK 未暴露 Chat 实际服务档位或 refusal，其 logprob 投影也未保留 token bytes。
缺失的 Chat bytes 保持 null；Responses 字节数组在不可用时保持为空，不会重新编码 token 文字。
只能返回选定 SDK 适配器实际提供的 logprobs。引用和工具参数逐字增量流仍不在此契约内；
多个完整函数调用继续受支持。

`protocolSemantics.integration.test.ts` 使用固定上游协议响应，覆盖实际 HTTP 路由、object 传输、
生产准备/执行和 SDK 序列化。它检查约束、附件、结构化输出、元数据、可信选择、能力失败和上游错误。
既有协议/运行时回归保护用量、推理重放、完整工具调用及取消。
这些测试不代表付费模型验收、真实图片生成或新增 Pi 多模态界面行为。
