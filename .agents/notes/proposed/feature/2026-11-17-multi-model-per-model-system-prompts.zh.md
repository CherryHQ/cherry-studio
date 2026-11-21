# Agent Note：多模型轮次中的按模型系统提示词

Status: proposed

[English](2026-11-17-multi-model-per-model-system-prompts.md) | 中文

Tracks: CherryHQ/cherry-studio#18321

## Problem

多模型轮次会扇出到多个模型。提及列表为 `mentionedModelIds: UniqueModelId[]`（`src/shared/ai/transport/stream.ts:194`），由 `resolveModels`（`src/main/ai/streamManager/context/modelResolution.ts`）解析。每个分支的系统提示词仍然取自话题唯一的助手（`src/main/ai/runtime/aiSdk/params/assembleSystemPrompt.ts:38`）。用户无法在一轮中比较模型与提示词的组合，已保存的回复也无法说明它使用了哪个提示词。

## Proposal

1. **每个提及可选携带提示词。** 提及条目变为 `{ modelId, systemPrompt? }`。裸 `UniqueModelId` 继续接受，以保证现有调用方和已持久化的轮次正常工作。`systemPrompt` 缺失或为空时，使用话题助手的提示词。
2. **按分支解析提示词。** 在构建每个模型的请求之前，为该模型解析系统提示词。某个分支的覆盖内容不会被其他分支读取。
3. **在回复上记录实际使用的提示词。** 每个助手占位消息在其轮次选项中保存实际使用的提示词文本。重新生成和编辑后重发复用该记录值，不再读取当前助手的提示词。
4. **界面归属。** 每条回复显示其模型。若使用了覆盖提示词，还显示提示词的简短标签，展开后可查看完整文本。
5. **模板变量。** 覆盖提示词与助手提示词经过相同的 `replacePromptVariables` 路径。

范围外：提及助手（议题中的第二种形式，与 #15396 有重叠）、改变助手提示词语义，以及新的提示词预设存储。

## Alternatives considered

- **改为提及助手而非模型。** 概念上清晰，因为助手本身已将模型与提示词配对。本 Spec 不采用：它会把改动扩大到助手/智能体统一（#15396），并改变所有地方提及的含义。
- **把提示词差异放进用户消息。** 议题已否决：它无法承载 system 角色的优先级，还会污染用户可见的记录。
- **每个提示词使用独立话题。** 维持现状，但失去促成多模型轮次的并排比较。
- **重新生成时从当前助手重新计算提示词。** 不采用：用户编辑助手后，配对会悄悄改变，破坏比较。

## Acceptance criteria

- AC1 — 一轮中有两个或以上提及且各自 `systemPrompt` 不同时，每个分支的请求都带有各自的提示词（verification: unit）
- AC2 — 未设置 `systemPrompt` 的提及，发送的是话题助手的提示词，与当前行为一致（verification: unit）
- AC3 — 任一分支的覆盖内容都不会出现在其他被选模型的请求中（verification: unit）
- AC4 — 重新生成和编辑后重发使用原回复上记录的提示词，包括回退到话题助手提示词的回复，而非当前助手的提示词（verification: unit）
- AC5 — 重新加载历史后，每条助手回复都显示其模型；若使用了覆盖提示词，还显示提示词标签（verification: renderer）
- AC6 — 裸 `UniqueModelId` 提及的分发行为与之前完全一致（verification: unit）
- AC7 — 覆盖提示词中的模板变量，解析方式与助手提示词相同（verification: unit）

## Risks

- 持久化的提示词文本会增大消息体积。缓解：实现时限制所保存提示词的长度。每条助手回复都记录其实际使用的提示词，包括回退到话题助手提示词的回复，确保重新生成和编辑后重发不会重新读取已变更的助手提示词。
- 使用覆盖的分支提示词前缀不同，可能降低服务商的提示词缓存命中率。缓解：仅当测量显示确有成本时，才在界面文案中说明。
- 未验证：按分支构建请求，能否与请求路径上唯一的助手查找完全解耦 - 即聊天路径上的请求构建 `buildAgentParamsFor`（`src/main/ai/AiService.ts:1620`）与按模型解析的 `getProviderAndModel`（`src/main/ai/AiService.ts:1669`）。实现前必须确认，Spec 才能获批。
