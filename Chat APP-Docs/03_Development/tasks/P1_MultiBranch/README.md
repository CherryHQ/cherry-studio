# P1 — Multi-Branch（多分支共存）

**前置**：T-006E source-passage highlight 已 closed（[[../T-006_TextAnchorBranchUI/T-006E_Highlight/README]]）。当前系统至多 1 个分支同开。

**目标**：把单分支 UX 推进到多分支共存 —— 用户可以同时打开多个 anchor，每个 anchor 在主对话上有自己的高亮 + 自己的 panel，可独立 collapse / close。

**子步骤拆分（用户给的，固定）**：

| 步骤 | 范围 | 行为变化 |
|---|---|---|
| **P1-S1 — State shape refactor** | 把 `branchAnchor + branchTopic` 双 useState 推广成 `branches: Branch[]` 数组形 state；BranchAnchorContext 改成 anchors 列表；MainTextBlock effect 改成 filter+迭代；BranchAssistantContext synthetic.topics 改成展开 branches.map | **零** —— `branches.length ≤ 1`，所有派生值与现网完全一致 |
| **P1-S2 — Multi-branch UI + multi-highlight** | 解除 length≤1 invariant；右键新选区不再 replace 而是 append；BranchPane 改成多栏 / tab；paintSourceHighlight 加 per-branch span 区分（`data-branch-id`）让多个 anchor 可共存不互擦；为每个 branch 分配区分色（amber / cyan / violet 等） | 有 —— 用户能开第 2、第 N 个分支 |
| **P1-S3 — Branch disposition** | 关闭路径分裂：弃用（discard，DELETE topic）vs 保存（save，留 SQLite + 可重开）；UI 给关闭按钮加二级菜单或确认 | 有 —— 关闭语义不再单一 |

**S1 是 P1 最高风险的状态迁移**，所以单独隔离：零行为变化、纯 shape、length 仍 ≤ 1，先把数据结构变成 N 准备好的样子；S2 才解约束 + 加 UI；S3 才加 disposition。这种顺序让每一步都可独立 verify + revert。

## 子任务

- [[P1-S1_StateFoundation/README|P1-S1 State Foundation]] ✅ 2026-06-01（commit 待 push）
- P1-S2 Multi-branch UI（未开始）
- P1-S3 Disposition（未开始）

## 触碰边界（整个 P1 都遵守）

- **不动**：`sourceHighlight.ts` 的 `paintSourceHighlight` / `clearSourceHighlight` / `wrapRangeWithSpans` / `captureSelectionOffsets` / `resolveBranchHighlightRange`（S2 才会扩 paint 的 span 标识能力；S1 + 当前都通过 length ≤ 1 invariant 绕开）
- **不动**：`__BRANCH_ANCHOR_CTX_CACHE__` HMR 缓存模式（D-013-FIX 根因防御）
- **不动**：fork / streaming / provider / model picker / Redux / Dexie

## 关键 invariant

- **S1 invariant**：`branches.length ≤ 1`，且对应 BranchAnchorContext.anchors.length ≤ 1。`MainTextBlock.tsx` 的 effect 注释明文写了「S2 才解此约束」。
- 任何超过 length 1 的 anchors 在 S1 下都会撞上 `paintSourceHighlight` 的 doc-wide clear 副作用 —— 这是 S2 的核心改造点，不要提前触发。
