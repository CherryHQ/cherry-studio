# P1-S2b-1 — Multi-Branch UI：append + folder-tab card stack + color cycling + 多高亮真路径

**状态**：✅ 已完成（2026-06-01；focused 84/84 绿；data-hl mutation 6 expected-red 命中；待 commit）
**前置**：[[../P1-S1_StateFoundation/README|P1-S1 State Foundation]] (`f915938ec`) + [[../P1-S2a_HighlightImpl/README|P1-S2a Highlight Impl]] (`14edaa0f7`)
**前一篇**：[[../README|P1 概览]]

---

## 目标

把 S2a 已经准备好的"N-capable 高亮实现"真正接到 UI 上 —— branches.length 不再限于 ≤1，用户可以同时打开多个分支，每个有独立颜色 + 独立卡片 + 独立 close。**S2a 的 fixture-only 多分支验证**第一次穿过 React effect 走到真实 DOM。

> S2a 是机制就绪、UI 没用；S2b-1 是 UI 真的用了机制；S2b-2 才精修视觉细节；S3 才加 close 语义分裂（discard vs save）。

## 触碰边界（守住）

- **sourceHighlight.ts**：本步**禁止永久改动**（mutation 临时改 + revert）。S2a 留下的 N-capable 实现已就绪；S2b-1 只是用它，不动它。最终 `git diff -- sourceHighlight.ts` 必须为空 ✓ 已验证。
- **未动** `__BRANCH_ANCHOR_CTX_CACHE__` HMR 缓存模式
- **未动** fork / streaming / provider / model picker / Redux / Dexie
- **未做**（明确推后）：
  - hover↔highlight 联动 → S2b-2
  - 新分支创建后自动 scroll-into-view → S2b-2
  - 凸起/斜角 folder-tab 视觉 → S2b-2
  - conversation 状态加 follow-up composer → 触碰 streaming，留更后
  - discard vs save 关闭语义 → S3
  - branch summary → P2

## 改动逐项

### 1. append + 颜色 cycling（`constants.ts` + `Chat.tsx`）

| 文件 | 改动 |
|---|---|
| `BranchPanel/constants.ts` | + `BRANCH_HL_COLOR_VALUES: Record<BranchHlColorKey, string>`（6 个 rgba）+ `pickNextColor(usedKeys)` 纯辅助 |
| `BranchPanel/index.ts` | 多 export `BRANCH_HL_COLOR_VALUES` + `pickNextColor` |
| `Chat.tsx` | `openBranchAnchor` 从 replace 改 APPEND；新分支 `color = pickNextColor(branches.map(b => b.color))` |

**DRY 妥协**（写在 constants.ts 注释里）：sourceHighlight.ts 的 `ensureHighlightStyle` 仍用 hardcode 字面值构造 `--branch-hl-cN` CSS 变量 —— S2b-1 禁止改 sourceHighlight.ts，所以 constants.ts 那份是 "非-sourceHighlight 消费者" 的单一来源。将来允许改 sourceHighlight.ts 的步骤可以统一。

### 2. Card stack（`BranchPane.tsx` 重写 + 新 `BranchCard.tsx`）

| 文件 | 改动 |
|---|---|
| `BranchCard.tsx`（**新建**） | 单卡片：tab header（彩色条 + #N 徽章 + 选区 snippet + chevron + X）+ body（compose state = BranchComposer / conversation state = quote + BranchMessageStream） |
| `BranchPane.tsx`（**重写**） | 接口从 `(anchor, branchTopic, status, onCreate, onComposeCancel)` 改为 `(branches, collapsedBranchIds, onToggleCollapsedBranchId, creatingBranchId, forkStatus, forkErrorMessage, onCreate, onCloseBranch)`；渲染 N 个 `<BranchCard>`；isVisible = branches.length > 0；resize 状态保持 |
| `Chat.tsx` | + `creatingBranchIdRef` + `creatingBranchId` state 跟踪当前 fork 的 branch id；+ `handleCreateBranchFollowUp(branchId, followUp)` 构造 BranchAnchor 喂 useBranchFork.fork；+ `toggleCollapsedBranchId(branchId)`；+ `handleCloseBranch(branchId)` 调 `clearSourceHighlight(branchId)` + 从 branches 和 collapsedBranchIds 移除 + 如果关闭的是 creating branch 则 reset fork |

