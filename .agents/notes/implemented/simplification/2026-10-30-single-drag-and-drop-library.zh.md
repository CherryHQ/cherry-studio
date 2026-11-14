# Agent Note: 只保留 dnd-kit 一套拖拽库

Status: implemented

[English](2026-10-30-single-drag-and-drop-library.md) | 中文

## 问题

渲染进程同时带着两套拖拽库。`@dnd-kit/*` 支撑 `Sortable`、`ReorderableList`、树视图和分组虚拟列表。`@hello-pangea/dnd` 只剩划词助手功能设置（四个文件）和 `@cherrystudio/ui` 的 `DraggableList`（476 行）在用，而应用代码没有引用 `DraggableList`，只有它的 Storybook story 在用。第二套库还把 `redux`、`react-redux`、`css-box-model` 和 `raf-schd` 带进了依赖图；数据层文档里的 `<DraggableList items onReorder>` 写法也与任何真实 API 都对不上。

## 决策

移除 `@hello-pangea/dnd` 和 `DraggableList`。划词助手功能列表改为一个 `ReorderableList`，行序列为 `[...enabled, ACTIONS_DIVIDER, ...disabled]`。分隔条是一个哨兵行：它渲染 `ActionsListDivider`，由 `isItemDragDisabled` 禁止拖动，但它仍是可排序的放置目标。`actionItemsFromRows` 按每行位于分隔条的哪一侧推导 `enabled`，并把超出 `MAX_ENABLED_ITEMS`（8）的启用行移到禁用列表末尾。`isItemDragDisabled` 同样禁止拖动最后一个启用项，保留“至少启用一个功能”的规则。该列表运行在 [让 Sortable 基于 @dnd-kit/react](../architecture/2026-10-30-sortable-on-dnd-kit-react.md) 所述的 `Sortable` 上。数据层示例改为展示 `ReorderableList`。

## 考虑过的替代方案

- 在一个 `DndContext` 下放两个 `SortableContext`，用 `onDragOver` 在容器间移动条目（dnd-kit 的多容器模式）：不采用，因为 `Sortable` 自带 `DndContext`，为保留两个视觉框，页面要手写约一百行 dnd-kit 接线。
- 复用 `GroupedSortableVirtualList`：不采用；1346 行的分组虚拟列表用于十来行数据过重。
- 给 `@cherrystudio/ui` 的 `Sortable` 增加多容器支持：不采用；只有一个使用者，不足以支撑新的共享 API。

## 后果

启用与禁用的功能现在位于同一个列表中，由一行分隔条隔开，而不是两个框。把功能从上方拖到分隔条上会禁用它，从下方拖到分隔条上会启用它。拖拽反馈改用 dnd-kit 的浮层和残影，不再是 hello-pangea 的占位；屏幕阅读器播报回落到 dnd-kit 的英文默认值，与 hello-pangea 原先一样。`@cherrystudio/ui` 不再导出 `DraggableList` 和 `useDraggableReorder`。

## 验证

- Regression — `pnpm test:renderer src/renderer/pages/settings/SelectionAssistantSettings/hooks/__tests__/useSettingsActionsList.test.ts`：越过分隔条会改写 `enabled`，两个方向拖到分隔条上都生效，启用超过 8 个时多出的移到禁用列表末尾。
- Electron 探针 — 在开发构建中通过 CDP 操作“设置 → 划词助手”：列表内排序、启用↔禁用互拖、两个方向拖到分隔条、分隔条与最后一个启用项不可拖、编辑按钮、键盘排序均符合上述描述，并写入 `feature.selection.action_items`。
