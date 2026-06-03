# P1-S2b-3 — Multi-Branch 面板交互精修（sticky-stacking header / Enter 覆盖 / hover 联动 / 新建滚入）

> ⛔ **已废弃 / SUPERSEDED（未入库）**：A（sticky-stacking via `display:contents`）在 dev 实测导致 B1 卡片重叠;B（覆盖跟随偏好）仍正确但已并入下一步。**整步被 [[../P1-S2c_MasterDetail/README|P1-S2c master/detail 重写]] 取代**:A → master/detail 真实盒子;B → 统一共享 composer 键盘 handler;hover/auto-scroll 一并丢弃归后续步骤。本文档仅作历史/诊断参考,见 [[../../问题与Debug记录]] 的 S2b-3 诊断。

**状态**：❌ 已废弃（2026-06-01 实施 → 2026-06-03 经诊断替换为 S2c;**从未入库**）
**前置**：[[../P1-S2b-1_MultiBranchUI/README|S2b-1 卡片栈]]（`5c7071a69`）+ [[../P1-S2b-2_FollowupRouting/README|S2b-2 per-card follow-up]]（`1c7f4ba20`）
**前一篇**：[[../README|P1 概览]]

> **修订说明**：上一版 S2b-3 的 A 与 B 两项未达产品标准——A 用了**每卡内部 sticky**（每卡自成滚动上下文，靠前分支 header 仍滚走）；B **跟随全局发送键偏好**，而用户实例的偏好非纯 Enter → Enter 变成换行（与意图相反）。本版重做这两项（A 改单滚动容器 + sticky-stacking；B 改覆盖），C/D 随之适配。

---

## 目标（纯 UI/交互，不碰 send/streaming/高亮实现）

| 项 | 内容 |
|---|---|
| **A** | 所有分支 tab header 始终可达：单一面板滚动容器内 sticky-**stacking**，滚到某分支深处仍看得到其它分支的 header；顶部无接缝 |
| **B** | follow-up composer 的 Enter=发送 / Shift+Enter=换行（**覆盖**全局偏好），IME 安全、空白不发 |
| **C** | hover 卡↔源高亮互相强调；点高亮展开 + 滚入对应卡 |
| **D** | 新分支默认展开 + 滚入视野 |

## 触碰边界（守住，`git diff --stat` 全空已验）

`sourceHighlight.ts` / `BranchAnchorContext.tsx` / `messageThunk.ts` / `StreamingService.ts` / `useBranchFork.ts` / **`InputbarCore.tsx`** / **`MessageEditor.tsx`** / `__BRANCH_ANCHOR_CTX_CACHE__` / Redux / Dexie 全部未动。S3 disposition 不做（X 仍只移除 + targeted clear）。

## A — sticky-STACKING（单一滚动容器）

**上版根因**：sticky 放在每卡内部的 tab wrapper，sticky 元素被限制在**自己卡的盒子**里——卡 1 整体滚出视口后，它的 header 也随之离开。

**本版机制**：
- **单滚动容器**：`BranchPane` 的 `branch-pane-stack` 是唯一 `overflow-y-auto`；去掉 `gap-2 p-2`（flush 到顶、无接缝），卡间靠边框分隔。
- **移除每卡内部滚动**：`BranchMessageStream` 删掉自身的 `overflow-y-auto`/`min-h-0 flex-1` 与失效的 scroll-to-bottom effect，body 改为随内容流动。
- **跨卡 sticky 持久 + 堆叠**：`BranchCard` 外层改 `display:contents`（不生成盒子）→ header 与 body 提升为 `branch-pane-stack` 的直接 flex item → 每个 sticky header 的 containing block = 整个滚动容器（而非自己卡的盒子），所以 header 在自己 body 滚过后仍 pin 住；配 **递增 top 偏移** `top: index * TAB_H_REM`（`TAB_H_REM=2.75`）→ 多个 header **堆叠**且全部常驻。
- header `bg-background` 不透明底（内层彩色 strip 是半透明 rgba，防透色）。
- header 加 `data-branch-card-id`（C/D 的 scrollIntoView 目标——`display:contents` 卡 wrapper 无盒子不能 scrollIntoView）。

## B — Enter 覆盖（扩展共享 helper，不另写）

**根因确认**：`chat.input.send_message_shortcut` 默认 `'Enter'`（preferenceSchemas.ts:553），但 composer 上版用 `isSendMessageKeyPressed(event, sendMessageShortcut)` **跟随**该偏好；用户实例的偏好非纯 Enter → 纯 Enter 不命中 → 落到换行。`isSendMessageKeyPressed`（`utils/input.ts`）是 **InputbarCore + MessageEditor 共用**的判定 helper（无独立共享 hook，各输入用各自内联 keydown 但都调它）。

**修法**：给共享 helper 加可选第 3 参 `forceEnterToSend = false`：
- 默认 false → 原 `shortcut` switch 原样执行，**2 参调用者（主输入 / 初始提问 composer）字节不变、行为不受影响**。
- `forceEnterToSend=true` → 纯 Enter（无修饰键）即发送，Shift/Ctrl/Cmd/Alt+Enter 一律不发。
- `BranchFollowUpComposer` 改调 `isSendMessageKeyPressed(event, 'Enter', true)`，并删掉不再需要的 `usePreference` 依赖。IME 守卫 `!nativeEvent.isComposing` + 空白校验保留。

这是"扩展共享 handler + 可选参数、默认现状"的复用路线，**未新写第三份分叉**；主输入由 `input.test.ts` 的 parity 测试 + `InputbarCore`/`MessageEditor` 零改动双重保证不受影响。

## C / D（随 A 适配）