#### Tab 颜色与 highlight 颜色共享

- Tab header 用 `style={{ backgroundColor: BRANCH_HL_COLOR_VALUES[branch.color] }}` 设 inline rgba
- 主对话上的 highlight span 用 `data-hl={branch.color}` 经 CSS `[data-hl="cN"]` 规则用 `var(--branch-hl-cN)` 上色
- 两路通到同一个 colorKey（`Branch.color`），所以 tab ↔ source highlight 视觉一致

#### N 卡片的同步策略

useBranchFork 只支持一个 in-flight fork。在 N 张卡片同时存在 compose-state 时，需要知道当前 fork 是哪张卡片发起的。Chat.tsx 用 ref + state 双轨：

- `creatingBranchIdRef` —— `onCreated` 闭包捕获的稳定 ref，确保多次 fork 不串
- `creatingBranchId` state —— 给 BranchPane → BranchCard 派生"哪张卡显示 creating/error 状态"

`onCreated` 只把新 topic 挂到 `creatingBranchIdRef.current` 指定的 branch（不再按 `topic === null` 找首个 match，那样 N>1 时会串）。

### 3. 集成 RISK：cross-contamination 防御

> 每个卡片 = 一个 MessageGroup 渲染。每个卡片必须按自己的 branchTopicId 解析自己的分支会话（经合成 assistant.topics —— S1 已经把所有 branch topics 都塞进去）；每个卡片必须**留在 BranchAnchorContext Provider 外**（避免分支内部消息被误识别为主对话锚定块、被误画高亮）。

**怎么保证的**：

| 风险点 | 守护 |
|---|---|
| 卡片内 MessageGroup 拿错 topic | `<BranchMessageStream topic={branch.topic}>` —— prop 是 branch-local，绑死。`useTopicMessages(topic.id)` 按 id 查 Redux，不会串 |
| 卡片内 MainTextBlock 把分支消息当成主对话锚定块、重画高亮 | `<BranchAnchorContext value={...}>` 在 Chat.tsx 只包**主** `<Messages>`；`<BranchPane>` 是它的兄弟节点（`<BranchAssistantContext>` 内但 BranchAnchorContext 外）。卡片里的 MainTextBlock 读到默认 `{ anchors: [] }`，effect 提前 return，**永不画**。这是 S1 留下的 deliberate isolation 的关键 |
| regenerate / edit / delete in branch 找不到自己的 prompt | `<BranchAssistantContext value={branchOverride}>` 的 synthetic assistant 的 `.topics` 已经包含全部 branch topics（S1 改的 spread）；`messageThunk:854` `origAssistant.topics.find(t => t.id === branchTopicId)` 按 id 查，N>1 也准 |

**验证方式**：
- `BranchPane.test.tsx > compose-state card body has a composer; conversation-state card body has a stream bound to that branch topic` 直接断言每个卡的 `data-topic-id` 是它自己的 branch topic id
- `MainTextBlock.test.tsx > anchors on different blocks → each block injects its own span` 验证了多 anchors 时每个 block 只画自己的 spans，无 cross-paint
- 已存在的 `BranchAssistantContext.test.ts` 用 `resolveAssistantSource` 4 用例守护 strict-match guardrail

## 测试

| 文件 | 用例数 | 新加 / 改动 |
|---|---|---|
| `sourceHighlight.test.ts` | 19 | 未改 |
| `MainTextBlock.test.tsx` | 23 | +2：N>1 coexistence through real effect / [A,B]→[B] targeted clear through real effect |
| `BranchPane.test.tsx` | 10 | **整文件重写**（旧 12 用例基于 anchor+topic API，全部失效）—— 现在覆盖：visibility 隐藏 / resize handle 显隐 / N 卡片渲染 + 顺序 + 徽章 / 每卡 data-branch-id+data-hl / compose vs conversation 路由 / collapse 路由 / chevron 调 host setter / X 调 host onCloseBranch / forkStatus 只到 creating card / composer submit 携 branchId |
| `BranchCard.test.tsx`（**新建**） | 12 | 单卡片 wiring：badge index+1 / tab data-branch-id+data-hl / 颜色 rgba 比对（数值非字面）/ snippet / 展开折叠 / aria-expanded / X / 取消等同 X / compose vs conversation 路由 / status forwarding / submit |
| `constants.test.ts`（**新建**） | 7 | palette 完整性 + 6 色 distinct + pickNextColor 4 个场景（空 / 顺次 / 跳已用 / 全用回卷） |
| `BranchComposer.test.tsx` | 已有 | 未改 |
| `BranchMessageStream.test.tsx` | 5 | 未改 |
| **focused 合计** | **84** | （S2a 时 40 → S2b-1 84） |

