# Agent Note: 保留聊天回退协议中 Off 的语义

Status: implemented

[English](2026-11-12-reasoning-off-chat-fallback.md) | 中文

## Problem

Sonnet 5.5 使用 `adaptive-between-tools`：原生 Off 表示 `thinking.type: 'between_tools'`，是最低档位而非禁用推理。通用聊天回退协议却将 Off 转换为 `reasoningEffort: 'none'`。要求启用推理的端点会拒绝该禁用参数并返回 HTTP 400（#24260）。

## Decision

`resolveReasoningProfileFromRegistry` 仅为 `adaptive-between-tools` 移除最终回退的 `openai-chat` 协议中的 `off`。显式配置的 `contract.wire` 和 `format.wire` 保留优先级。原生 Anthropic 保留 `between_tools`；Responses、Ollama、Gemini、budget、effort 和 adaptive-always 的行为保持不变。不修改源协议对象；已无 Off 的协议保留对象身份。

运行时投影排除 `none`，同时保留显式档位。已保存的 `none` 选择不生成任何自动推理参数，由端点默认行为决定结果。这不保证某种服务端默认行为或真实请求一定成功。

## Alternatives considered

- 将 Off 限制为最低档位：模型声明的最低档位并不能确定端点接受的档位，而且会引入新的推理强度策略。
- 在所有格式中移除 Off：Responses、Ollama 和 Gemini 各有受支持的 Off 映射；此次聊天故障不足以支持移除它们。

## Consequences

#16903 针对 OpenAI 兼容 Claude 提出的显式禁用请求不再适用于此系列的聊天端点，包括原本接受禁用的端点。显式配置的协议仍可声明 Off。目录支持的 ID，以及通过 `apiModelId` 恢复方言的自定义行，均应用此策略；真正未命中 ID 模式的模型保留通用行为。#23615 的提供商元数据回退和 #12088 的故障分类仍分别处理。

## Verification

- AC1 — `node node_modules/vitest/vitest.mjs run --project main src/main/data/services/__tests__/ProviderRegistryService.test.ts`：自定义 ID 的选项、参数省略、原生、budget、GPT 与显式协议契约；实现前已保存 RED 证据。
- AC2 — `node node_modules/vitest/vitest.mjs run --project main src/main/ai/runtime/aiSdk/params/__tests__/buildAgentParams.test.ts`：捕获的 SDK 请求体在已保存值为 `none` 时省略 `reasoning_effort`，保留模型和消息，并能发送显式 `high`；实现前已保存 RED 证据。
- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/ai/utils/__tests__/reasoningSerializers.test.ts`：序列化器契约。
- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/features/apiGateway/adapters/__tests__/providerOptionsMapper.test.ts`：网关契约。
- Regression — `node node_modules/vitest/vitest.mjs run --project provider-registry`：包契约保持不变。
- Regression — `pnpm docs:check`：本记录的链接、格式与双语配对检查（本分支已通过）。
