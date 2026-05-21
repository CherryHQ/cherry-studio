# T-006 Text Anchor Branch UI 原型

**日期**：2026-05-20 深夜起 →
**阶段**：Phase 3 / Expand Branch UI 原型
**状态**：🧠 设计完成；🔧 实施分 6 个子任务

## 一句话

让用户在 AI 回复中**选中某段文字 → 右键 → 「展开为分支 / 针对此处提问」**，并在原文留下临时高亮锚点；点击锚点可重开 Branch Panel。**文本级**而非消息级（v1 NEW_BRANCH 是消息级，T-006 是更细粒度）。

## 文件

- [任务.md](./任务.md) — 任务 brief
- [设计.md](./设计.md) — 主设计文档（捕获点 / 菜单 / Panel / 高亮 + 关键决策 rationale）
- [拆解.md](./拆解.md) — 6 个子任务的依赖图 + 验收标准

## 子任务

| ID | 主题 | 状态 | 入口 |
|---|---|---|---|
| T-006A | 测试数据准备（mock 数据 / fixture） | ⏳ | [T-006A_TestData/](./T-006A_TestData/) |
| T-006B | 文本选中捕获（block/message 上下文） | ✅ 已 commit `d579fdcf2` | [T-006B_TextSelection/](./T-006B_TextSelection/) |
| T-006C | 扩展 SelectionContextMenu（加分支菜单项 + role 收口） | ✅ 代码完成 + 自动化校验过；⏳ staged 未 commit | [T-006C_Menu/](./T-006C_Menu/) |
| T-006D | Branch Panel 组件（拆为 D-1/D-2/D-3） | 🔧 D-1 ✅ staged 未 commit；D-2 / D-3 ⏳ | [T-006D_BranchPanel/](./T-006D_BranchPanel/) |
| T-006E | 高亮标注（临时 UI，DOM 注入 `<mark>`） | ⏳ | [T-006E_Highlight/](./T-006E_Highlight/) |
| T-006F | 折叠/展开交互（scope 未承诺，可能 v1.1） | ⏳ | [T-006F_FoldExpand/](./T-006F_FoldExpand/) |

## 与既有代码的关系

| 复用 | 文件 |
|---|---|
| ✅ **`SelectionContextMenu`** 已存在并包裹整个消息流 | `src/renderer/src/components/SelectionContextMenu.tsx`，被 `Messages.tsx:320` 使用 |
| ✅ DataApi `POST /topics` 已支持 fork（`sourceNodeId`） | `packages/shared/data/api/schemas/topics.ts`、[../../../02_Architecture/DataApi端点.md](../../../02_Architecture/DataApi端点.md) §1.1 |
| ✅ `useCache` 适合临时 anchor 状态 | `src/renderer/src/data/hooks/useCache.ts` |
| ❌ 高亮持久化的 schema（第一版不持久化） | — |

## 与 v1 NEW_BRANCH 的关系

v1 `NEW_BRANCH` 事件以**整条消息**为锚切新 topic（`MessageMenubar.tsx:234`）。T-006 是**文本级**锚点（一句话、一段文字）。两者不冲突；T-006 是新维度。

## 关联

- 不阻塞于 D-001 / D-002（baseline）—— Phase 3 可以并行
- 不阻塞于 D-003（Ollama）—— 测试可绕开 Ollama
- 关键事实：当前主分支无 v2 `SiblingNavigator` / 新 `MessageGroup`，那些是 `DeJeune/ai-service` 分支的工作（见 [../../../02_Architecture/分支对话.md](../../../02_Architecture/分支对话.md)）；T-006 是**与 sibling 导航并行**的新维度，不依赖它。