### N>1 coexistence 用例细节（MainTextBlock）

```ts
// 给两 block 分别配 anchors（不同 branchId + 不同 color）
const multiAnchors = {
  anchors: [
    { branchId: 'branch-A', blockId: 'blk-A', selectionStart: 0, selectionEnd: 5, color: 'c1' },
    { branchId: 'branch-B', blockId: 'blk-B', selectionStart: 0, selectionEnd: 6, color: 'c3' }
  ]
}
// 渲染两个 MainTextBlock，验证：
// - 各自 block 各自 inject 自己的 span
// - 每个 span data-branch-id + data-hl 匹配自己的 anchor
// - DOM 里两种颜色都在（new Set([..data-hl]).equals(new Set(['c1', 'c3'])))
```

第二个用例 `[A, B] → flip to [B]`：先验证 A、B 都有 spans + 各自 attrs；rerender 用 `{ anchors: [anchorB] }`；验证 A 的 spans 全清、B 的 spans count + text + attrs 全保留。**这是 S2a 直接 DOM fixture 的真路径版**。

## data-hl mutation 验证（Step 7 + 用户 follow-up）

**Mutation**：临时把 `wrapRangeWithSpans` 里的 `span.setAttribute(COLOR_KEY_ATTR, colorKey)` 注释掉。

**首跑结果**：6 RED / 78 GREEN，**但 2 个用例在 mutation 下意外 GREEN（fake-green）**：

| 位置 | 用例 | 旧 pattern |
|---|---|---|
| `sourceHighlight.test.ts:295,305` | `clear(A) leaves B fully intact; then clear(B) wipes` | `expect(after).toEqual(bColorsBefore)`（preserve = after === before；mutation 下两端都 `[null]`，trivially equal）|
| `MainTextBlock.test.tsx:633,652` | `anchors [A,B] flip to [B] → A removed, B intact` | `expect(after).toEqual(bAttrsBefore)`（同款 preserve pattern） |

按用户 follow-up 把两处 attribute 断言都改成**绝对**断言（参考 `nested-overlap` 已绝对的样本）：`for (const s of bSpansBefore/After) expect(s.getAttribute('data-hl')).toBe('c2' /* 或 'c3' */)`，删除 `bColorsBefore` / `bAttrsBefore` 临时变量。

**修补后再跑 mutation**：**8 RED / 76 GREEN**，所有 8 个 data-hl 断言相关用例都正确变红：
1. `sourceHighlight > paint single-text-node ... data-branch-id + data-hl`
2. `sourceHighlight > paint multi-node ... every span tagged`
3. `sourceHighlight > disjoint paint(A)+paint(B) coexist ... own branchId/color`
4. `sourceHighlight > clear(A) leaves B fully intact; then clear(B) wipes` ← **新 RED（修补后）**
5. `sourceHighlight > nested overlap clear(A) leaves B intact`
6. `MainTextBlock > matched block injects span ... data-hl`
7. `MainTextBlock > N>1 coexistence (anchors on different blocks)`
8. `MainTextBlock > anchors [A, B] flip to [B] → A removed, B intact` ← **新 RED（修补后）**

GREEN：所有非颜色断言（round-trip、单分支 attr-free 用例、BranchCard 单元测试、constants 等）。**0 个 fake-green 残留**。

### 全仓 attribute "preserve" pattern grep（按 follow-up 要求）

完整扫了 `sourceHighlight.test.ts` 和 `MainTextBlock.test.tsx`，所有 `after === before` / `toEqual(capturedBefore)` 形式的 attribute 断言（共 3 处）现状：

| 位置 | 现状 | mutation 下行为 |
|---|---|---|
| `sourceHighlight.test.ts:332,344`（nested overlap） | 已是绝对断言（`expect(...).toBe('c2')`） | RED ✓（参考样本） |
| `sourceHighlight.test.ts:295,305`（disjoint）| 已改绝对（本 follow-up）| RED ✓ |
| `MainTextBlock.test.tsx:633,652`（[A,B]→[B]）| 已改绝对（本 follow-up）| RED ✓ |

