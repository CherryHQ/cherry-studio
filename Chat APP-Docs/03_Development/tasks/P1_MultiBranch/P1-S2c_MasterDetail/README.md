# P1-S2c — 面板布局（**accordion 手风琴 · 定稿**）+ 统一 composer 键盘（修 B3）

**状态**：✅ 已实施（2026-06-03；focused 75/75 绿；结构 + locate + B3 mutation 均非空转已验；待 commit）
**前置**：[[../P1-S2b-1_MultiBranchUI/README|S2b-1]]（`5c7071a69`）+ [[../P1-S2b-2_FollowupRouting/README|S2b-2]]（`1c7f4ba20`）
**取代**：[[../P1-S2b-3_Polish/README|S2b-3 sticky-stacking]]（已废弃，未入库）

> ⚠️ **布局两次迭代（本 README 下半部分仍是中间态 master/detail 记录,以本节为准）**：
> 1. S2c 先做 **master/detail**(标题全在顶上 master 区、正文全在 detail 区)→ 修了 B1 重叠,但 dev-smoke 暴露"标题与正文分家、Branch N 标题下方夹着别的 branch 内容",**不符产品预期**。
> 2. **定稿 = accordion 手风琴**(设计 §3b,用户画图确认):**单一滚动区**,每分支 = 一个盒子 = 标题 + (展开时)紧贴其下的自己内容。复用 master/detail 阶段的 `shrink-0` 真实盒子修复、B3 统一键盘、`BranchTab`/`BranchDetail`,只是把"两区"并成"一个滚动区 + 标题贴内容" + 加 **locate**。

## A（定稿）— accordion 单滚动区

- `BranchPane`(`BranchPane.tsx`)= **单一滚动区** `branch-pane-scroll`(`flex-1 min-h-0 overflow-y-auto`)。**无** master/detail 两区。
- 每分支 = 新 `BranchAccordionItem`(`branch-item-${id}`,**真实盒子 `shrink-0`** —— S2c 重叠修复移到此盒子)内:
  - `BranchTab`(标题,始终渲染)
  - `{!collapsed && <BranchDetail>}`(内容,**同一 item 内、紧贴标题正下方**)
- `BranchDetail` **去掉自己的外层盒子**(改 content-only + `border-t` 分隔),避免双框。
- **绝无** `position:sticky` / `display:contents`(纯文档流;标题随内容一起滚,长内容下滑时上面分支标题滚出视野 —— §3b 已接受取舍)。Branch N+1 永远在 N 下面。
- 多展开(`collapsedBranchIds`),折叠 = 只剩标题。

### locate（自动定位）
`BranchPane` 单滚动区加 ref + `scrollItemToTop(id)`(= `querySelector('[data-branch-item-id=id]').scrollIntoView({block:'start'})`,optional chaining jsdom 安全):
- **新建** → effect 追踪新增 id → 滚到顶(新分支默认展开,Chat 的 `openBranchAnchor` 不入 collapsed)。
- **点折叠标题展开** → `handleToggleCollapse`:`wasCollapsed=collapsedBranchIds.has(id); onToggleCollapsedBranchId(id); if(wasCollapsed) scrollItemToTop(id)`。
- **点已展开 chevron 折叠** → 仅 toggle,**不滚**。X 不变。

### compose label
新 i18n `chat.message.anchor.panel.compose_label`("Ask about the selected text"/"针对选中内容提问"/"針對選中內容提問");`BranchComposer` 用它替代 `follow_up_label`,修 compose 态把初始 composer 误标为 "Follow-up question"。

### accordion 测试 + mutation
- `BranchAccordionItem.test`(5):**header 与 content 同一 item**(展开)/ 折叠只剩 header / compose vs conversation 内容 / item 盒子 `shrink-0` 且无 `min-h-0`(重叠修复契约) / 无 display:contents·sticky。
- `BranchPane.test`(14):单滚动区、无 master/detail 区 / N item 创建顺序 / 每 item 含自己 header+content / 折叠 / 无 display:contents·sticky / **locate**(新建滚、展开滚、折叠不滚) / 路由(compose create、follow-up→B、X、forkStatus) / 可见性。
- **M1(结构)**:把 `BranchDetail` 渲到 item 盒子外 → "header+content 同 item" RED(已 revert)。
- **M2(locate)**:`scrollItemToTop` 改 no-op → 新建/展开 locate 测试 RED、折叠-不滚仍 GREEN(已 revert)。
- **MANUAL-SMOKE**(测试文件顶部 SCOPE 注明,jsdom 无布局):标题随内容滚走(不 pin)、不重叠、真正滚到顶 —— 单测不证。

---

> 以下为 master/detail 中间态的历史记录(已被上面的 accordion 定稿取代,保留供追溯)。

