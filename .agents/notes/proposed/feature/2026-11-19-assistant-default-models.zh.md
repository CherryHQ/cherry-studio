# Agent Note：每个助手支持多个默认模型

Status: proposed

[English](2026-11-19-assistant-default-models.md) | 中文

## Problem

Issue [#12880](https://github.com/CherryHQ/cherry-studio/issues/12880) 反馈：助手只能预设一个默认模型。需要对比或交叉验证回答的用户，每次新建话题都要手动重新添加其他模型。当前数据模型只存一个 `assistant.modelId`，多模型选择仅作为输入框的草稿状态存在。

## Proposal

- 在新列 `assistant.additional_model_ids`（JSON）中保存额外的默认模型。有效默认列表为 `[modelId, ...additionalModelIds]`，并去重，因此主模型不会产生重复状态。
- 把派生出的列表暴露为 `Assistant.defaultModelIds`。创建和更新 DTO 接受 `defaultModelIds`；传入列表会整体替换默认集合，并把 `modelId` 设为第一项。只更新 `modelId` 时，原主模型保留为额外默认项。
- 助手编辑器在单选模型字段旁增加多选。更改主模型时，新模型排在首位，原主模型保留为额外默认项。
- 当输入框进入一个默认模型超过一个的话题或助手作用域，且该话题没有已保存的多模型选择时，会用全部默认模型填充选择器和提及模型，并进入多选模式。
- 复制助手时复制完整的默认列表。

### 归属

共享的 `Assistant` schema 负责公开结构。`AssistantService` 负责校验，并负责 `modelId` 与额外列之间的拆分。输入框负责运行时选择；助手只保存默认值。

## Alternatives considered

- **连接表 `assistant_models(assistant_id, model_id, position)`。** 能按模型保证引用完整性，但对一个很短的有序列表而言，要增加表、连接同步和更多代码。第一版拒绝，因为该列表很小，并且总是随助手一起读取。
- **存储包含 `modelId` 的完整列表。** 读取更简单，但会重复主模型，并产生两个事实来源。选择由第一项派生，以避免这一点。
- **复用已保存的输入框草稿作为助手默认值。** 无需迁移，但草稿按话题保存，且会被用户清空。默认值必须在新话题中保留，因此拒绝。

## Acceptance criteria

- AC1 — 助手能往返保存一个有序默认列表，且第一项为其 `modelId`（verification: unit）
- AC2 — 默认列表中未注册的模型 ID 校验失败，且不写入任何内容（verification: unit）
- AC3 — 复制助手时复制其完整默认列表（verification: unit）
- AC4 — 进入新话题或切换助手时，若默认模型超过一个，输入框会用全部默认模型填充（verification: renderer）
- AC5 — 在助手编辑器中修改默认列表，会通过更新 API 持久化（verification: renderer）
- AC6 — 数据库迁移可应用于已有数据的数据库，且不改写既有迁移（verification: docs gate）

## Risks

- 用户把选择减为单一模型的话题没有已保存的多模型草稿，因此重新打开时会重新填充默认值。修复需要一个持久化的“用户已选择该组合”标记，超出本 Spec 范围。
- 删除默认模型时，现有外键会把 `modelId` 置为 null，但存在 JSON 中的额外 ID 不会级联清理。输入框会在解析模型目录时过滤掉失效的额外 ID。
