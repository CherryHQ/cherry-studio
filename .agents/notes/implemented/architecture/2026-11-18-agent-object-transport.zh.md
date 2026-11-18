# Agent Note: 原生智能体模型调用的对象传输

Status: implemented

[English](2026-11-18-agent-object-transport.md) | 中文

## Problem

Pi 和 Pi Durable 在主进程运行，却通过 Cherry 内部 HTTP 网关调用模型。Pi 原生 provider 序列化请求并解析 SSE，网关则在 Cherry 唯一的 AI SDK 执行管线外解析请求并序列化事件。

[Harness 边界决策](../../proposed/architecture/2026-10-17-agent-harness-boundaries.md) 删除了自定义 Pi-to-AI-SDK 模型端口，避免 Cherry 维护原生重放、工具与流语义。删除内部编解码必须保留这条协议边界。

## Decision

扩展现有固定版本 Pi AI 补丁，为 Anthropic Messages、OpenAI Chat Completions、OpenAI Responses 和 Gemini 增加可选的对象 transport。原生 provider 继续构建既有协议请求、消费既有协议事件；transport 交换这些对象，不将 Pi 上下文翻译为 AI SDK 消息。默认原生 HTTP 执行保持可用。

HTTP 与对象交付共享网关准备和协议适配器。HTTP 路由保留鉴权、JSON 解析、响应提交与 SSE 格式化。桌面绑定传入可信的进程内会话归属和请求选择。两条路径共享模型准入、转换器、AI SDK 执行、凭据、provider 兼容、tracing 和唯一计费写入者。客户端工具在网关内没有执行器；原生 runtime 保留重试归属。

对象交付在 accumulator/listener 分流之前设置容量门，并使用有界的协议事件队列。可交付的工具错误调用在适配器接受后提交启动，使无文本批次能在队列填满前开始消费。取消、提前关闭迭代器和失败须释放等待中的消费者并中止上游执行。慢消费不得产生无界队列。保留 provider 错误和终止结果；不得将部分消费的调用通过 HTTP 重试。

本决策仅部分取代 harness 边界决策中的内部 HTTP 要求。Pi/Pi Durable 保留原生调度、历史、工具、压缩与恢复。现有 UIMessage 转换、工具参数 JSON 片段、持久化及真实上游网络编解码继续保留。包括 Claude Code 在内的外部客户端继续使用 HTTP。

## Alternatives considered

- 内存 fetch 仍保留 JSON/SSE 编解码。
- Pi-to-AI-SDK 适配器会恢复已删除的模型端口和 metadata 维护负担。
- 其他进程可以隔离主进程，但保留内部编解码并改变资源归属。
- 直连上游 provider 会拆散 Cherry 的 AI SDK 兼容、凭据和计费。

## Consequences

Provider SDK 隐式处理整形、校验和错误分类。对象路径提供原生事件形状，包括 Anthropic SDK 默认字段和 Gemini 响应对象。因此需要随已有依赖补丁维护固定版本的原生 transport hook。默认原生 HTTP 仍然可用；桌面绑定不会在对象调用失败后回退到 HTTP。

网关继续唯一拥有 provider 配置、上游凭据、AI SDK 执行及计费。HTTP 监听器重启不再使 Pi 连接失效。现有 UIMessage 转换、工具参数 JSON 片段、持久化和上游网络编解码继续保留。尚未测量 CPU 或延迟改善。

## Verification

- AC1 — `gatewayModelBinding.test.ts`（25 项通过）、`gatewayIntegration.test.ts`（43 项通过）和原生 `nativeSession.test.ts` / `queryFork.test.ts`（18 项通过）覆盖四种对象协议、原生重放和未改变的默认 HTTP 执行。
- AC2 — 生产网关集成对四种协议禁止内部协议请求 JSON 编码和 SSE 格式化，验证零次内部 HTTP 请求、一次上游请求和一条计费记录；同时覆盖不透明 reasoning 重放、工具归属、请求选择及结构化 provider 失败。
- AC3 — 生产网关集成覆盖执行启动失败、部分输出后流失败、语义输出前取消、首次读取前关闭迭代器、有界生产进度，以及慢消费后的无损恢复。包含八个对象形状工具错误的无文本批次会返回所有原生 Responses 工具调用，不再阻塞到取消；该回归在启动修复前失败。
- AC4 — 使用 `setupTestDatabase` 的生产网关集成覆盖并发 root、原生 phase 父级、冻结的消息归属、root/child 响应关联，以及原生 summary 的归属和唯一计费写入者。
- AC5 — 13 个受影响 Main 测试文件通过（1745 项通过，2 项跳过），随后扩展后的 42 项网关集成测试通过；`pnpm install --frozen-lockfile` 和 `pnpm typecheck:node` 通过。随后无监听器的桌面连接测试通过（144 项通过，2 项跳过）。依赖补丁安装重新构建了原生 runtime 包，隔离的 Electron 开发构建成功打开主窗口。真实供应商调用、分发包测试和性能测量仍是独立检查。
