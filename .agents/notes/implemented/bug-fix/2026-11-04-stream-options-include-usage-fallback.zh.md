# Agent Note: 不兼容主机的 stream_options include_usage 回退

Status: implemented

[English](2026-11-04-stream-options-include-usage-fallback.md) | 中文

## 问题

自定义 OpenAI 兼容聊天端点可能以 `400 Unknown parameter` 拒绝 `stream_options.include_usage`，导致普通聊天以及经内部网关转发的 Pi agent 请求整体失败（#23368，与 #11652 相同特征）。`openai-compatible` 路径虽有按提供商的 `streamOptions` 开关，但 Pi 网关注入从未读取该开关，且两条路径都不会自动恢复。

## 决策

Pi 的网关绑定将 Chat Completions 方言的 `streamOptions` 映射到 `compat.supportsUsageInStreaming`。端点显式关闭流式用量时，首次请求即省略 `stream_options`，也覆盖 OpenAI SDK 默认发送该字段的情况。

Chat 和受信的桌面网关调用由模型重试层观察实际序列化的请求。服务端以 400 明确拒绝已发送的 `stream_options` 字段时，去掉该顶层字段重试一次。修复计入模型尝试预算，并且只在输出内容前生效。公开 Gateway 遵循自身的重试策略。

## 考虑过的替代方案

- 仅保留手动开关：Pi agent 依然失败，且要求每个受影响用户自行发现提供商 API 选项。
- 将自定义提供商默认值改为 `false`：可避免 400，但会在支持该字段的服务上默默丢失用量统计。
- 成功重试后持久化 `streamOptions: false`：可避免每次多一次 400，但会静默修改用户配置；本次采用无状态重试，仅在显式关闭时提前省略。

## 影响

支持该字段的服务保留用量上报。省略字段后的响应可能缺少流式 token 用量。省略只作用于当前模型调用，后续调用恢复发送，端点显式关闭该字段的情况除外。

## 验证

- Regression — `src/main/ai/runtime/pi/gatewayIntegration.test.ts` 覆盖两种 Chat SDK 适配器、Pi Work 单次恢复、独立调用隔离和公开 Gateway 错误透传。
- Regression — `src/main/ai/provider/__tests__/config.test.ts` 覆盖端点关闭流式用量时从首次请求省略字段。
- Regression — `src/main/ai/runtime/pi/gatewayModelBinding.test.ts` 覆盖 Chat Completions 和其他 Pi 协议的流式用量兼容配置。