textContent 的 preserve pattern（如 `toBe(bTextBefore)`）spec 未明确要求改、且 textContent 远难破坏（需改 splitText/range 算法，跟 stamp 完全不同的故障模式），暂不动。

## sourceHighlight.ts 字节级未改

```
$ git diff -- src/renderer/src/utils/branchAnchor/sourceHighlight.ts
（空）
```

Mutation 完整 revert。S2b-1 完成时 sourceHighlight.ts 与 S2a commit `14edaa0f7` 完全一致。**注意**：`sourceHighlight.test.ts` 不在 "字节不变" 之列 —— 本轮 follow-up 把 :295,305 那个用例的 color 断言改成了绝对断言（13 lines: +9 / −4）。这是 test-only 改动，未触 sourceHighlight.ts 本体。

## 不要做（future-you red flags）

- ❌ **不要把 paintSourceHighlight 体内的 first-line `clearSourceHighlight(branchId)` 改回无参全擦**（S2a 已经修过，silent regression 在 ≤1 分支 UI 下看不见，但 S2b-1 的 N>1 卡片会立刻爆 —— paint(B) 擦掉 A）
- ❌ **不要把 sourceHighlight.ts 改成从 constants.ts 导入 `BRANCH_HL_COLOR_VALUES`**（虽然 DRY 上诱人）—— P1-S2b-1 禁止永久改 sourceHighlight.ts。等到 P2/P3 解除该禁制后再做
- ❌ **不要把 `BranchPane` 移进 `<BranchAnchorContext>` Provider 内部**（cross-contamination 防御 —— 卡片里的 MainTextBlock 会读到主对话的 anchors，把分支内部消息当成锚定块去画高亮）
- ❌ **不要在 conversation-state 卡里加 follow-up composer**（触碰 streaming 链，越 S2b-1 边界；归后续步骤）
- ❌ **不要在 X 按钮路径里加 DELETE topic**（disposition 语义分裂归 S3；S2b-1 关闭只清前端 state + targeted clear span）

## Manual smoke checklist（用户跑 dev 时验证）

- [ ] 选段 → 右键 "Open as branch" → 第 1 张卡出现，主对话上对应段落变 c1 琥珀色
- [ ] 不关闭第 1 个分支，选另一段 → 右键 → 第 2 张卡出现在第 1 张下面，主对话上**两段同时**带高亮，第 1 段琥珀、第 2 段（应该是）天蓝（c2）
- [ ] 继续开第 3、第 4 个分支 → 颜色按 c1→c2→c3→c4 cycle
- [ ] 点第 2 张卡的 chevron → 该卡 body 折叠，header 仍在；再点 → 重新展开
- [ ] 点第 2 张卡的 X → 第 2 张卡消失，主对话上第 2 段的高亮消失，**第 1、第 3、第 4 段高亮不动**
- [ ] 反复展开/折叠多个 → 多个 body 可同时展开
- [ ] 关闭最后一张卡 → BranchPane 收回（width → 0）
- [ ] 在某卡的 composer 里打字 → 模型回复进的是该 branch 的 conversation，不会漏到其它卡
- [ ] tab 颜色条 ↔ 主对话高亮 视觉对得上（同色系）

## S2b-1 ↔ S2b-2 边界

**S2b-1 已做**（这一步）：
- append 语义、card stack 结构、color cycling、N>1 真实 effect 路径、card 单卡基本交互（chevron/X/snippet/header）、isolation 防御

**S2b-2 留**：
- 凸起/斜角 folder-tab 视觉 + 动画
- hover 一张卡 → 主对话上对应段落 highlight 突出（borderHighlightOnHover）
- 新分支创建后 panel 自动 scroll-into-view 新卡
- conversation 卡内的 follow-up composer（需要 streaming 集成）

**S3 留**：
- close 语义分裂：discard（DELETE topic + UI close）vs save（保留 SQLite topic 行，UI 折叠为可重开 chip）
- 当前 S2b-1 关闭路径是 "discard 但不 DELETE"：前端 state 清干净、span 清干净、SQLite topic 行作为 orphan 留在数据库（path Y / T-006D-2C-5 cleanup 一并）
