# Agent Note: DashScope thinking-budget 上限与降级重试

Status: implemented

[English](2026-11-06-dashscope-thinking-budget-ceilings.md) | 中文

## 问题

访问 Bailian/QwenCloud Qwen3.5/Qwen3.6 模型的对话轮次直接失败，错误为 `400 InternalError.Algo.InvalidParameter: The thinking_budget parameter must be a positive integer and not greater than {81920 | 131072 | 0}`。客户端仅依据模型描述中的 `thinkingTokenLimits` 推导 `thinking_budget`，没有任何服务端上限约束；即使对完全不支持该参数的 SKU（如 `qwen3.5-ocr`）也会发送该参数；失败时不会就地重试；展示给用户的也只有服务商原始参数文本，没有指出涉及的推理设置。

## 决策

- Wire 预算策略新增可选 `max`；`qwenChatWire` 上限 81920，新增的 `qwenChatWire128k` 上限 131072，通过共用的 `isQwen128kChatModel` 前缀匹配（含日期快照版本）在 `dashscope` 与 `qwencloud` 上按 SKU 映射。`resolveModeBudget` 按 `min(policy.max, thinkingTokenLimits.max)` 钳制。
- Alibaba 推理族声明 qwen3.6-plus/flash/max-preview 的预算为 131072；OCR SKU（`-ocr(?:-|$)`）从词汇、成员资格、预算规则中全部排除，不再解析出任何推理描述。
- ai-retry 降级项（链首）对同一模型重试一次：钳制所有 `thinking_budget` 到报错中的上限，或在上限为 0 时去掉预算并保留 `enable_thinking`。无法解析的上限、已合规的预算、无预算的尝试均不重试。该项受重试开关控制，关闭重试时（如费用控制）不会产生额外的计费调用。
- 序列化聊天错误与 API 网关错误包追加可操作的提示，指明推理设置；`RetryError` 包装后表面信息为通用文本时同样生效。

## 备选方案

- 使用按模型的 `support` 覆盖代替 wire `max`：效果相同但改动面更宽，且对缺失或超出 Bailian 接受范围的描述没有兜底。
- 任何拒绝都直接去掉预算：会在无法解析时静默关闭思考；改为优先钳制、仅在上限为 0 时去掉。
- 降级独立于重试开关运行：关闭重试的用户（如费用控制）不应收到额外计费调用；否决。

## 影响

- 描述推导的预算不再超出 SKU 上限；自定义或覆盖传入的预算若仍失败，最多获得一次降级重试，否则展示可操作的错误。
- 陈旧的已持久化 OCR 模型行保留旧描述直到重新解析；由降级重试与提示覆盖。
- 再生成的目录包含当日无关族的上游漂移；25 个新上游 ID 的成员资格缺口失败属于目录日常维护，不属于本次修复。

## 验证

- 回归 — `src/shared/ai/__tests__/thinkingBudget.test.ts`：匹配器、上限解析、钳制/去掉变换、提示。
- 回归 — `src/main/ai/runtime/aiSdk/retry/__tests__/thinkingBudgetDegrade.test.ts`：钳制重试、零上限去掉、无法解析/无变化/无预算的保护。
- 回归 — `src/main/ai/utils/__tests__/reasoningSerializers.test.ts`：超宽描述钳制、较窄描述保留。
- 回归 — `src/main/ai/utils/__tests__/serializeError.test.ts` 与 `src/main/features/apiGateway/__tests__/errors.http.test.ts`：直接与 `RetryError` 包装拒绝的提示。
- 回归 — `packages/provider-registry/src/__tests__/provider-reasoning-contracts.test.ts`：按 SKU 的 128K/81920 wire 上限、前缀匹配器；`reasoningMembership.test.ts`：OCR 排除。
- 回归 — `pnpm typecheck:node`、`pnpm typecheck:web`、`pnpm exec oxlint --deny-warnings`、`pnpm exec oxfmt --check`、provider-registry `compat:check`。
