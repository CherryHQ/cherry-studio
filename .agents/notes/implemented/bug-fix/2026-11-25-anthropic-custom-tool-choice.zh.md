# Agent Note: 逐次应用 Anthropic 自定义工具选择

Status: implemented

[English](2026-11-25-anthropic-custom-tool-choice.md) | 中文

## 问题

助手设置里的旧版 `tool_choice` 字符串可能作为原始 JSON 字段进入 Anthropic Messages 请求，并被 Anthropic 兼容提供商拒绝。将这个字段提升为整轮请求的 SDK 选项时，转换由主模型决定。跨模型回退沿用该选项，因此切入 Anthropic 时可能丢失转换，切出 Anthropic 时又可能把转换结果带过去。

## 决策

在保存原始请求体参数前取出可识别的字符串。通过 AI SDK 中间件将这个默认值绑定到 Anthropic Messages 模型。中间件读取当前步骤的工具和显式选择，再由 SDK 序列化最终选项。

## 考虑过的方案

在 fetch 中转换原始 JSON 会重复实现 SDK 的工具处理逻辑。通过回退调用选项传值仍需区分助手默认值和步骤选择，而且重试库没有提供工具选择的覆盖接口。

## 影响

每次调用 Anthropic 时，仅当有可用工具且调用方和步骤均未指定选择，才应用默认值。仓库的 AI SDK 补丁将省略的选择保留为 `undefined`，因此显式 `auto` 可以优先。Anthropic 原生对象值仍通过请求体透传。

## 验证

- Regression — `pnpm test:main src/main/ai/runtime/aiSdk/params/__tests__/buildAgentParams.test.ts`: 捕获流式、调用与步骤覆盖、无工具请求，以及 Anthropic Messages 和 OpenAI Chat Completions 双向回退的序列化 JSON。
