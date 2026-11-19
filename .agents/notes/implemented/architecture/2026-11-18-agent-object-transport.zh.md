# Agent Note: 原生智能体模型调用的对象传输

Status: implemented

[English](2026-11-18-agent-object-transport.md) | 中文

## Problem

Pi 和 Pi Durable 在主进程运行，却通过 Cherry 内部 HTTP 网关调用模型。Pi 原生 provider 序列化请求并解析 SSE，网关则在 Cherry 唯一的 AI SDK 执行管线外解析请求并序列化事件。

[Harness 边界决策](../../proposed/architecture/2026-10-17-agent-harness-boundaries.md) 删除了自定义 Pi-to-AI-SDK 模型端口，避免 Cherry 维护原生重放、工具与流语义。删除内部编解码必须保留这条协议边界。

## Decision

扩展现有固定版本 Pi AI 补丁，为 Anthropic Messages、OpenAI Chat Completions、OpenAI Responses 和 Gemini 增加可选的对象 transport。原生 provider 继续构建既有协议请求、消费既有协议事件；transport 交换这些对象，不将 Pi 上下文翻译为 AI SDK 消息。默认原生 HTTP 执行保持可用。

HTTP 与对象交付共享网关准备和协议适配器。HTTP 路由保留鉴权、JSON 解析、响应提交与 SSE 格式化。桌面绑定传入带类型的可信上下文，携带会话归属、trace 父级和请求选择，不再伪造 bearer 鉴权。root 绑定发起脱离父调用的请求时，显式 child capture 保留自身归属和 trace 父级。两条路径共享模型准入、转换器、AI SDK 执行、凭据、provider 兼容、tracing 和唯一计费写入者。客户端工具在网关内没有执行器；原生 runtime 保留重试归属。

对象交付与 HTTP 使用相同的启动提交 chunk。取消、提前关闭迭代器和失败须中止上游执行。原生 `timeoutMs` 限制启动和上游空闲等待。原生 provider 在 `finally` 中释放对象响应，包括迭代前 hook 抛错的路径。未读协议事件不单独设上限：stream manager 已累积同一响应，队列不会超过它。保留 provider 错误和终止结果；不得将部分消费的调用通过 HTTP 重试。

本决策仅部分取代 harness 边界决策中的内部 HTTP 要求。它同时取代[原生载荷额度](../bug-fix/2026-11-15-native-model-payload-budget.md)；该额度在原生请求序列化之前准入，而对象调用不再编码该请求。Pi/Pi Durable 保留原生调度、历史、工具、压缩与恢复。现有 UIMessage 转换、工具参数 JSON 片段、持久化及真实上游网络编解码继续保留。包括 Claude Code 在内的外部客户端继续使用 HTTP。

协议适配器同时保留结构化推理签名和原生用量拆分。Chat Completions 将 OpenRouter 重复提供的 reasoning_details 累计快照仅交付一次，并从原生历史恢复为 provider metadata，包括没有可读文本的加密状态。OpenAI 协议保留缓存写入，Anthropic 保留 thinking_tokens；缺失的细分保持缺失。明确的最终截断或过滤原因优先于工具存在性。模型原生引用和工具参数增量不在此次补齐范围内。

固定版本 AI SDK 已支持的 Gemini 请求配置通过共享单次调用合同映射：采样、JSON/schema 输出、函数选择、安全设置、缓存上下文，以及原生媒体、标签和服务选项。HTTP 与对象调用使用同一投影。未支持的本地客户端行为以 SDK 能力错误失败，不伪造 HTTP 状态。客户端函数执行仍归原生 runtime。文件输出与 Google 结束元数据保留原生事件形状；Pi 文字会话维持既有输出能力。

## Alternatives considered

- 内存 fetch 仍保留 JSON/SSE 编解码。
- Pi-to-AI-SDK 适配器会恢复已删除的模型端口和 metadata 维护负担。
- 其他进程可以隔离主进程，但保留内部编解码并改变资源归属。
- 直连上游 provider 会拆散 Cherry 的 AI SDK 兼容、凭据和计费。
- 容量门加有界事件队列会在原生消费者落后时暂停 stream manager 读取和空闲计时。累积响应已持有相同内容，因此它只限制了第二份副本，代价是 listener hook、空闲计时器暂停/恢复，以及工具错误的启动提交特例。

## Consequences

