# Agent Note：基于主题的话题分组

状态：proposed

[English](2026-11-19-topic-subject-groups.md) | 中文

## 问题

话题目前只能按时间或助手浏览。助手是最近使用的配置，而不是对话的主题，因此一个“学习”助手会覆盖英语、Python、健身等互不相关的主题。议题 CherryHQ/cherry-studio#18237 要求提供独立于助手、由用户创建的主题分组。

## 提案

在 `topic` 表新增可空列 `group_id`，引用共享的 `group` 表（`entityType: 'topic'`，`ON DELETE SET NULL`）。一个话题最多属于一个主题分组。侧边栏在 `time` 和 `assistant` 之外新增 `subject` 显示模式。

- 成员关系通过现有的 `PATCH /topics/:id`（`groupId`）写入，并按 `entityType: 'topic'` 校验。
- 删除分组会取消其话题的分组，话题本身不会被删除。
- 话题在前端基于现有话题列表分组，不新增列表接口。
- 分组通过话题的“移至分组”子菜单创建，通过分组标题菜单重命名或删除，均使用现有的 `/groups` 接口。
- 主题模式下不支持跨分组拖拽；组内排序仍沿用全局 `orderKey`。

## 考虑过的替代方案

- 复用 `entity_tag`（话题标签）：多对多，适合跨多个主题的话题，但需要基于标签的分组和标签 UI。本轮未采用，因为议题要求的是有名称、可排序的主题分组。
- 独立的话题分组表：与 `group` 抽象重复，已拒绝。

## 影响

- 新增一次增量迁移（`0042`）。Drizzle 生成的 `ALTER TABLE` 丢失了 `ON DELETE SET NULL`，因此手动将 SQL 修正为 `REFERENCES \`group\`(\`id\`) ON DELETE set null`。
- 一个话题只属于一个主题；多主题归属留待基于标签的后续工作。
- 渲染进程的 `Topic` 类型与映射已携带 `groupId`。

## 验收标准

- AC1 — 用户可以创建、重命名、排序和删除话题分组（验证：实现）
- AC2 — 话题可以分配到分组并在分组之间移动（验证：实现）
- AC3 — 成员关系在重启及备份恢复后保持不变（验证：实现）
- AC4 — 分组与话题的助手无关（验证：实现）
- AC5 — 未分组的话题显示在“未分组”区域（验证：实现）
- AC6 — 删除分组不会删除其话题（验证：实现）
- AC7 — 话题侧边栏在时间和助手之外提供主题显示模式（验证：实现）

分组排序（AC1）不在当前实现中，属于待办事项。

## 风险

- 分组排序（AC1）尚未实现；在缺少该能力的情况下交付会留下验收缺口。
- 手工修正的迁移 SQL（`ON DELETE SET NULL`）在重新生成时可能与 Drizzle 生成的 DDL 产生偏差。
- 每个话题仅属一个分组可能不适合多主题对话；若迁移到基于标签的成员关系，需要进行数据迁移。

## 验证

- `drizzle-kit check`：通过。
- `vitest run` `TopicService.test.ts`、`GroupService.test.ts`、`topics.test.ts`：149 个测试通过，包括分组校验及删除分组时的外键取消分组（AC2、AC6）。
- `vitest run` `topicsHelpers.test.ts`、`topicContextMenuActions.test.tsx`、`Topics.test.tsx`、`ConversationListOptionsMenu.test.tsx`、`useTopic.test.ts`：通过（AC4、AC5、AC7）。
- `tsrs --noEmit -p tsconfig.web.json`：通过。
- 尚未验证：分组排序（AC1）、备份恢复往返（AC3）、以及侧边栏的 Electron 实际操作。

## 待办

- Spec 审批：实现先于 `APPROVED` 审核编写，在获得批准前为草稿。
- 分组排序（AC1）与备份恢复（AC3）的验证。