- C：单态 `hoveredBranchId`（Chat）双向 —— `useHighlightEmphasis` 给匹配 `data-branch-id` 的 span toggle `is-emphasized` 类（只增删类，规则在 `index.css`，不碰 sourceHighlight.ts）；Chat 主对话委托 `onMouseOver/onClick` 读 `data-branch-id`；BranchCard `emphasized` → tab strip + body `border-primary`（上版的卡级 `ring` 因 `display:contents` 失效，已改到 header/body 边框）。点高亮 → 展开 + 滚入（目标改 `data-branch-card-id`）。
- D：`BranchPane` effect 追踪新增 branch id → 滚 `[data-branch-card-id]` 进视野；新分支不进 `collapsedBranchIds`（默认展开）。

## 改的文件（11 src + docs，以 git status 为准）

### src
| 文件 | 改动 |
|---|---|
| `src/renderer/src/utils/input.ts` | `isSendMessageKeyPressed` + 可选 `forceEnterToSend`（默认 false）|
| `src/renderer/src/pages/home/Messages/BranchPanel/BranchFollowUpComposer.tsx` | onKeyDown 调 `isSendMessageKeyPressed(event,'Enter',true)`；删 usePreference |
| `src/renderer/src/pages/home/Messages/BranchPanel/BranchMessageStream.tsx` | 移除内部 overflow/scroll effect → 随内容流动 |
| `src/renderer/src/pages/home/Messages/BranchPanel/BranchCard.tsx` | `display:contents` wrapper + sticky-stacking header（top=index*TAB_H_REM）+ `data-branch-card-id` + emphasized→border-primary |
| `src/renderer/src/pages/home/Messages/BranchPanel/BranchPane.tsx` | stack 去 gap/padding（单容器、flush）；D scroll 目标改 `data-branch-card-id` |
| `src/renderer/src/pages/home/Chat.tsx` | C 点高亮 scroll 目标改 `data-branch-card-id`（其余 C 接线不变）|
| `src/renderer/src/hooks/useHighlightEmphasis.ts`（new）| card→highlight 强调（toggle 类）|
| `src/renderer/src/assets/styles/index.css` | `.branch-anchor-highlight.is-emphasized` 规则 |
| `__tests__/input.test.ts` | +2：forceEnterToSend override + parity（2 参不变）|
| `__tests__/BranchFollowUpComposer.test.tsx` | 键盘组改为 override 语义（Enter 发 / Shift+Enter 不发 / IME 不发 / 空白不发）|
| `__tests__/BranchCard.test.tsx` + `BranchPane.test.tsx` + `useHighlightEmphasis.test.ts` | sticky-stacking offset / display:contents / emphasized→border-primary / hover / scrollIntoView |

## 测试矩阵（focused 131/131）
| 文件 | 用例 | 备注 |
|---|---|---|
| input.test.ts | 9 | +3（override true / parity 2 参不变）|
| useHighlightEmphasis.test.ts | 4 | |
| BranchFollowUpComposer.test.tsx | 8 | 键盘组改 override |
| BranchCard.test.tsx | 18 | +sticky offset / display:contents / emphasized border |
| BranchPane.test.tsx | 16 | emphasized→tab border / scrollIntoView |
| BranchMessageStream.test.tsx | 5 | 移除内部滚动后仍绿（其测试本就不测滚动）|
| BranchComposer.test.tsx | 8 | **回归：初始提问 composer 未受影响** |
| 其余回归 | constants 7 / sourceHighlight 19 / MainTextBlock 23 / useBranchFork 9 / useBranchFollowUp 5 | |

### Mutation（非空转）
- **B**：composer 去掉 `onKeyDown` → "Enter 发送" RED，其余（不发类）GREEN。
- **A**：sticky `top: index*TAB_H_REM` → `0rem` → index-2 偏移断言（期望 `5.5rem`）RED。
- 均已 revert。

### IME 断言结果
`keyDown(Enter, isComposing:true)` → `onSend` 未调用 ✓。

### 主输入不受影响（regression）
`input.test.ts` parity 用例：2 参调用对所有 shortcut 行为与改前一致；`InputbarCore.tsx` / `MessageEditor.tsx` `git diff` 空；`BranchComposer.test.tsx`（初始提问 composer）8 用例全绿。

## build:check
`pnpm lint` 全过（typecheck web/node/aicore + i18n + biome format 幂等）。focused 131/131 绿（format 后复跑）。完整 `pnpm test` 未跑（已知 shutdown SIGSEGV 环境问题）。

## Manual smoke（用户跑 dev）
- [ ] 开 3 个分支，其中 1 个对话很长 → 滚到该分支深处时，**另外两个分支的 tab header 仍 pin 在顶部堆叠**、可直接 collapse/close，无需回滚找
- [ ] 顶部 header 区贴着面板顶（无空隙接缝），底边有清晰分隔
- [ ] follow-up composer：Enter 发送 / Shift+Enter 换行 / 中文输入法组字按 Enter 选词**不发送** / 空白不发
- [ ] **主聊天输入框键盘行为不变**（仍按你的全局发送键设置）
- [ ] hover 卡 tab → 对应源高亮描边强调；hover 源高亮 → 对应卡 tab/body 边框强调；点源高亮 → 卡展开并滚入
- [ ] 新开分支 → 卡默认展开并自动滚入可见区

## 留给后续
- 每卡"发送中" loading/禁用态（streaming 集成）
- folder-tab 凸起/斜角造型 + 动画
- 共享容器下的 follow-up reply 自动 scroll-to-bottom（随单容器改造移除，可后续按需重加）
- S3 disposition（discard vs save on close）
