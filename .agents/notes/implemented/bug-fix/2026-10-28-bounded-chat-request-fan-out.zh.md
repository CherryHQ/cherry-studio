# Agent Note: 单次调用请求数量无上限

Status: implemented

[English](2026-10-28-bounded-chat-request-fan-out.md) | 中文

## 问题

[#22572](https://github.com/CherryHQ/cherry-studio/issues/22572) 报告在半小时的普通使用中产生了约 200 美元的 API 费用，但没有给出复现步骤。这份报告无法归因到某一条代码路径；在排查生成请求的路径时，发现有三处会把一次用户操作放大，而且用户看不到任何上限：

- 关闭助手的“最大工具调用轮数”时，步骤上限被设为 `DEFAULT_ASSISTANT_SETTINGS.maxToolCalls`（100），也就是普通设置里的最大值，而不是取消更小的上限或退回 SDK 默认的 20。工具循环是单条消息最大的放大因素，所以“关闭”实际上等于“最贵的选项”。
- `createAiRepair` 发起后续修复调用时没有传 `maxRetries`，于是继承了 AI SDK 默认的 2。一个格式错误的工具调用因此可能消耗三次请求，而且发生在循环的每一步里，既不受重试偏好约束，也不受请求自身 `maxRetries: 0` 的约束。
- `chat.retry.fallback_model_ids` 没有长度限制，因此配置 N 个模型就会在每次调用失败时增加 N 次计费尝试，设置界面的选择器也允许列表无限增长。

## 决策

每个放大因素都在其归属处获得明确上限：

- 当 `enableMaxToolCalls` 为 false 时，`resolveToolCallLimit` 返回 SDK 默认步数（20）。只有在助手显式开启上限并给出有效的 `maxToolCalls` 时，才使用配置的最大值。
- 工具调用修复请求传入 `maxRetries: 0`，与 `AiService` 中其他所有旁路请求（`generateImage`、`embedMany`、`rerank`、`checkModel`）保持一致。
- `MAX_RETRY_FALLBACK_MODELS` 放在 `@shared/ai/retry`：`readRetryPolicy` 把存储的列表截断到该上限，设置界面的选择器也不再接受更多选择，因此两层不会出现分歧。

## 考虑过的替代方案

- 关闭上限时彻底移除步骤上限：不采用，因为 `stepCountIs` 是唯一能终止工具循环的机制；没有上限就意味着无限循环。
- 增加按会话或按期限的花费预算：这是对报告者最有帮助的方案，但它是一个横跨模型定价数据、用量视图和新偏好的产品决策，不是缺陷修复，需要单独提案。
- 对 API key 失败切换也施加同等的数量上限：不采用，因为密钥轮换正是多密钥供应商从 401/429 中恢复的手段，每个密钥按设计只尝试一次。它在密钥数量上仍然无上限，这一点记录在 `docs/references/ai/model-retry.md`。
- 限制 `maxToolCalls` 的配置上限（`MAX_TOOL_CALLS = 1000`）：不采用，因为那是用户在助手上显式、可见的选择，与上面三处情况不同。

## 后果

关闭工具调用上限的助手现在会在 20 步后停止，而不是 100 步，并报告既有的 `tool_call_limit_reached` 错误。依赖“关闭”来完成真正长任务的用户需要开启上限并自行设置所需的值。修复请求不会再自动重试；失败的修复与之前一样以未修复状态返回。只会尝试前五个配置的备用模型，设置界面也不再接受第六个。以上改动都不影响流式行为、密钥失败切换或 `chat.retry.*` 的默认值。

Claude Agent SDK 运行时仍然既不设置 `maxTurns` 也不设置 `maxBudgetUsd`，因此由该运行时驱动的智能体会话依然没有上限。这是一个独立的、更大的决策。

## 验证

- Regression — `pnpm test:main src/main/ai/runtime/aiSdk/params/__tests__/buildAgentParams.test.ts`：关闭上限的请求解析为 20，而不是配置的最大值。回退该解析器会让此测试失败。
- Regression — `pnpm test:main src/main/ai/tools/adapters/aiSdk/__tests__/repair.test.ts`：修复调用以 `maxRetries: 0` 发出。回退该参数会让此测试失败。
- Regression — `pnpm test:main src/main/ai/runtime/aiSdk/retry/__tests__/retryPolicy.test.ts`：九个模型的备用列表会被截断。回退 `readRetryPolicy` 会让此测试失败。
- Regression — `pnpm test:main src/main/ai/runtime/aiSdk/retry/__tests__ src/main/ai/tools/adapters/aiSdk/__tests__/repair.test.ts src/main/ai/runtime/aiSdk/params/__tests__/buildAgentParams.test.ts`：8 个文件共 192 项测试通过，覆盖密钥失败切换、备用模型顺序和重试事件。