## A（中间态，已被 accordion 取代）— Master/Detail 两兄弟区
> 本步是**纯前端面板重构**。把坏掉的 S2b-3「display:contents + 递增 sticky top」卡栈整体丢弃,改成 **master/detail** 两兄弟区(修 B1);并把两个 branch composer 的 Enter 提交逻辑统一到**唯一**共享 handler(修 B3)。

## 修的问题
- **B1**(双流卡片重叠):S2b-3 用 `display:contents` 让卡 wrapper 无盒子 + 每个 header `position:sticky` 递增 top → 所有 header 共享滚动容器为 containing block、同时常驻并叠在下方 body 上,双流增长时视觉交叉。**根因 = display:contents + 手搓 sticky 偏移**。
- **B3**(Enter 不发送):**初始 `BranchComposer` 从来没有 keydown→submit**(只有 Create 按钮);follow-up composer 有但与初始的不一致。

## A — Master/Detail 布局（B1 修复）

`BranchPane.tsx` 改成 flex 列两个**兄弟区**(不是单滚动容器 + sticky 子项):

| 区 | 实现 |
|---|---|
| **MASTER**（`BranchPane.tsx` `branch-pane-master`）| `flex max-h-[40%] flex-none overflow-y-auto`;N 个 `BranchTab`(彩色徽章 + snippet + chevron + X)。**是 detail 的兄弟、不是祖先** → detail 滚动时常驻可见。分支多时自身内部滚动(独立 scroll context)|
| **DETAIL**（`branch-pane-detail`）| `flex min-h-0 flex-1 overflow-y-auto`,**唯一随 body 滚动的容器**;未折叠分支各渲一个 `BranchDetail` **真实盒子**(border+bg)|

- **绝不用** `position:sticky` / `display:contents`(头部可见性靠**结构**——master 是独立兄弟区——而非 CSS 钉住)。
- 多个展开的 detail = 普通 flex 盒子顺序排列 → **永不重叠**(B1 修复)。
- 折叠分支:只在 master 留 tab,detail 区不渲染其盒子。tab 的 chevron/snippet 点击切换折叠,X 关闭。
- 拆分:旧 `BranchCard`(tab+body 二合一)→ 新 `BranchTab`(master 行) + 新 `BranchDetail`(detail 盒子)。**删 `BranchCard.tsx` + 测试**。
- `BranchMessageStream` 保持无内部滚动(随 detail 区单容器流动)。

### A 补丁（2026-06-03 dev-smoke 后）：detail 盒子非收缩
仅 master/detail 结构还不够 —— dev 实测仍串位。**根因**:`BranchDetail` 盒子是**可收缩、不裁剪**的 flex 子项(`flex min-h-0 …`,默认 `flex-shrink:1`,无 overflow),在高度有界的 `overflow-y-auto` detail 区里被 flex **压缩到比内容矮**,内容溢出叠到下一个盒子上(混态:高的 conversation 盒子压到矮的 compose 盒子上最明显),`overflow-y-auto` 因"压缩装下了"而从不滚动。
**CSS-only 修复**(`BranchDetail.tsx`):盒子 `flex min-h-0 flex-col …` → `flex shrink-0 flex-col …`(加 `shrink-0`、去 `min-h-0`)→ 盒子保持自然高度、不被压缩 → detail 区 `overflow-y-auto` 真正接管整体滚动。**detail 区(`BranchPane.tsx:121`)与 `BranchMessageStream` 均不动**,**不**在盒子/stream 上加 overflow(那会裁剪、隐藏对话内容,比 bug 更糟)。
**测试**:`BranchDetail.test` 加 class 契约用例(盒子含 `shrink-0`、不含 `min-h-0`),顶部 SCOPE 注明这是**代理**、非视觉不重叠的证明(jsdom 无布局,视觉仍 manual-smoke);mutation(去 `shrink-0`)→ RED 已验。

## B — 统一 composer 键盘（B3 修复）

新 `composerKeyboard.ts` 导出**唯一** `handleBranchComposerKeyDown(event, submit)`:
- `event.key==='Enter' && !nativeEvent.isComposing` → `isSendMessageKeyPressed(event,'Enter',true)` 命中则 `preventDefault()+submit()`;Shift/Ctrl/…+Enter 落到 textarea 换行;IME 组字 Enter 不提交。
- `forceEnterToSend=true`(S2b-3 已给共享 `isSendMessageKeyPressed` 加的可选参,默认 false → 主输入不受影响)→ Enter 无视全局发送键偏好。
- 空白校验留在各 composer 自己的 `submit()`(`handleCreate`/`handleSend`),共享 handler 只做"是否按了提交键"。
- `BranchComposer`(初始,**之前完全无 keydown**)与 `BranchFollowUpComposer`(追问)**都调它** → **单一来源,无第三份分叉**。

## 改的文件（src，以 git status 为准）