Provider SDK 隐式处理整形、校验和错误分类。对象路径提供原生事件形状，包括 Anthropic SDK 默认字段和按需加载的 Gemini 响应对象。Gemini 配置遵循固定 Google language provider 支持的子集。未支持的本地客户端行为返回 SDK 能力错误，不伪造 HTTP 状态。接受禁用客户端自动函数调用；执行权仍归原生 runtime。因此需要随已有依赖补丁维护固定版本的原生 transport hook。默认原生 HTTP 仍然可用；桌面绑定不会在对象调用失败后回退到 HTTP。

网关继续唯一拥有 provider 配置、上游凭据、AI SDK 执行及计费。HTTP 监听器重启不再使 Pi 连接失效。现有 UIMessage 转换、工具参数 JSON 片段、持久化和上游网络编解码继续保留。尚未测量 CPU 或延迟改善。原生消费者落后时，未读事件最多与响应等长，并与累积消息同时存在。移除原生载荷额度后的峰值内存尚未测量。

## Verification

- AC1 — `gatewayModelBinding.test.ts`（25 项通过）、`gatewayIntegration.test.ts`（72 项通过）和原生 `nativeSession.test.ts` / `queryFork.test.ts`（18 项通过）覆盖四种对象协议、原生重放和未改变的默认 HTTP 执行。
- AC2 — 生产网关集成对四种协议禁止内部协议请求 JSON 编码和 SSE 格式化，验证零次内部 HTTP 请求、一次上游请求和一条计费记录；同时覆盖不透明 reasoning 重放、工具归属、请求选择及结构化 provider 失败。
- AC3 — 生产网关集成覆盖执行启动失败、部分输出后流失败、语义输出前取消和首次读取前关闭迭代器。包含八个对象形状工具错误的无文本批次会返回所有原生 Responses 工具调用。请求超时和 hook 失败清理回归在生命周期修复前失败；四种原生响应 hook 抛错时都会释放 execution。
- AC4 — 使用 `setupTestDatabase` 的生产网关集成覆盖并发 root、原生 phase 父级、冻结的消息归属、root/child 响应关联，以及原生 summary 的归属和唯一计费写入者。测试调用真实 `ApiGatewayService` 对象调用和 capture 方法；child capture 回归在类型上下文修复前因 usage context 为 undefined 而失败。
- AC5 — 十个受影响的 Main 测试文件及 18 项原生 HTTP 回归测试通过。`pnpm install --frozen-lockfile` 与 `pnpm typecheck:node` 通过，依赖安装构建原生 runtime 包。隔离 Electron 开发构建能打开主窗口。打包分发测试及性能测量仍是独立检查。
- AC6 — `protocolFidelity.test.ts` 与 `gatewayIntegration.test.ts` 验证重复 metadata 只交付一次结构化签名，并通过真实原生 Pi 消费者与生产转换器将仅加密 reasoning 状态送入工具续轮。
- AC7 — 同一组测试验证 OpenAI Chat/Responses 的输入总量 100 拆为普通输入 50、缓存读 20、缓存写 30；输出 10 和总量 110 保持不变。
- AC8 — 同一组测试验证 Anthropic 的 output_tokens=10 与 thinking_tokens=7 穿过对象包装并进入原生 usage，流式和非流式响应均保留细分。
- AC9 — 同一组测试验证完整工具调用后的 length/content-filter 不被工具原因覆盖；原生四协议均返回截断或过滤终态，现有取消和流中错误用例仍通过。
- AC10 — 生产网关测试检查两种交付路径实际发往上游的 HTTP 请求体，覆盖 JSON schema、安全/缓存上下文、seed 与 penalties、媒体选项、标签及服务档位。工具选择覆盖 NONE、AUTO、ANY 与 VALIDATED。转换器测试覆盖纯 JSON 和两种 schema，并验证可信 reasoning 覆盖不会丢掉其他选项。本地能力回归证明原生消费者不会收到伪造的 400。六个定向 Main 文件共 1,429 项测试通过，八个受影响消费者共 378 项通过。
- AC11 — 生产网关回归验证 HTTP 与对象交付均保留图片 `inlineData`、签名和原生结束/安全/档位/续接元数据；响应修复前这些用例失败。协议适配器测试验证完整输出中媒体不会与后续文字合并，并保留原生结束原因。隔离 Electron 使用 Gemini 4 Argon，在 Pi（21.4 秒）和 Pi Durable（36.1 秒）中完成文件工具往返，未出现 renderer 错误。流式与非流式 HTTP schema 请求均返回 200、有效 JSON 和 STOP。未对付费 provider 验收实际图片生成；Pi 文字会话的输出能力不变。
