# Agent Note: 原生智能体模型调用的对象传输

Status: proposed

[English](2026-11-18-agent-object-transport.md) | 中文

## Problem

Pi 和 Pi Durable 在主进程运行，却通过 Cherry 内部 HTTP 网关调用模型。Pi 原生 provider 序列化请求并解析 SSE，网关则在 Cherry 唯一的 AI SDK 执行管线外解析请求并序列化事件。

[Harness 边界决策](2026-10-17-agent-harness-boundaries.md) 删除了自定义 Pi-to-AI-SDK 模型端口，避免 Cherry 维护原生重放、工具与流语义。删除内部编解码必须保留这条协议边界。

## Proposal

扩展现有固定版本 Pi AI 补丁，为 Anthropic Messages、OpenAI Chat Completions、OpenAI Responses 和 Gemini 增加可选的对象 transport。原生 provider 继续构建既有协议请求、消费既有协议事件；transport 交换这些对象，不将 Pi 上下文翻译为 AI SDK 消息。默认原生 HTTP 执行保持可用。

提取共享的网关准备和协议事件执行。HTTP 路由保留鉴权、JSON 解析、响应提交与 SSE 格式化。桌面绑定传入可信的进程内会话归属和请求选择。两条路径共享模型准入、转换器、AI SDK 执行、凭据、provider 兼容、tracing 和唯一计费写入者。客户端工具在网关内没有执行器；原生 runtime 保留重试归属。

对象交付必须有界。取消、提前关闭迭代器和失败须释放等待中的消费者并中止上游执行。慢消费不得产生无界队列。保留 provider 错误和终止结果；不得将部分消费的调用通过 HTTP 重试。

本提案仅部分取代 harness 边界决策中的内部 HTTP 要求。Pi/Pi Durable 保留原生调度、历史、工具、压缩与恢复。现有 UIMessage 转换、工具参数 JSON 片段、持久化及真实上游网络编解码继续保留。包括 Claude Code 在内的外部客户端继续使用 HTTP。

协议边界还须保留结构化 reasoning 签名、缓存写入和思考 token 拆分，以及明确的最终截断或过滤原因。模型原生引用及工具参数增量不在此次补齐范围内。

## Alternatives considered

- 内存 fetch 仍保留 JSON/SSE 编解码。
- Pi-to-AI-SDK 适配器会恢复已删除的模型端口和 metadata 维护负担。
- 其他进程可以隔离主进程，但保留内部编解码并改变资源归属。
- 直连上游 provider 会拆散 Cherry 的 AI SDK 兼容、凭据和计费。

## Acceptance criteria

- AC1 — 四种原生协议均通过可选 transport 交换请求和事件对象，同时默认 HTTP 行为保持有效。（验证：unit — 原生 provider transport 测试）
- AC2 — 对象和 HTTP 调用共享网关转换与 AI SDK 执行，保留 reasoning、工具、请求选择及 provider 错误，内部不再往返 HTTP/JSON/SSE。（验证：unit — 原生绑定和网关集成测试）
- AC3 — 取消、失败、提前关闭迭代器和慢消费者都能完成收尾，不泄漏工作或产生无界缓冲。（验证：unit — 对象流生命周期测试）
- AC4 — root、child 和脱离父调用的调用保留发起时 usage/tracing 归属，每次只产生一条 provider 计费记录。（验证：unit — 使用 setupTestDatabase 的生产网关集成测试）
- AC5 — Pi 和 Pi Durable 使用对象 transport；外部 HTTP 行为及可复现的依赖安装保持有效。（验证：unit — 受影响的桌面和 HTTP 测试；packaged artifact — 依赖构建和类型检查）

- AC6 — Chat Completions 的结构化 reasoning_details 在同模型的工具续轮中原样保留，包括仅加密推理。（验证：unit — 原生 Pi 与生产网关往返测试）
- AC7 — OpenAI 协议保留上游提供的 cache-write 拆分，普通输入、缓存读写及总量不重复计数。（验证：unit — usage 转换与原生消费者测试）
- AC8 — Anthropic 保留上游提供的 thinking_tokens，正文和签名回放不变。（验证：unit — usage 转换与原生消费者测试）
- AC9 — 工具调用之后的明确 length/content-filter 结束原因优先于工具存在性；error 和取消保持失败或中止。（验证：unit — 四种协议终态测试）

## Risks

Provider SDK 隐式处理整形、校验和错误分类。对象事件必须匹配原生消费者，包括经过 SDK 规范化的 Gemini 字段。Anthropic 启动和流中失败不得变成成功完成。发布后不得修改对象引用。Tracing 与计费必须保留冻结的归属。测量前不声称 CPU 或延迟获得改善。
