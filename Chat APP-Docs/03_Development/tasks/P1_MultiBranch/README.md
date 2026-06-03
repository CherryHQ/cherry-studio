# P1 — Multi-Branch（多分支共存）

**前置**：T-006E source-passage highlight 已 closed（[[../T-006_TextAnchorBranchUI/T-006E_Highlight/README]]）。当前系统至多 1 个分支同开。

**目标**：把单分支 UX 推进到多分支共存 —— 用户可以同时打开多个 anchor，每个 anchor 在主对话上有自己的高亮 + 自己的 panel，可独立 collapse / close。

**子步骤拆分（用户给的，固定）**：

| 步骤 | 范围 | 行为变化 |
|---|---|---|
| **P1-S1 — State shape refactor** | 把 `branchAnchor + branchTopic` 双 useState 推广成 `branches: Branch[]` 数组形 state；BranchAnchorContext 改成 anchors 列表；MainTextBlock effect 改成 filter+迭代；BranchAssistantContext synthetic.topics 改成展开 branches.map | **零** —— `branches.length ≤ 1`，所有派生值与现网完全一致 |
| **P1-S2a — Highlight implementation** | sourceHighlight.ts 加 `data-branch-id` + `data-hl` stamping；`clearSourceHighlight(branchId)` 按 id targeted；`paintSourceHighlight` 加 `(branchId, colorKey)` 参数；6 色调色板；MainTextBlock effect / Chat.tsx close path 改 targeted clear；测试用双 branchId 直接构造 DOM fixture 验证多分支隔离 | **零（用户视角）** —— UI 仍 ≤ 1 分支；实现已支持 N，多分支能力由测试 fixture 验证 |
| **P1-S2b-1 — Multi-branch UI 基础** | 解 length ≤ 1 invariant；右键新选区 APPEND；BranchPane 多卡片视图（卡 = 彩色 tab header + 单徽章 + snippet + chevron + X + body）；颜色 cycling（pickNextColor）；collapse 接 UI；单分支独立关闭；N>1 真路径首次穿过 React effect；sourceHighlight.ts **不允许永久改动**（mutation 临时 + revert） | 有 —— 用户能开第 2、第 N 个分支 |
| **P1-S2b-2 — follow-up 路由**（已拆出本块）| conversation-state 加 follow-up composer + N 卡共存时路由到正确 branch topic（复用 sendMessage thunk、不改 streaming 内部）| 有 —— 用户能在已建立的分支里继续追问 |
| **P1-S2b-3 — 交互精修** | sticky tab header；follow-up composer 复用 Enter/Shift+Enter/IME；hover 卡↔高亮联动 + 点高亮展开滚入；新分支自动展开 + 滚入。**纯 UI，不碰 send/streaming/高亮实现** | 有 —— 体验细节 |
| **P1-S2b 余项视觉** | folder-tab 凸起/斜角造型 + 动画；每卡发送中 loading 态（触碰 streaming）| 有 —— 剩余视觉 |
| **P1-S3 — Branch disposition** | 关闭路径分裂：弃用（discard，DELETE topic）vs 保存（save，留 SQLite + 可重开）；UI 给关闭按钮加二级菜单或确认 | 有 —— 关闭语义不再单一 |

**S1 是 P1 最高风险的状态迁移、S2a 是 P1 唯一一次允许动 sourceHighlight.ts**（D-013 同一文件），所以这两步都单独隔离 + 带满 mutation/red-test 验证：S1 零行为变化 + 纯 shape + length 仍 ≤ 1；S2a 加 targeted-clear 能力但 UI 仍 ≤ 1；S2b-1 首次 N>1 真路径（带 data-hl mutation 验证）；S2b-2 才上视觉细节。每一步都可独立 verify + revert。

## 子任务

- [[P1-S1_StateFoundation/README|P1-S1 State Foundation]] ✅ 2026-06-01（commit `f915938ec`）
- [[P1-S2a_HighlightImpl/README|P1-S2a Highlight Implementation]] ✅ 2026-06-01（commit `14edaa0f7`）
- [[P1-S2b-1_MultiBranchUI/README|P1-S2b-1 Multi-Branch UI 基础]] ✅ 2026-06-01（commit `5c7071a69`）
- [[P1-S2b-2_FollowupRouting/README|P1-S2b-2 follow-up 路由]] ✅ 2026-06-01（commit `1c7f4ba20`）
- [[P1-S2b-3_Polish/README|P1-S2b-3 交互精修]] ❌ **已废弃**（sticky-stacking via display:contents → B1 重叠;未入库）→ 被 S2c 取代
- [[P1-S2c_MasterDetail/README|P1-S2c 面板布局（accordion 定稿）+ 统一键盘]] ✅ 2026-06-03（待 commit）—— accordion 手风琴单滚动区(每分支=标题+紧贴其下内容,修 B1 重叠/串位)+ locate(新建/展开滚到顶)+ 统一共享 composer 键盘修 B3 + compose label;中间态 master/detail 被 accordion 取代
- P1-S2d 余项（hover 联动 / folder-tab 视觉 / 每卡 loading 态 / B4 菜单兜底 / 可选 sticky 当前标题）— 未开始
- P1-S2-B5 关闭中止流式（abort，保护区，需批准）— 未开始
- P1-S3 Disposition（discard vs save on close）— 未开始

## 触碰边界（整个 P1 都遵守）

- **不动**：`__BRANCH_ANCHOR_CTX_CACHE__` HMR 缓存模式（D-013-FIX 根因防御）
- **不动**：fork / streaming / provider / model picker / Redux / Dexie
- **S2a 之前不动**：`sourceHighlight.ts` 的 paint/clear/wrap 算法（S2a 是 P1 唯一一次允许动该文件 —— stamping + targeted clear；S2b 不再需要动）

## 关键 invariant

- **S1 invariant**：`branches.length ≤ 1` —— S2b 之前一直保持。
- **S2a 之后**：`paintSourceHighlight(blockEl, start, end, branchId, colorKey)` + `clearSourceHighlight(branchId)` 支持多分支不互擦；UI 仍单分支，多分支能力由测试 fixture 验证。
- `MainTextBlock.tsx` 的 effect 注释明文写「S1 invariant 让 for-loop 跑 0 或 1 次」+「S2a 加 targeted clear 让 length ≥ 2 时不互擦」。