| 文件 | 改动 |
|---|---|
| `BranchPanel/composerKeyboard.ts` | **新建** —— 唯一共享键盘 handler |
| `BranchPanel/BranchTab.tsx` | **新建** —— master 行 |
| `BranchPanel/BranchDetail.tsx` | **新建** —— detail 真实盒子(compose→BranchComposer / conversation→quote+stream+follow-up)|
| `BranchPanel/BranchPane.tsx` | **重写** —— master/detail 两兄弟区,无 sticky/display:contents |
| `BranchPanel/BranchComposer.tsx` | + `onKeyDown` 接共享 handler(Enter 创建)|
| `BranchPanel/BranchFollowUpComposer.tsx` | inline keydown → 改调共享 handler |
| `BranchPanel/BranchCard.tsx` | **删除**(拆成 BranchTab+BranchDetail)|
| `BranchPanel/BranchMessageStream.tsx` | 保持无内部滚动(S2b-3 已改,master/detail 需要)|
| `utils/input.ts` | 保留 S2b-3 的 `forceEnterToSend`(B3 需要)|
| 测试 | 新建 `composerKeyboard/BranchTab/BranchDetail` 测试;重写 `BranchPane` 测试(master/detail 结构);`BranchComposer` 加键盘组;删 `BranchCard` 测试 |

**回退的 S2b-3 越界改动**:`Chat.tsx` / `index.css` 回 HEAD;删 `useHighlightEmphasis.ts` + 测试(hover 联动归后续步骤)。

## 测试矩阵（focused 125/125）

| 文件 | 用例 | 备注 |
|---|---|---|
| composerKeyboard.test.ts | 5 | 新建:Enter 提交+preventDefault / Shift+Enter 不提交不 preventDefault / IME 不提交 / Ctrl·Meta+Enter 不提交 / 非 Enter 忽略 |
| BranchComposer.test.tsx | 12 | 8 旧 + 4 键盘(Enter 创建 / Shift+Enter 不创建 / IME 不创建 / 空白不创建留校验)|
| BranchFollowUpComposer.test.tsx | 8 | 共享 handler 后行为不变,全绿 |
| BranchTab.test.tsx | 5 | 新建:badge/snippet/data-hl / 颜色 / chevron+snippet 切换+X / aria-expanded / 无 sticky·display:contents |
| BranchDetail.test.tsx | 5 | 新建:compose/conversation 路由 / **真实盒子(非 display:contents/sticky,有 border)** / Cancel→onClose / follow-up→onSendFollowUp |
| BranchPane.test.tsx | 13 | **重写**:master/detail 分离不互含 / 全局无 display:contents·sticky / detail 自有 overflow + 各 detail 独立盒子 / N tab / 折叠保留 tab 去 detail / chevron·X 路由 / 模式路由 / forkStatus 路由 / create·follow-up 路由 / 可见性 |
| 回归 | BranchMessageStream 5 / constants 7 / input 9 / sourceHighlight 19 / MainTextBlock 23 / useBranchFork 9 / useBranchFollowUp 5 | 全绿 |

### B3 mutation（非空转）
共享 `handleBranchComposerKeyDown` 改 no-op → composerKeyboard "Enter→submit" + BranchComposer "Enter 创建" + "空白不创建留校验" + BranchFollowUpComposer "Enter 发送" 共 **4 RED**;还原。证明两个 composer 的键盘提交断言均真实。

### IME 断言结果
`keyDown(Enter, isComposing:true)` → 初始 & follow-up composer 均**不**提交 ✓。

## 显式留给 MANUAL-SMOKE（jsdom 测不了）

jsdom 无 layout/scroll 引擎。**以下视觉结果只能 dev 手验,单测不覆盖**(测试文件顶部已写明 SCOPE,**不**用"sticky 已应用"之类样式代理冒充覆盖):
- 3 个分支(含 1 长):滚 detail body 时 **master tab 列表全程可见**。
- 两个分支同时流式:**detail 盒子不交叉/重叠**(这就是 B1)。
- master 折叠/展开定位到对应 detail。

## 保护文件字节不变
`git diff --stat` 空:`sourceHighlight.ts` / `BranchAnchorContext.tsx` / `messageThunk.ts` / `StreamingService.ts` / `useBranchFork.ts` / `InputbarCore.tsx` / `MessageEditor.tsx` / `Chat.tsx`(回 HEAD)。

## build:check
`pnpm lint` 全过(typecheck web/node/aicore + i18n + biome format 幂等)。focused 125/125 绿(format 后复跑)。完整 `pnpm test` 未跑(已知 shutdown SIGSEGV 环境问题)。

## 明确未做（后续步骤）
- B4 菜单变灰兜底 / B5 关闭中止流式(abort,保护区)
- hover 卡↔高亮联动、auto-scroll-into-view(S2b-3 已丢弃,后续重做)
- folder-tab 凸起/斜角造型、每卡 loading 态、tab 点击 scroll-into-view(locate)
