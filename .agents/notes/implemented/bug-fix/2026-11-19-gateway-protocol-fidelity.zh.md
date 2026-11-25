# Agent Note: 保留网关已支持的协议语义

Status: implemented

[English](2026-11-19-gateway-protocol-fidelity.md) | 中文

## 问题

生成请求统一经过 Cherry 提供商和一次 AI SDK 调用，但剩余请求转换器曾静默遗漏工具限制、输出格式、附件及提供商选项。响应适配器曾将原生终态压平，并遗漏 SDK 已提供的元数据。这些损失曾同时影响共用转换器的 HTTP 和 object 调用。Issue #24835 接续已合并的 #24786；既有 Gemini 映射和推理重放必须保留。

## 决定

在既有转换器、单次调用选项和响应投影边界修复。以已安装 SDK 的实现（`ai@6.0.185`、OpenAI `3.0.137`、Anthropic `3.0.125`、Google `3.0.146`）作为能力依据。输出序列化、端点/模型限制及传输继续由提供商适配器负责。保留可信 Cherry 请求选择的优先级，同时避免丢弃无关选项。

将 OpenAI 函数选择、并行限制、标准 Responses 推理、已支持的生成选项和结构化输出映射到 SDK 选项。将 Chat 音频/文件、Responses 文件和 Anthropic 文档映射为带有媒体及提供商元数据的文件部件。拒绝提供商绑定的文件 ID，避免使用无关账户或提供商解析。保留 SDK 提供的 Anthropic 原生停止原因/停止串及 OpenAI logprobs/Responses 服务档位，长度限制/过滤/错误结果保持优先。

网关支持无状态、单候选生成，由调用方重放历史并执行客户端函数。在上游执行前拒绝原生内置工具、服务端响应状态/后台/存储请求、多候选及其他明确不支持的语义控制。本地能力失败报告为本地错误，只有真实上游失败保留其 HTTP 状态。内置工具执行、状态恢复及 SDK 未提供的响应数据仍不受支持。引用及工具参数逐字增量流仍不在范围内。

## 考虑过的替代方案

- 直接转发原生 HTTP 请求：重复实现提供商解析、传输、用量和兼容性职责。
- 仅注册原生内置工具工厂：缺失执行事件/结果和重放语义。
- 遗漏不支持的控制或附件后仍返回成功：调用方会误信模型从未收到的约束或内容。

## 后果

明确的能力错误会暴露之前的静默遗漏，客户端可能需要关闭不支持的功能。跨提供商语义仍受选定 SDK 提供商和模型限制；厂商文件句柄不能变得可移植。基于固定响应的生产路径测试验证转换和序列化，不声称已完成付费模型验收，也不扩展 Pi 多模态界面能力。锁定的 OpenAI 提供商未暴露 Chat 实际服务档位和 refusal，网关报告这些信息前必须先修复上游。

[单一 SDK 所有权决定](../architecture/2026-11-09-gateway-sdk-forwarding.md)保持不变。原生 OpenAI/Azure 及实际基于 OpenAI 派生的目标适配器接收其支持的选项。通用 compatible/Open Responses 的缺口明确失败，不引入原始请求体变通路径。

## 验证

- AC1 — `protocolSemantics.integration.test.ts`：真实 OpenAI/Anthropic SDK 协议请求保留 none/auto/required/指定工具选择及并行限制；不支持的通用适配器在传输前失败。
- AC2 — `protocolSemantics.integration.test.ts`：三个协议均发送 SDK schema 格式并保留流式/完整输出及原生截断；另覆盖 Chat/Responses JSON 模式及真实 Chat 上游 429 错误。
- AC3 — `protocolSemantics.integration.test.ts`：WAV/MP3、图片 detail、PDF/base64/URL 文件、纯文本文档和并行工具结果文档保留内容/元数据；仅附件消息不消失，提供商绑定句柄明确失败。
- AC4 — `protocolSemantics.integration.test.ts`：在序列化后的上游请求体中检查标准 Responses effort/summary、adaptive display/binding 及可信 object 推理优先级。
- AC5 — `protocolSemantics.integration.test.ts`：零 seed、penalties、档位、verbosity、truncation 和 include/logprobs 经原生序列化后保留；Responses 不兼容控制在传输前失败，可信档位选择抑制冲突的请求体档位。
- AC6 — `protocolSemantics.integration.test.ts` 和 `protocolFidelity.test.ts`：原生 Anthropic 停止串/pause、OpenAI logprobs 及已报告的 Responses 档位在完整/流式输出中保留；长度限制/过滤/错误保持优先，包括原生上下文窗口限制。
- AC7 — 定向网关适配器、`anthropicAgent.integration.test.ts`、`proxyStream` 测试、`agentApiGateway.test.ts` 和 `singleStep.test.ts` 保护生产 HTTP/object 语义、签名、并行调用、用量、错误及取消。
- AC8 — `protocolSemantics.integration.test.ts`、转换器测试及 `pnpm docs:check`：明确的能力失败和双语[协议兼容性参考](../../../../docs/dev/references/api-gateway/protocol-compatibility.md)覆盖内置工具、状态/存储/后台、多候选及适配器限制。
