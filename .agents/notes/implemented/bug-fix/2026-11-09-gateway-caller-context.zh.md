# Agent Note：通过 AI SDK 保留调用方拥有的网关上下文

Status: implemented

[English](2026-11-09-gateway-caller-context.md) | 中文

## 问题

Pi Durable 在 Responses 的 developer 消息里发送身份信息和技能目录。网关将该消息规范化为 system 消息，随后 `buildAgentParams` 组装 Cherry 的延迟工具提示并设置 `systemMessageMode: 'remove'`。最终请求丢失了调用方的 system 消息，只发送 Cherry 替换后的 instructions。这使调用方的技能目录在推理前丢失；保留该目录也不保证模型回答正确。

把 Cherry 拥有的聊天提示移到 Responses instructions 仍是有意的行为：它阻止中转服务注入默认 instructions，并避免重复发送已组装的提示。问题在于将这套策略用于调用方拥有的上下文。

## 决策


`contextOwner: 'caller'` 同时覆盖提示、工具和历史。调用方请求保留 `request.system` 和客户端工具定义，不经过 Cherry 的提示组装、注册表选择、延迟工具暴露或网页工具路由。`disableTools` 仍然有效。普通聊天保留现有的提示组装和 Responses instructions 行为。

Responses 输入面向 Responses 输出时，读取 `providerOptions.instructions` 的适配器独立接收顶层 `instructions`，不混入输入消息，涵盖空 instructions 和可信推理覆盖参数。Open Responses 和 xAI Responses 则从消息生成指令，因此这两个适配器保留转换器生成的首条 system 消息。仅凭端点协议无法判断适配器是否支持该选项。跨协议请求保留转换器的提示映射。system/developer 轮次留在消息序列中；AI SDK 可以规范化其线上角色。

现有 AI SDK 执行路径、`messageRules`、特性收集、兼容性中间件和追踪继续生效。上下文所有权不代表绕过 SDK 直接代理 HTTP，也不保证未知协议字段在 SDK 转换后仍然保留。

调用方拥有的请求使用 AI Core 的 `streamText` / `generateText`，限定为一步、
零重试，并移除工具执行。它们不构造 `ToolLoopAgent`，也不安装 AI 工具修复或
`prepareStep`；AiService 同时省略重试和模型回退包装。共享的流式生命周期保留
用量观察器、取消和错误传递。普通 Cherry 聊天继续使用工具循环。

## 考虑过的替代方案

- 缺少共享兼容策略的原始代理：丢失提供商中间件。SDK 转发路径复用共享提供商和 schema 规则。
- 全局移除 `systemMessageMode: 'remove'`：改变普通聊天的发送行为，同时仍保留网关提示注入。
- 在 `ToolLoopAgent` 内依赖工具没有 `execute`：仍将 AI 修复和未来的续轮行为与网关耦合。
- 只恢复技能目录：只修复一个症状，身份信息和后续 system 轮次仍可能丢失。

## 后果

网关客户端拥有工具发现和智能体上下文。Cherry 不再仅因客户端暴露 `tool_search` 而添加延迟工具说明。提供商兼容性转换仍然生效。可信网关请求通过进程内关联加入所属 Agent 会话的追踪。

## 验证

- 回归 — `src/main/ai/runtime/aiSdk/params/__tests__/buildAgentParams.test.ts` 的参数层线上报文回归覆盖缺省、空和显式 instructions，多个 system 轮次、调用方工具，以及实际生效的 Responses `strict: false` 兼容性中间件。同一测试套件继续覆盖普通聊天 instructions。
- 回归 — `src/main/features/apiGateway/__tests__/proxyStream.stream.test.ts` 的网关回归使用真实 Responses 转换器，验证可信推理覆盖参数存在时 instructions 仍与 developer 消息分开。
- 回归 — 隔离 Electron 中 Pi Durable → Qwen3.8 Flash 的入站与出站 developer 提示词逐字一致（25,734 字符，14 个技能），未使用诊断性请求体替换。HTTP 200、SDK／HTTP trace 和单次用量入账均已验证；该次模型仍额外编造技能，因此上下文传输修复不等同于回答质量保证。

- 回归 — `src/main/ai/runtime/aiSdk/loop/__tests__/singleStep.test.ts` 使用真实 AI SDK 执行，验证仅一次出站调用、不执行本地工具或修复、HTTP 503 后不重试、保留中间件和消息规范化、调用前取消，以及普通聊天的工具续轮。

- 回归 — `src/main/ai/runtime/pi/gatewayIntegration.test.ts` 通过实际 Open Responses、xAI Responses 和 OpenAI 适配器捕获生产网关出站报文，包含默认适配器选择。修复前 Open Responses 和 xAI 两条路径会丢失调用方 instructions；修复后四条路径均保留指令和 developer 技能目录。
