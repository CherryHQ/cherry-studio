# Agent Note: 保留网关已支持的协议语义

Status: proposed

[English](2026-11-19-gateway-protocol-fidelity.md) | 中文

## 问题

生成请求统一经过 Cherry 提供商和一次 AI SDK 调用，但剩余请求转换器会静默遗漏工具限制、输出格式、附件及提供商选项。响应适配器将原生终态压平，并遗漏 SDK 已提供的元数据。这些损失同时影响共用转换器的 HTTP 和 object 调用。Issue #24835 接续已合并的 #24786；既有 Gemini 映射和推理重放必须保留。

## 提案

在既有转换器、单次调用选项和响应投影边界修复。以已安装 SDK 的实现（`ai@6.0.185`、OpenAI `3.0.137`、Anthropic `3.0.125`、Google `3.0.146`）作为能力依据。输出序列化、端点/模型限制及传输继续由提供商适配器负责。保留可信 Cherry 请求选择的优先级，同时避免丢弃无关选项。

将 OpenAI 函数选择、并行限制、标准 Responses 推理、已支持的生成选项和结构化输出映射到 SDK 选项。将 Chat 音频/文件、Responses 文件和 Anthropic 文档映射为带有媒体及提供商元数据的文件部件。拒绝提供商绑定的文件 ID，避免使用无关账户或提供商解析。保留 SDK 提供的 Anthropic 原生停止原因/停止串及 OpenAI logprobs/Responses 服务档位，长度限制/过滤/错误结果保持优先。

网关支持无状态、单候选生成，由调用方重放历史并执行客户端函数。在上游执行前拒绝原生内置工具、服务端响应状态/后台/存储请求、多候选及其他明确不支持的语义控制。本地能力失败报告为本地错误，只有真实上游失败保留其 HTTP 状态。本次修复不实现内置工具执行、状态恢复或 SDK 未提供的响应数据。引用及工具参数逐字增量流仍不在范围内。

## 考虑过的替代方案

- 直接转发原生 HTTP 请求：重复实现提供商解析、传输、用量和兼容性职责。
- 仅注册原生内置工具工厂：缺失执行事件/结果和重放语义。
- 遗漏不支持的控制或附件后仍返回成功：调用方会误信模型从未收到的约束或内容。

## 验收标准

- AC1 — OpenAI none/auto/required/指定函数选择及并行限制经真实 SDK 序列化后保留在已支持的目标端点上。（验证：unit）
- AC2 — Chat、Responses 和 Anthropic JSON/schema 输出进入 SDK Output 路径；流式和完整响应保留截断/错误。（验证：unit）
- AC3 — URL/base64 文件、WAV/MP3、图片 detail 及 Anthropic 用户/工具结果文档保留内容及适用元数据；仅附件消息不消失，提供商绑定文件 ID 明确失败。（验证：unit）
- AC4 — 标准 Responses 推理及 Anthropic thinking 细节在原生映射后保留；可信推理选择只替换推理配置。（验证：unit）
- AC5 — 已支持的 Chat seed/penalties 和端点特定的 OpenAI 档位、verbosity、truncation、include/logprobs 选项经真实 SDK 序列化后保留，不凭空添加 Responses 不支持的 seed/penalties。（验证：unit）
- AC6 — 流式和完整响应保留 SDK 提供的 Anthropic 原生停止原因/停止串、OpenAI logprobs 和 Responses 服务档位；原生元数据不能覆盖失败/长度限制/过滤的优先级。（验证：unit）
- AC7 — 生产 HTTP/object 准备及执行路径回归能捕获语义丢失，并保护推理签名、完整并行工具调用、用量及错误/中止行为。（验证：unit）
- AC8 — 不支持的内置工具、服务端 Responses 状态/后台/存储及多候选明确失败；参考文档说明支持矩阵和证据边界。（验证：unit and docs gate）

## 风险

明确的能力错误会暴露之前的静默遗漏，客户端可能需要关闭不支持的功能。跨提供商语义仍受选定 SDK 提供商和模型限制；厂商文件句柄不能变得可移植。基于固定响应的生产路径测试验证转换和序列化，不声称已完成付费模型验收，也不扩展 Pi 多模态界面能力。锁定的 OpenAI 提供商未暴露 Chat 实际服务档位和 refusal，网关报告这些信息前必须先修复上游。
