# Agent Note: 自定义渠道模型元数据发现

Status: proposed

[English](2026-11-14-custom-channel-model-metadata.md) | 中文

## Problem

Issue CherryHQ/cherry-studio#20523 报告：从自定义 OpenAI 兼容渠道导入的模型会丢失上下文窗口和能力元数据。用户只能逐个手动编辑模型，而缺失的上限会静默截断上传的文件。

在当前代码中已验证：

- 通用抓取器 `listOpenAICompatibleModels`（`src/main/ai/provider/listModels.ts:989-1009`）只读取 `id`、`name` 和 `owned_by`。`OpenAIModelSchema`（`src/main/ai/provider/listModelsSchemas.ts:11-16`）不解析任何上限或能力字段。
- 其他抓取器已将上游上限映射到 `contextWindow` / `maxOutputTokens`（`listModels.ts:685`、`:1127-1128`、`:1185`）。通用路径没有。
- 没有注册表匹配的模型由 `createCustomModel`（`src/main/data/services/ProviderRegistryService.ts:418-437`）创建，`contextWindow` 为空，`capabilities` 为空数组。
- 渲染进程的增强逻辑（`src/renderer/pages/settings/ProviderSettings/utils/modelSync.ts:86-140`）只叠加注册表数据，无法恢复主进程未返回的上限。

Issue 中报告的约 10,000 token 默认值未在代码中找到，本文不作此主张。

## Proposal

1. 扩展通用 OpenAI 兼容抓取器，读取其他抓取器已使用的同一组上限字段（`context_length`、`max_context_window`、`max_context_length`、`max_tokens`），在存在且为正数时映射到 `contextWindow` 和 `maxOutputTokens`。
2. 仅从提供商明确给出的元数据设置能力。绝不根据模型名称推断工具、联网搜索或图像输入。
3. 字段缺失、格式错误或相互矛盾时保留现有值，并通过 `loggerService` 输出不阻塞的警告。模型仍保持可列出。不引入新的硬编码上下文默认值。
4. 为已存在的自定义渠道模型提供明确、由用户触发的"从提供商刷新元数据"操作。该操作为可选，绝不在列表刷新时自动运行。
5. 发现流程绝不覆盖用户设置的值。提供按字段"恢复为提供商值"的操作。
6. 在模型设置中显示每个上限的来源（提供商、注册表、用户、未知）。

## Alternatives considered

- 每次模型列表刷新时自动刷新：本 Spec 中拒绝。它可能在用户未明确操作时覆盖其依赖的值。仅在可选路径有使用数据后再考虑。
- 未报告窗口时使用有文档记录的保守常量：本 Spec 中拒绝。维护者决定保留现有值并发出警告。常量仍会对未提供该字段的提供商静默截断。
- 根据模型名称推断能力：拒绝。Issue 明确禁止，且会产生错误的工具和图像请求。
- 修改内置提供商抓取器：超出范围。这些路径已经读取元数据。

## Acceptance criteria

- AC1 — 自定义 OpenAI 兼容 `/models` 响应包含 `context_length` 和 `max_tokens` 时，列出的模型获得 `contextWindow` 和 `maxOutputTokens`（verification: unit，`src/main/ai/provider/__tests__/listModels.test.ts`）。
- AC2 — 响应不含上限字段时，模型仍被列出，且不设置 `contextWindow`，也不报错（verification: unit）。
- AC3 — 格式错误或非正数的上限值被忽略，模型仍被列出，并记录警告（verification: unit）。
- AC4 — 仅当提供商元数据明确给出时才设置能力标志；仅凭名称像视觉或工具模型的模型，在无元数据时能力为空（verification: unit）。
- AC5 — 可选刷新操作只更新当前来源为提供商或未知的字段，保留用户设置的字段（verification: unit，服务层 `ModelService` 测试）。
- AC6 — 按字段恢复只还原该字段的提供商值（verification: renderer，模型设置测试）。
- AC7 — 发现和列表刷新绝不自动触发刷新操作（verification: unit）。
- AC8 — 模型设置中每个上限显示其来源（verification: renderer）。

## Risks

- 提供商的字段名或单位不一致。缓解措施：仅使用 `listModels.ts` 中其他位置已接受的字段名，其余忽略。
- 持久化提供商上限可能与用户后续编辑冲突。缓解措施：按字段记录来源，并满足 AC5。
- 新增 `source` 列需要迁移。缓解措施：追加生成的迁移，绝不修改已发布的迁移。
