# Agent Note: 通过单一 SDK 执行路径转发网关请求

Status: implemented

[English](2026-11-09-gateway-sdk-forwarding.md) | 中文

## Problem

网关需要保留 harness 上下文并复用 SDK 的提供商兼容能力。原生 HTTP 旁路重复维护端点、认证、响应观测和计费职责；现有 SDK 转换器也会丢失工具 schema 组合、工具错误、工具选择和显式缓存元数据。

## Decision

所有生成请求将入站协议转换为 SDK 消息、工具和提供商选项，再运行一次由调用方拥有执行权的 SDK 调用。出站协议和传输由 SDK provider adapter 负责。网关不增加 Agent 循环、工具执行、AI 修复、生成重试或模型回退；普通应用聊天保留现有循环。

复用现有提供商解析、messageRules、兼容中间件、追踪和用量捕获。入站转换器保留已支持的调用方语义：直接使用 SDK JSON schema，保留工具结果错误状态、映射工具选择，并通过 provider metadata/options 携带显式缓存标记。调用方显式缓存设置优先于自动缓存布置。支持 Anthropic 的内部请求继续优先使用已配置的 Anthropic 端点，其他端点准入和回退规则不变。

移除尚未提交的原生 HTTP 分支及重复的传输／规则／观测模块；放弃的实验仅留在本地诊断产物中。不承诺 SDK 转换保留不支持的协议扩展。

## Alternatives considered

- 原生 HTTP 正文转发：能保留未知字段，但重复 SDK 提供商行为，不符合维护者要求的职责边界。
- 保持现有转换器：会静默丢失调用方语义。
- 禁用兼容中间件：会丢失第三方端点需要的规范化。

## Consequences

SDK 语义转发不保证 JSON 字节相同、未知请求字段或未知响应事件。提供商 adapter 和兼容规则可以有意规范化已支持的值。模型和 fixture 有边界，单次 Qwen 成功不能证明所有提供商或扩展兼容。

## Verification

- AC1 — `singleStep.test.ts`、`buildAgentParams.test.ts`、网关流式测试和普通聊天计费测试验证单步执行、提示词所有权、错误／取消及普通聊天循环。
- AC2 — 四种转换器的 schema 契约测试及真实 SDK Anthropic 出站测试验证 schema 引用、错误状态、工具选择和缓存边界。SDK 依赖补丁修复本地工具结果元数据未传递的问题。
- AC5 — TLC 检查 168 个状态、308 次迁移，10 条不变量及无死锁检查通过。旧转换器的三个反例通过真实 SDK 测试重放；请求过程中修改模型价格仍按冻结价格单次入账。
- AC6 — 隔离 Electron 的 Durable → Qwen3.8 Flash 请求仅出站一次；25,734 字符的 developer 提示词与入站逐字一致，含 14 个技能；HTTP 200、统一 trace 和单次用量记录均已核对。该次模型额外编造技能，未将传输保真误作回答质量保证。

- AC3 — `anthropicAgent.integration.test.ts` 验证缓存边界、工具错误、选择、签名及原始 schema 的实际 SDK 出站序列化。
- AC4 — `proxyStream.stream.test.ts`、`providerBilling.integration.test.ts` 验证独立 instructions、错误／取消、普通聊天循环和计费。
