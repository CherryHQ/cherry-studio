# Agent Note: 不兼容主机的 stream_options include_usage 回退

Status: implemented

[English](2026-11-04-stream-options-include-usage-fallback.md) | 中文

## 问题

自定义 OpenAI 兼容聊天端点可能以 `400 Unknown parameter` 拒绝 `stream_options.include_usage`，导致普通聊天以及经内部网关转发的 Pi agent 请求整体失败（#23368，与 #11652 相同特征）。`openai-compatible` 路径虽有按提供商的 `streamOptions` 开关，但 Pi 网关注入从未读取该开关，且两条路径都不会自动恢复。

## 决策

`buildPiModelConfig` 仅对 `openai-completions` 将 `resolveEndpointDialect(provider, endpointType).streamOptions` 映射为 Pi 的 `compat.supportsUsageInStreaming`；Responses 及其他协议本来就不携带 `stream_options`。默认值保持 `true`（缺省即 `true`），在支持的服务上保留用量统计。

提供商执行层在 `resolveProviderAiSdkConfig` 中对聊天补全请求的最外层封装 fetch：当方言显式关闭时直接去掉 `stream_options` 单次发送；否则首次请求保留用量统计，仅在匹配的 400 错误后去掉该字段重试一次。重试仅匹配状态码 400 且正文同时提及 `stream_options`/`include_usage` 并带有错误信号的响应，只删除顶层字段，且最多重试一次。非聊天端点不封装。

## 考虑过的替代方案

- 仅保留手动开关：Pi agent 依然失败，且要求每个受影响用户自行发现提供商 API 选项。
- 将自定义提供商默认值改为 `false`：可避免 400，但会在支持该字段的服务上默默丢失用量统计。
- 成功重试后持久化 `streamOptions: false`：可避免每次多一次 400，但会静默修改用户配置；本次采用无状态重试，仅在显式关闭时提前省略。

## 影响

支持 `stream_options` 的服务在首次请求即保留用量上报。不兼容的服务在去掉字段后重试成功，显式关闭时单次请求即可成功。无条件发送该字段的 `openai` 系列聊天路径同样被上述封装覆盖。无正文或非 400 的拒绝仍直接返回，不做重试。

## 验证

- Regression — `src/main/ai/provider/__tests__/streamOptionsFallback.test.ts`：匹配的 400 会去掉字段重试一次；无关 400、缺少字段和非 400 直接透传；提前省略模式单次调用即去掉字段。
- Regression — `src/main/ai/provider/__tests__/config.test.ts`：DashScope 保持 `includeUsage:true` 且 fetch 已封装；`openai` 系列聊天已封装；显式 `streamOptions:false` 经一次 `net.fetch` 调用即省略字段；Responses 保持未封装。
- Regression — `src/main/ai/runtime/pi/modelInjection.test.ts`：`streamOptions:false` 映射为 `supportsUsageInStreaming:false` 且实际请求无 `stream_options`；true/缺省保持启用；非补全协议不设置该键。
