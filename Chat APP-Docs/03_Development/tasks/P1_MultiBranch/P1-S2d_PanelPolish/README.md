# P1-S2d — 分支面板交互打磨（card↔highlight 联动 / 每卡 loading / 扁平色条头 / 菜单兜底）

**状态**：✅ 已实施（上一会话）+ **用户实跑冒烟 4/4 验证通过** → **P1 收尾**。focused **134/134 绿**；typecheck:web exit 0；i18n:check 过；oxlint/eslint 0 error。**已提交**（见 [[../../开发日志#2026-06-07（P1-S2d）]]）。
**前置**：[[../P1-S2c_MasterDetail/README|S2c accordion]]（`0698edf64`）+ [[../../问题与Debug记录#B5|B5 关闭中止流式]]（`ed8314ec1`）+ [[P1-S3]] / B6-A（`0452c70c4`）。
**设计**：[[../../../P1架构设计草案#3b|§3b]] + [[../README|P1 概览]] 的 S2b-3/S2d 余项行。

> 这是 P1 三步法 S2b-3 + S2d-余项视觉 + B4 兜底的合并落地。**纯前端交互/视觉层**，不碰 send / streaming / 高亮实现（`sourceHighlight.ts`）/ Redux 写。

## 范围（5 项 + 一处造型决策）

| # | 项 | 落地 |
|---|---|---|
| item 1 | 卡 ↔ 源高亮**双向联动** | 新 hook `useHighlightCardLink`（见下）|
| item 2 | 新分支 / 点高亮 → 卡**自动滚入面板视野** | 经核查早已在 BranchPane 实现，本次仅一处**容器相对滚动**微调（不带动主线滚动条），**未重写** |
| item 3 | 每卡**发送中 loading 态** | 新 hook `useBranchTopicLoading` 读 Redux `loadingByTopic`（**信号选择见下，关键**）|
| item 4 | B4 不适用态**菜单变灰兜底** | 经核查 `SelectionContextMenu` 已正确（四项恒渲染 + `disabled={!hasAnchor}` 灰显 + handler null-guard + Radix `opacity-40`），**零改动、仅验证** |
| 造型 | folder-tab 凸起斜角 | **放弃凸起斜角**，改为**扁平色条头**（整条背景 = `BRANCH_HL_COLOR_VALUES[branch.color]`，与高亮同源 0.45 透明度，徽章加细 ring 区分）|

## 改动逐项

### 新增
| 文件 | 作用 |
|---|---|
| `BranchPanel/useHighlightCardLink.ts` | item 1 双向联动。**卡→高亮**：`handleCardMouseEnter` imperative 给匹配 `[data-branch-id]` span 增删 `is-emphasized` 类（规则在 `index.css`，**不碰 `sourceHighlight.ts`**，只操作其产物 DOM）。**高亮→卡**：在公共祖先 `#chat` 委托 `mouseover`/`click`，读 span 的 `data-branch-id`：hover 设 `hoveredBranchId`、click 调 `onActivateBranch`（展开+滚入）；面板内（`[data-testid="branch-pane-scroll"]`）事件忽略，由卡片自身 handler 主管。**隔离不变量**：`hoveredBranchId` 是 BranchPane 本地 state → hover 高频只重渲面板、**绝不触 `<Messages>` 子树**；span 侧是纯 imperative DOM、不重渲 React |
| `BranchPanel/useBranchTopicLoading.ts` | `useLoadingByTopic()` → `useAppSelector(state.messages.loadingByTopic)`，per-card：`map[branch.topic.id] === true` 即"流式中"。**只读、不改 Redux 形状** |
| `BranchPanel/__tests__/useHighlightCardLink.test.tsx` | 新 4 用例（卡→高亮 / 高亮→卡 / 点击激活 / 面板内忽略）|

### 修改
| 文件 | 改动 |
|---|---|
| `pages/home/Chat.tsx` | **唯一改动**：公共祖先 `#chat` Container 加 `chatContainerRef`；新增 `expandBranch`（仅展开不折叠）；把 `containerRef` + `onExpandBranch` 传给 BranchPane。hover 状态**不在 Chat** → hover 高频事件不触发 `<Messages>` 重渲（隔离②）。BranchPane 仍在 `BranchAnchorContext` **外**（隔离①未动）；用 `#chat` 的 ref 不依赖 RowFlex 透传 `data-*`（隔离③）|
| `BranchPanel/BranchTab.tsx` | 头改**扁平色条**：整条背景 = `BRANCH_HL_COLOR_VALUES[branch.color]`（严格扁平、无凸起斜角）；整条 = hover/click/collapse 目标（外层 `onClick=onToggleCollapse` + `onMouseEnter/Leave`）；snippet/chevron/X 全部 `stopPropagation` 保各自单次动作；loading 时渲 `Loader2` spinner（折叠时也可见）|
| `BranchPanel/BranchAccordionItem.tsx` | + `loading`/`emphasized`/`onHoverEnter`/`onHoverLeave`；`emphasized` 时卡片盒 `border-border`→`border-primary ring-1 ring-primary`，其余透传 BranchTab |
| `BranchPanel/BranchPane.tsx` | 接两个 hook；item 2 微调 `scrollItemToTop`→`scrollItemIntoView`（容器相对 `scrollElementIntoView(el, scrollRegionRef.current)`，不带动主线滚动条 + jsdom 特性探测守卫）；click 高亮 → `onExpandBranch` + `scrollItemIntoView`；按 `loadingByTopic[branch.topic.id]` 下传每卡 `loading`、按 `hoveredBranchId` 下传 `emphasized` + hover 回调 |
| `assets/styles/index.css` | + `.branch-anchor-highlight.is-emphasized { outline: 2px solid var(--color-primary); … }`（用 `outline`，**不碰** `data-hl` 背景）|
| `i18n/{en-us,zh-cn,zh-tw}.json` | + `chat.message.anchor.panel.card.streaming` |
| `__tests__/BranchTab.test.tsx` (+5) / `BranchAccordionItem.test.tsx` (+2) / `BranchPane.test.tsx` (+2, mock `useBranchTopicLoading`) | 见 [[验证]] |

## item 3 loading 信号（关键，写明以防回退）

per-card spinner 信号 = **messages slice 的 `loadingByTopic`**（`useLoadingByTopic` = `useAppSelector(state.messages.loadingByTopic)`），按 `branch.topic.id` 取键。

**为何不用 `message.status`**：`message.status` 会被 **B6 缺陷**（`newMessage.ts:270-283` block→message 传播，即 T-009/D-005）在**流真正结束前**提前翻 `success`；而 `loadingByTopic[topicId]` 在流式 task 起点置 true、**仅在该 topic 请求队列 drain 后**才清（`finishTopicLoading` → `await waitForTopicQueue`）—— 与 `MESSAGE_COMPLETE`（`scheduleForkTopicDeletion` 已依赖的同一真完成边界）一致。每个分支独占 fork topic，按 `topic.id` 取键天然 per-card 隔离。

→ 即用户冒烟验的两条：spinner **只亮在那张卡** + **流真结束才灭、不提前灭**。

## 测试（focused 134/134）
- `BranchTab.test.tsx` +5：整条点击切换 / 色条背景 / X 不冒泡 / spinner / hover 回调。
- `BranchAccordionItem.test.tsx` +2：emphasized 边框 / loading 透传 spinner。
- `BranchPane.test.tsx` +2（mock `useBranchTopicLoading`）：spinner 仅亮在 loading 的那张卡 / 无 loading 无 spinner。
- `useHighlightCardLink.test.tsx` 新 4：卡→高亮 / 高亮→卡 / 点击激活 / 面板内忽略。
- **SCOPE**：jsdom 无 layout/paint → 联动可见性 + 滚入 + spinner 真实熄灭对齐后端，靠 [[验证|manual-smoke]]（用户已实跑通过）。

## 保护文件 + build
`git diff` 全空：`sourceHighlight.ts` / `BranchAnchorContext.tsx`（`__BRANCH_ANCHOR_CTX_CACHE__` 模式）/ `messageThunk.ts` / `StreamingService.ts` / `abortController.ts` / `InputbarCore.tsx` / `MessageEditor.tsx` / `store/*` / `useTopic.ts` / `src/main/data/*`。
typecheck:web exit 0；i18n:check 过；biome format（仅 1 测试文件换行）；oxlint 0；eslint 0 error（仅 1 条既有 `--color-text-3` warning，在未触碰的 topic.rename PromptPopup，非本次引入）。完整 `pnpm test` 未跑（已知 vitest 主进程 shutdown SIGSEGV 环境坑，不阻塞 renderer 提交）。

## 不做 / 推迟
- **凸起斜角 folder-tab 造型** → 弃，扁平色条定稿。
- B2（第三个分支打不开）**本轮未纳入、未复现** → 仍 deferred 待单独 triage（[[../../问题与Debug记录#B2]]）。
- B6-Upstream（推迟 success / 清控制器，碰保护区）= 单独排期。
- 锚点跨刷新持久化 / kept 列表 / 分支摘要 = **P2 资产化**。
