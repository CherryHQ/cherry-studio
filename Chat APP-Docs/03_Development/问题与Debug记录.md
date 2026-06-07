# 问题与 Debug 记录（索引）

> 滚动 issue 列表。每条 `D-NNN` 一行；详细诊断在对应的任务文件夹下的 `诊断.md`。
> 命名空间与任务 ID 独立 —— D 是 issue（问题），T 是 task（工程）。一个 issue 通常对应一个或多个 task。

## 当前 open 问题

| ID | 标题 | 复现 | 严重度 | 关联任务 | 诊断文档 |
|---|---|---|---|---|---|
| D-006 | fresh install 默认模型仍是 CherryAI Qwen，不自动选 Ollama | `rm -rf ~/Library/Application\ Support/CherryStudioDev && pnpm dev` → 新建 topic 默认 model 是 Qwen \| CherryAI | 🟢 小毛刺，可手动切；非 baseline 阻塞 | 暂未建任务；等 v2 用户偏好 / 默认模型策略迁移时一起处理 | （无） |
| D-007 | Regenerate 切到 Ollama 后点旧回复 refresh 无明显反应 | 切到 Ollama 模型 → 在历史 assistant 消息上点 refresh / regenerate | 🟢 候选 issue；主聊天侧；与 D-009 分支侧无关 | 用户在 T-009 关闭后可单独复测；如仍存在则开 T-010 | （无） |
| **B4** | 开关一次分支后右键 "Open as branch"/"Ask" 变灰 | 开分支 → 关 → 重选 assistant 文本右键 | ✅ **已调查 = 非 bug**（菜单正确,重选即恢复）| 不修（保留选区需改 paint 保护区）| 本文 §B4 |
| **B5** | 流式中关闭分支,回复继续、无法中止 | 分支流式回复中点 X | ⚠️ **假绿**(只关了面板,后端没停)→ 由 B6 真修 | `handleCloseBranch` 调 `abortBranchTopicStream` —— 但 status 过滤命中 0 条,abort 从未发出 | 本文 §B5 / §B6 |
| **B6** | abort 是空操作:取靶按 status 过滤,而消息在流结束前已被标 success | 流式中关分支 → Network 里 Ollama 请求不 cancel、token 继续、finalize 打 404 | ✅ **A 修(未提交)**:取靶改按 abortMap 现存键;**B 上游未修** | `abortBranchTopicStream.ts` 一处改 | 本文 §B6 |
| **B2** | 关两个分支后第三个开不出 | 见调试弧；多半 = B4 或 stale-ref | 🟡 待复现确认 | accordion 后复测；归 S2d/排查 | 本文 §B1-B5 表 |
> 注：D-006 / D-007 / B2 是**先记录、待复现**的 issue。**B1/B3 已在 S2c 修复;B4 已调查=非 bug;B5 已修(未提交)**（见文末调试弧）。

### B6 根因 + 修法（A 已修未提交 / B 上游待排期，2026-06-07）

> 由 4 路只读静态追踪 + 3 路对抗验证(含"全力反驳")坐实;运行时日志确认:关闭那刻 assistant 消息(id `019ea072-…`, topic `0bc8d3c0`)`status:"success"` 但 `abortMapHasAskId:true / callbackCount:1`。

**现象**:流式中关分支 → Ollama 后端继续生成(verbose 持续增长),`onComplete`(非 onError)全量跑完 → `finalize` PATCH 打到已删消息 → 404 + unhandled rejection;Ollama 串行时还会**阻塞下一个分支**(实测 A 阻塞 B ~92s)。B5 的"tokens 停了"是**假绿**:只是面板移除了,后端流仍在跑。

**真因(两层)**:
- **A(下游,取靶)**:`abortBranchTopicStream`(和主聊天 `pauseMessages`)按 `status===processing||pending` 过滤取 abort 目标。
- **B(上游,过早 success)**:**消息在流真正结束前就被标 `success`**。链路:`text-end`→`TEXT_COMPLETE`(`AiSdkToChunkAdapter.ts:253`)→ `onTextComplete` 设 block=SUCCESS(`textCallbacks.ts:96`)→ `smartBlockUpdate(...,true)`(`BlockManager.ts:119`)→ `updateBlock` dispatch `upsertBlockReference`(`StreamingService.ts:386`)→ **reducer:block===SUCCESS && message===PROCESSING → message=SUCCESS**(`newMessage.ts:270-283`,即 T-009/D-005 修复,本意是消掉 BeatLoader)。这发生在 `readFullStream` 循环 `done=true` **之前**,`onComplete`/finalize 在 ~14s 后才触发。
- **合流**:close 时消息已 success → status 过滤命中 0 → `abortCompletion` 不调 → `abort()` 不触发。**而 abortController 仍在 abortMap**(`removeAbortController` 生产代码从不调用,只 `abortCompletion` 内部清)→ 靶子还在,只是被过滤挡住。信号链路本身是通的(`messageThunk:950`→`parameterBuilder:214`→`AiProvider:248`→fetch),只要 abort 真发出就能停 Ollama。
- **范围**:**系统性**。主聊天 Stop(`pauseMessages` 同款过滤)在首个 block 完成后点 Stop 同样停不住。分支注入 system prompt / 合成 assistant 对 block 时序**零影响**(纯文本拼接),不是分支特有。

**修法 A(已实施,未提交,仅 `abortBranchTopicStream.ts` 一文件)**:
- 取靶从 status 过滤 → **按 abortMap 现存键**:`messages.filter(m => m.role==='assistant' && m.askId && abortMap.has(m.askId))`,对每个 askId 调 `abortCompletion`。
- 安全性:对已结束控制器调 `abortCompletion` 是**无害幂等 no-op**(`abortController.ts:25` 的 `if(abortFns?.length)` 守卫 + Web 端 `abort()` 幂等),且顺带 GC 掉泄漏的 map 项。
- 不可见回退确认:abort 触发 `onError(isErrorTypeAbort)` → `finalize(SUCCESS)`(`baseCallbacks.ts:273-276`)→ 消息保持 success,**不会**翻成 error/aborted 的可见态。
- **已知小权衡**:abortMap 会泄漏(完成的消息控制器永不移除),故"已完成分支"关闭时也会命中 → `scheduleForkTopicDeletion` 走 8s timeout 才删 fork topic(而非立即)。fork topic 不在侧边栏、面板立即移除,**无可见影响、无泄漏、无 404**。未来若 B 修了或引入 topic-loading 信号可恢复"立即删"。

**未修 B(上游,留排期)**:
- 方向:把 `newMessage.ts:270-283` 的 PROCESSING→SUCCESS **推迟到流真结束**(onComplete),而非首个 block 完成;或 finalize 时清掉 abortController。
- 风险:碰**保护区**,且可能复活 T-009/D-005 那个"BeatLoader 永不消失 / action bar 不出现",需要重做 loading 判定(`isMessageProcessing`)。**作为独立上游议题排期,不在 B6-A 范围内动。**

---

### D-009 根因 + 修法（已 closed 2026-05-22，留存供后人复习）

**根因**（源码追溯）：
- `Message.tsx:73` `const { assistant } = useAssistant(message.assistantId)` — 从 Redux `state.assistants[].assistants[]` 全局查
- 分支 user message 的 `assistantId` 等于主 assistant 的 id（同源），所以查得到，但 **Redux assistant 对象的 `.topics[]` 不含 branch topic**（preflight §W4：useBranchFork 故意不 `dispatch(addTopic)` 保持侧边栏干净）
- 取到的 assistant 沿 `resendMessage(msg, assistant)` / `regenerateAssistantMessage(msg, assistant)` 传到 thunks，再到 `fetchAndProcessAssistantResponseImpl(...origAssistant)`
- `messageThunk.ts:854` `origAssistant.topics.find(t => t.id === topicId)` → **undefined**（branch topic 不在 Redux assistant.topics）→ `topic?.prompt` 三元 → 用 origAssistant 原样 → **branch system prompt 丢失** → 模型瞎
- **不是** EventEmitter 缺注册：MessageMenubar 走 hook + props，不依赖 Messages.tsx 顶层的 SEND_MESSAGE/NEW_BRANCH 等事件

**修法（Option 1，已实施，未 commit）**：
- 新建 `src/renderer/src/context/BranchAssistantContext.tsx`：`BranchAssistantOverride` Context（default `null`）+ `useBranchAssistantOverride` reader + `resolveAssistantSource(id, reduxAssistant, override)` 纯函数承载 strict-match guardrail
- `useAssistant.ts` 三行接入：`override = useBranchAssistantOverride()` → `reduxAssistant = useAppSelector(...)` → `assistant = resolveAssistantSource(id, reduxAssistant, override)`。其余逻辑 bit-for-bit 未动
- `Chat.tsx` 计算 synthetic = `{ ...assistant, topics: [...assistant.topics, branchTopic] }` 并用 `<BranchAssistantContext value={...}>` **仅包 `<BranchPane>` 子树**（主聊天在 Provider 外，行为零变化）
- `useBranchFork.ts` 撤掉 `[T-006D-2B watch#1]` / `[T-006D-2B watch#3]` 调试日志（含 promptPreview / setTimeout redux 回读），保留 silent-killer warn 守卫
- 回归测试：`src/renderer/src/context/__tests__/BranchAssistantContext.test.ts` 4 用例覆盖 (1) null override → Redux (2) Provider + 严格匹配 → synthetic (3) Provider + id 不匹配 → Redux (4) stale Provider value → Redux

**待视觉验证**：分支内 regenerate / edit / delete 模型仍聚焦 selectedText；主聊天行为零变化；console 不出现 watch# 字样。

**附带遗留（不在 D-009 修复范围）**：
- **T-006D-2C-5** (preflight cleanup task)：`resendMessageThunk:1340` 和 `regenerateAssistantResponseThunk:1461` 调 `db.topics.update(branchTopicId, ...)` 写 Dexie。分支 topic 仅走 v2 SQLite，Dexie 不存在 → update 0 rows，不抛错也不写入。**功能不受影响**但产生静默状态不一致。Cleanup 留到分支识别机制做完时一起修

## 已 closed 问题

> 关闭判定：自动化修复 + 用户 fresh install 端到端手测确认现象消失。

| ID | 标题 | 关联任务 / 修复 | 关闭日期 | 关闭依据 |
|---|---|---|---|---|
| D-001 | v2 fresh install 创建 Topic 立即 FK 失败 | [T-003](./tasks/T-003_BaselineDebug/) 诊断；[T-004](./tasks/T-004_修复DefaultAssistantSentinel/) 修复 — commit `15ad2eb08` | 2026-05-21 | 用户 2026-05-21 同轮 fresh install 实测 baseline FK 未复现 |
| D-002 | assistant message 写入 SQLite FK 失败（`model_id='qwen'` 非 UniqueModelId） | [T-005A](./tasks/T-005A_AssistantMessageFK/) 诊断；[T-005B](./tasks/T-005B_修复ModelIdFK/) 修复 — commit `15ad2eb08` | 2026-05-21 | 用户 2026-05-21 同轮 fresh install 实测 gemma4:e4b 正常流式回复，无 FK 报错 |
| D-003 | Ollama 自动模型同步失败（Provider 0/0 Enabled + Chat picker 看不到 Ollama） | D-003A 诊断 [T-007](./tasks/T-007_OllamaProviderFix/) + D-003B 修复（`providers.json` 加 `defaultChatEndpoint: "ollama-chat"`）；D-003C 诊断 [T-008](./tasks/T-008_ChatPickerV1V2Gap/) + 评估 [T-008B](./tasks/T-008_ChatPickerV1V2Gap/方案B评估.md) + 实施 [T-008C](./tasks/T-008C_ChatPickerV2Migration/)（chat-model-popup 切 v2 + CHERRYAI fallback） | 2026-05-21 | 用户 2026-05-21 fresh install 实测：Ollama Provider 同步模型 ✅、Chat picker 可选 Ollama ✅、gemma4:e4b 正常生成 assistant 回复 ✅ |
| D-005 | assistant 回复结束后底部 3 个点（BeatLoader）一直转 | [T-009](./tasks/T-009_StreamingNotDispatchedToRedux/) 修复 — `newMessage.ts:275` 取消注释 SUCCESS 转换 + `StreamingService.finalize` 末尾防御性 dispatch | 2026-05-21 | 用户 2026-05-21 fresh install 实测：回复完成后 BeatLoader 消失 ✅、操作栏正常出现 ✅ |
| D-004 | Ask about this / Open as branch 在 assistant 回复文本上仍 disabled | 与 D-005 同源修复（PROCESSING→SUCCESS 转换打通后 MainTextBlock wrapper 正常渲染）；不需要 T-009B | 2026-05-21 | 用户 2026-05-21 fresh install 实测：DevTools 能看到 `role: assistant` 的 `data-message-id` + `data-block-id` wrapper ✅、选中文本后 Ask about this / Open as branch 可点击 ✅ |
| D-008 | 分支 panel 内消息流无法滚动，超出一屏的内容看不到 | 主对话 fork 分支 → 让分支 assistant 生成超长 markdown → 分支 panel 内无 scrollbar，底部被裁切 | T-006D-2B 范围；修 = `RowFlex` 加 `h-full`（主聊天靠 `<Main style={height: mainHeight}>` 强撑高度，不依赖 RowFlex；BranchPane 不带这个 override，h-full 链断在 RowFlex 处）；同时 BranchPane motion.div 加 `h-full` 作 belt-and-suspenders；BranchMessageStream 自挂 `overflow-y-auto`；删除 jsdom 跑通但实际无效的 false-green scroll 单测 | 2026-05-22 | 用户 2026-05-22 视觉验证：long branch reply 可滚 ✅、quote box 留在 scroll 上方 ✅、宽窄不同 branch width 都能滚 ✅ |
| D-009 | 分支 panel 内 regenerate / edit / delete 让模型瞎（系统提示丢失） | 主对话→选 assistant 文本→Open as branch→Create→在分支 assistant 消息上点 regenerate → 回复跑偏 | T-006D-2B 范围；根因 = `Message.tsx:73 useAssistant(message.assistantId)` 从 Redux 全局查 → branch topic 不在 `assistant.topics` → `messageThunk:854 origAssistant.topics.find(...)` 拿不到 → `topic.prompt` 三元回 origAssistant 原样 → branch system prompt 丢失。修 = **Option 1 (BranchAssistantContext)** — 新 Context（default null）+ `resolveAssistantSource` 纯函数承载 strict-match guardrail（4 用例回归测试）+ Provider 仅包 BranchPane 子树 + 撤掉 watch#1/watch#3 调试日志。**不是** EventEmitter 缺注册（MessageMenubar 走 hook + props，不依赖 Messages.tsx 顶层事件） | 2026-05-22 | 用户 2026-05-22 视觉验证：分支内 regenerate / edit / delete 模型仍聚焦 selectedText ✅、主聊天行为零变化 ✅、console 不出现 watch# 字样 ✅ |
| D-010 | S6' source-passage 高亮在 app 里看不见 | 打开分支 → 主对话源 block 无可见高亮（但 `data-branch-anchored` 属性在、测试通过） | T-006D-2B S6' 范围；静态追溯定论（分支能成功创建 ⇒ findBlockContext 返回有效 id ⇒ MainTextBlock 端 match 必成立 ⇒ tint 已应用）。根因 = 首版用 `bg-accent/60`：`--color-accent` light = `oklch(0 0 0 / 0.05)`（5% 黑叠加）再被 `/60` 乘 → ≈3% 黑，白底肉眼不可见。修 = 换 DESIGN.md `--color-warning-bg`（amber-50/900）暖琥珀荧光笔色（`alert.tsx` warning variant 有先例） | 2026-05-22 | 修复方向正确（amber 色），但粒度问题暴露 D-011 → 见下 |
| D-011 | S6' 高亮亮整条回复，不是选中段 | 打开分支 → 主对话整条 assistant 回复被高亮，而非用户选中的那句 | T-006D-2B S6' 范围；根因 = **一条完整 assistant 回复 = 单个 MAIN_TEXT block**（`Blocks/index.tsx:193-194` MAIN_TEXT/CODE/UNKNOWN 全路由 MainTextBlock；长回复 heading/section 全在该 block 内由 Markdown 渲染）。所以 messageId→blockId 收窄无效：只有 1 个 block ⇒ block-level == 整回复。修 = **精确选区高亮**：捕获 char offset + CSS Custom Highlight API 画 Range。修复方向正确但实现有缺陷 → 见 D-012 | 2026-05-22 | 方向正确，但高亮不显示 → D-012 |
| D-012 | S6' 精确高亮完全不显示 | 打开分支 → 主对话源选区无任何可见高亮 | T-006D-2B S6' 范围；无法实跑 DevTools，按两个 suspect 一并加固。**A（offset drift）**：capture 用 `Range.toString().length`、rebuild 用 text-node `.length` 求和 —— 两套遍历在真实 markdown DOM（粗体/列表/跨节点）理论上等价但用户实测不显示 → 改两边共用 `flattenTextNodes`（TreeWalker SHOW_TEXT）同一坐标系，capture 不再用 toString，element-node 端点用 `compareDocumentPosition` 折算。**B（注册了但不可见）**：`::highlight()` 用 `var(--color-warning-bg)` —— ① amber-50 在白底文字后几乎不可见 ② `var()` 在 `::highlight()` pseudo 内解析不可靠 → 换 concrete `rgb(251 191 36 / 0.45)`（amber-400 45% alpha）。另：`paintSourceHighlight` 加诊断日志（resolve 失败 warn / 成功 debug）供 console bifurcate；MainTextBlock effect 加 rAF 兜底重绘。教训：jsdom round-trip 测试在简单 fixture 通过 ≠ 真实 markdown DOM 正确（同"假绿 scroll 测试"陷阱）| 2026-05-22 | 修复方向（精确选区 + Highlight API）正确，但仍不显示 → 转 D-013 全路径 instrumentation |
| D-013 | S6' 高亮三轮 blind-fix 后仍不显示 | 同 D-012 现象 | T-006D-2B S6' 范围；**助手无法实跑 app，盲修循环靠运行时 trace 打破**。首轮加 5 阶段 reader 端 `[S6 trace]` 日志。**trace 回报**：每条 `effect fired` 恒 `highlightedBlockId: null, matched: false` —— effect 正常 fire、`block.id` 在，但 `highlightedBlockId` 永远 null → 选中 block id 没传到 `BranchAnchorContext`，**非 offset/CSS 问题**。**本轮静态审查**：字段名 `highlightedBlockId` 三处一致无 rename 残留 / Provider 正确包 `<Messages>` / `branchAnchorHighlight` useMemo 读 `branchAnchor.blockId` / `buildAnchor` 写 `blockId: blockContext.blockId` / 透传链 `onOpenBranchPanel→onOpenBranchAnchor→setBranchAnchor` / 渲染链 `Messages→…→MainTextBlock` 连续 React 子树（Radix ContextMenu 只 Portal menu content，不 Portal children）—— **静态层面找不到 wiring break**。加 Stage 0 setter 端日志（`Chat.tsx` `branchAnchorHighlight` useMemo）。**范围锁定**：grep 全仓确认只有**一个** `branchAnchor` holder（Chat.tsx:68），`BranchPane`/`BranchComposer` 的 `anchor` 均为 prop 无 local 副本 → 排除「双 source of truth」假设。单 source + Provider 包子树 ⟹ Stage 0 ≡ Stage 1 ⟹ trace 的 null 必源于 `branchAnchor.blockId` 是 undefined（branchAnchor 本身非 null —— quote box 只用 `anchor.selectedText` 渲染，不碰 blockId）。锁定 `findBlockContext`/`buildAnchor` 的 blockId 字段。**本轮加 `findBlockContext` 诊断日志**：resolve block 元素 + 读 blockId 处打 `selectionAnchorTag / foundBlockEl(tag) / dataBlockIdRaw / dataMessageIdRaw / queriedBlockAttr` + 返回前打 `returnedBlockId`。两个 suspect：① `data-block-id` 属性名代码查的 ≠ DOM 渲染的，或属性不在 DOM ② React `<p> cannot contain <div>` —— `<div data-block-id>` 被 markdown 渲染进 `<p>` 浏览器 reparent → `closest('[data-block-id]')` 错位 | 2026-05-22 | **trace 突破**：`findBlockContext` 返回有效 `d13a7253`、`branchAnchorHighlight set` 写 `d13a7253`（非 null）—— 但 `effect fired` 全是 `cf1ecb91`、选中的 `d13a7253` 从未 effect fired。⇒ setter 写入、reader 读不到，主对话源 block 没收到 context 更新。调查渲染链连续 / Provider 包对 / 无双 module 实例 —— 静态找不到 break。本轮加 `MainTextBlock` context-read 日志（render body 打 `{ blockId, rawContext }`）。**本轮（用户回报三组 trace + 实跑静态搜索）**：trace 显示 `findBlockContext` 与 Chat Stage 0 都写有效 `019e503e-…-block-1`（非 null），用户称 `blockId=019e503e-…-block-1` 的 context-read 读到 `rawContext.highlightedBlockId: null`。按要求 grep 全仓 `BranchAnchorContext` 全部 provider —— 确认全仓**只有一个** `<BranchAnchorContext value={branchAnchorHighlight}>`（Chat.tsx:265，React19 `<Context value>` 形式、无 `.Provider`、无无-value provider），包 `<Messages>`；MainTextBlock 与 Chat.tsx 同一 import path、`useBranchAnchorHighlight` 读同一 context object。**关键发现**：`BranchMessageStream.tsx:7` 复用同一 `MessageGroup→MainTextBlock`，而 `BranchPane`（Chat.tsx:322）是 `<BranchAnchorContext>` 的**兄弟节点（Provider 外）** → 分支面板内所有 MainTextBlock 读默认 null。当前 context-read 日志只打 `blockId`、无法区分主对话块（Provider 内）与分支面板块（Provider 外）→ 用户看到的 null 极可能是分支面板块 / branch 打开前旧 render 行的误读。`DataApiMessageDataSource.ts:91` `${id}-block-${i}` —— `-block-1` 后缀是合法 block.id 格式，排除「伪造 id 遮蔽」嫌疑。**本轮加 step-4 引用判别器**：context 模块导出 `BRANCH_ANCHOR_DEFAULT` 常量；context-read 日志加 `insideProvider`（`received !== BRANCH_ANCHOR_DEFAULT`，React `use()` 无 Provider 时按引用返回 default）；effect-fired 日志加 `selectionStart/End` + `earlyReturn` 原因（`not-anchored`/`no-element`/`empty-offsets`）；Chat Stage 0 加 `writtenSelectionStart/End`。下一次运行一次性判定 provider + offsets | 2026-05-22 | 静态结论：全仓单一 provider、源 block 结构上必在其内 → 「读 null」基本是 trace 误读。待 `insideProvider`/`earlyReturn` trace 终判：`insideProvider:false`=分支面板块忽略；`insideProvider:true`+`rawContext` null=真 plumbing bug；`insideProvider:true`+真值+`earlyReturn:empty-offsets`=offset 捕获失败（最可能） |
| D-013-FIX-DISPROVEN | **HMR context 分裂理论被推翻** —— 冷启动重现：用户 `rm -rf` CherryStudioDev userData + fresh `pnpm dev` → trace 仍 `highlightedBlockId:null/matched:false/earlyReturn:not-anchored`。HMR 多代累积无法解释冷启动失败 → 上一轮 globalThis 单例化没改变 trace（若 HMR 是因、修生效则 matched 应为 true）。另：`earlyReturn:'not-anchored'` 只代表「该块非选中」，多数块本应如此 —— 整屏 not-anchored 不证明任何东西。修代码保留（singleton 在 prod 也无副作用），但**不是 S6' 高亮失效的根因**。本轮**严格不提新理论**，只补一个缺失字段：effect-fired 日志加 `insideProvider`（context-read 已有），等用户选具体段落 → 报告该 blockId 那条 effect-fired 的 `insideProvider/highlightedBlockId/matched/earlyReturn/selectionStart/selectionEnd` + 同次 Chat Stage 0 的 `writtenHighlightedBlockId`，做一对一比对收尾 | 2026-05-23 | 等用户跑定向 trace 比对 |
| D-013-PIPELINE-OK | **整条 wiring 已经走通** —— 选中块 trace 实测：`matched:true / insideProvider:true / earlyReturn:null / highlightedBlockId 一致 / selectionStart:1440 / selectionEnd:1550`。Context + blockId + offsets + effect 执行全部正确，**上一轮 HMR/Provider 修工作了**（context 分裂的确曾在 wiring 链上发生过，只是不是高亮不显的最终原因）。残留唯一失效点：`paintSourceHighlight` 跑、但产不出可见高亮。本轮**只加 instrumentation**：`sourceHighlight.ts` `paintSourceHighlight` 在 `highlightsRegistry.set` 之后加 `[S6 trace] paint detail` 整合日志，输出 `rangeResolved / rangeCollapsed / rangeText(60chars) / blockTextLength / startContainerType / endContainerType / afterSet{has, size}`。核心要回答：rebuilt Range 的 `rangeText` 等不等于用户实选段落？等 → 失败在 CSS Highlight API 渲染（兼容/层叠/被覆盖）；不等/空/collapsed → capture-time 与 paint-time 的 offset 坐标系漂移（早期就在嫌疑名单上、被上游 wiring bug 掩盖至今） | 2026-05-23 | 等用户跑 trace 贴 `paint detail` 一行 |
| D-013-HARDEN | **span-wrap 注入 React-owned DOM 的 4 项 robustness 不变量核验** | 用户视觉验证 span-wrap 工作（spanCount:2，暖琥珀位置正确）后要求 harden 4 项：清除、抗重渲、不破坏 copy/格式、切换 anchor。**全部由现有代码满足、零修改**：(1) `clearSourceHighlight` 用 `querySelectorAll` + 子节点回搬 + 父级 `normalize()` —— 字节级 DOM 复原；头部空集早退、idempotent。(2) `paintSourceHighlight` 体内首行 `clearSourceHighlight()` —— effect sync + rAF + StrictMode 双跑/deps 重触都不增长 `spanCount`；React 静默擦的兜底为 `React.memo + 稳定 block.content`，源助手消息完成态下 ReactMarkdown 对账 = 同 vnode = 不动 DOM = span 留存；若实测确实出现「分支已开、span 自消」场景，下一轮加 `MutationObserver` 重涂（暂 YAGNI）。(3) span 在 markdown 元素内（不跨边界），父级 strong/em/a/code 样式继承不变；`.branch-anchor-highlight` 仅 `background-color` 无干扰；`Text.splitText` 不改字符 → `Selection.toString()` 输出同串、copy 正确。(4) anchor A→B 切换由 React effect 生命周期 + paint-clears-first 自动处理：A 块 cleanup 全文擦 A 的 span、B 块 effect paint(clear + wrap B)，任意时刻只有当前 anchor 的 span | 2026-05-23 | 代码零改动；等用户跑 verification pass（① 关后 DOM 搜 `branch-anchor-highlight` 应 0 个 ② 选 A→选 B 切换 ③ copy 文字无异常 ④ bold/链接 boundary 视觉正常） |
| D-013-DEFER-Y | **orphan branch topic 关闭后留 SQLite 行 —— 显式 deferred 不是遗忘** | `BranchPane.onComposeCancel` 与 close UI 只调 `setBranchAnchor(null)` + `branchFork.reset()`，已创建的 branch topic 不走 DELETE `/topics/:id` —— 关闭后 SQLite `topics` 表残留行。这是 preflight "path Y = delete on close" 早期 deferred 项，落在 T-006D-2C-5 cleanup。本任务（S6' span-wrap harden）**不处理**；本条目仅把它从「容易忘」改为「显式记录」 | 2026-05-23 | 显式 deferred；T-006D-2C-5 cleanup 时一并处理（POST → DELETE 一对一对偶 + Chat.tsx 关闭路径加 mutation） |
| D-013-FIX-FINAL | **CSS Custom Highlight API 在 Electron/Chromium + markdown DOM 不出像** —— 用户 trace 回报 `paint detail`：`rangeResolved:true / rangeCollapsed:false / rangeText 与选中段精确一致 / start,end 均 #text / afterSet.has:true,size:1` —— Range 完美、Highlight 已注册，依然无像素。触发既定 stop-loss，**放弃** CSS Custom Highlight API，切到 `<span>` 包裹方案。**保留**全部已被 trace 证实工作的上游：context/provider wiring、blockId 匹配、`captureSelectionOffsets` / `resolveBranchHighlightRange`。**只替换最终 paint 步**：用 resolved Range 的 startContainer/endContainer 与 `flattenTextNodes` 切片得到跨节点 in-range Text 集合，逐节点 `Text.splitText` 剥出 in-range 子串、移入 `<span class="branch-anchor-highlight">`（不能用 `Range.surroundContents()`，跨 `<strong>`/`<em>`/`<code>` 元素边界会抛）。`clearSourceHighlight` 走 `querySelectorAll('span.branch-anchor-highlight')` → 把 span 子节点搬回父节点、删 span、`parent.normalize()` 合并相邻 Text 节点 —— DOM 恢复原状。idempotent：`paintSourceHighlight` 总先 `clear` 再 wrap，effect 同步 + rAF 双跑也只剩一组。颜色用 concrete `rgb(251 191 36 / 0.45)` (amber-400 @ 45%)，不用 CSS var（D-010 教训）。`isHighlightApiSupported` / `HIGHLIGHT_NAME` / `CSS.highlights` 全部删。React fight 风险：源助手消息已完成、`block.content` 稳定 → ReactMarkdown 不重渲、注入的 span 不会被擦；如果遇 fight，下一轮再讨论 overlay 层方案。保留单条 `[S6 trace] span wrap injected` 输出 `spanCount` + 第一 span 文本（视觉验证后撤）。typecheck:web ✅ | 2026-05-23 | 等用户视觉验证（暖琥珀可见 + 关分支后 DOM 干净）；旧 `sourceHighlight.test.ts` 测的是 CSS.highlights，需重写为 span 断言（验证后下一轮处理） |
| D-013-FIX | ~~S6' 高亮根因 = `BranchAnchorContext.tsx` HMR 下被重复执行、context 对象分裂~~（被冷启动证据推翻，见上行） | 用户回报：**每一条** `[S6 trace]` 行（含 context-read 与 effect-fired）均 `insideProvider: false / earlyReturn: 'not-anchored' / highlightedBlockId: null`，无一行 `insideProvider:true`，连主对话块都不在 Provider 内 | 推翻上轮「源 block 必在 Provider 内」演绎。**逐文件再核验渲染链**（`Messages.tsx`/`NarrowLayout.tsx`/`SelectionContextMenu.tsx`/`MessageGroup.tsx`/`Message.tsx`/`MessageContent.tsx`/`Blocks/index.tsx`/`Scrollbar`）—— 全链路 grep `createPortal`/`createRoot`/`ReactDOM` 零命中、`<ContextMenuTrigger asChild>` 内联渲染 children、antd `Popover` 只 portal overlay 不 portal children、`MessageEditingProvider` 是普通 context provider 不破坏树。**树确实连续**。**根因**：`BranchAnchorContext.tsx` 只导出 type/常量/context/hook，**全部非组件** → 不是 `@vitejs/plugin-react` Fast Refresh-eligible 模块 → 本会话 ≥3 次编辑（D-011 创建、D-012 改、D-013 加 `BRANCH_ANCHOR_DEFAULT`）令 Vite 反复重新执行该模块及其 importers；每次重新执行 `createContext(...)` 都产生**新对象**。Chat.tsx 的 Provider 元素与 MainTextBlock 的 `use(BranchAnchorContext)` 在 fiber 树各持不同 context 对象 → consumer 读各自模块版本的 default → `insideProvider:false`，与「树连续 + 形式正确的 Provider」完全自洽。对照证据：`BranchAssistantContext`（D-009）能用 = 本会话**未再编辑** = 一次执行无 HMR-replay。**修**：context 对象拽到 `globalThis.__BRANCH_ANCHOR_CTX_CACHE__` 单例化（React 社区对 HMR-context 分裂的标准修法），用 `globalThis.__X ??= createCache()` 保证模块再执行只创建一次；`BRANCH_ANCHOR_DEFAULT` 同源 cache 出，让 `insideProvider` 引用判别在 HMR 后也稳定。改 `BranchAnchorContext.tsx` 一处；typecheck ✅。**用户须做**：拉本轮后**完整重启 `pnpm dev`**（仅 reload 不够 —— 残留 fiber 仍持旧 context 对象）；重启后 `[S6 trace] MainTextBlock context read` 主对话块应 `insideProvider:true`、effect-fired 应 `matched:true` + `earlyReturn:null`、`paintSourceHighlight` 绘暖琥珀 | 2026-05-22 | 修复已落 `BranchAnchorContext.tsx`；待用户重启 dev 视觉验证（**未 commit**）。后续如 `BranchAssistantContext` 也将频繁编辑，可应用同 pattern |
| D-013-CLEANUP-LEAK-FIX | **`clearSourceHighlight` 留 leftover + 空 shell** | 切换 anchor 后 DOM 里发现两种残留：(a) 完整未被清的旧 span `<strong><span class="branch-anchor-highlight">深度学习框架，构建AI模型。</span></strong>` —— 即 cleanup 完全没碰到它；(b) 空壳 `<span class="branch-anchor-highlight"></span>` —— 子节点搬走但 span 元素留了 | 旧 `clearSourceHighlight` 走 `while (span.firstChild) parent.insertBefore + parent.removeChild(span)` **两步**操作。两步之间 React reconciliation 动 DOM 时 `removeChild` 会 race 出 shell 残留；cleanup timing 与 React commit timing 错开时整个 cleanup 可能根本没到这个 span。**修**：改用单原子 DOM 原语 `span.replaceWith(...Array.from(span.childNodes))` —— 同时移除 span 与插入子节点，无中间状态；空 span 走 `replaceWith()`（零参）自动单纯移除。`document.querySelectorAll` 全文搜不依赖任何存储引用（React 重渲后旧 ref 失效是 leftover 真因）。改 `sourceHighlight.ts` `clearSourceHighlight` 一处；typecheck ✅ | 2026-05-23 | 已修；用户验证 baseline 0 → 开 A 5 → 切 B 3（不累积）→ 待 close path（D-013-CLOSE-PATH）做完后才能验最终 close→0 |
| D-013-CLOSE-PATH | **Branch Panel 关闭路径未连通** | Conversation 状态（已 fork、`branchTopic !== null`）下，X 按钮被旧逻辑 `disabled={!isComposing}` 锁死 —— 无法关闭；分支一旦创建，前端 state 永挂着 `branchAnchor + branchTopic`，highlight 永不清 | **改 3 处**：(1) `BranchPane.tsx` 删掉 `disabled={!isComposing}`，X 在两态都启用；tooltip 统一 `close`。(2) `Chat.tsx` 的 `onComposeCancel` 扩展为完整关闭：`clearSourceHighlight()` 同步擦 span（panel collapse 前 DOM 已干净、无视觉闪烁）→ `setBranchAnchor(null)` → `setBranchTopic(null)`（驱动 `isVisible=false` 触发 motion.div 收起）→ `branchFork.reset()`（fork status 回 idle）。(3) `BranchPane.test.tsx` 反转 `close button is DISABLED in conversation state` 断言为 enabled + calls handler。**显式 deferred**：关闭不调 `DELETE /topics/:id` —— 已 fork 的 branch topic 仍留 SQLite `topics` 表（path Y / delete-on-close 归 T-006D-2C-5 cleanup） | 2026-05-23 | 已修；用户视觉验证（compose-state X / conversation-state X 都能关；关后 highlight + panel 同步消失） |
| D-013-CLOSED | **S6' source-passage highlight 全链路完成 + 验证通过 —— DO NOT 重试 CSS Custom Highlight API** | （上面 D-010 → D-013-CLOSE-PATH 全链） | **最终方案**：span-wrap (`<span class="branch-anchor-highlight">`) + `replaceWith` 全局清扫 + `globalThis` Context singleton + Chat 关闭路径显式调 clear。详见 [[../tasks/T-006_TextAnchorBranchUI/T-006E_Highlight/README\|T-006E README]]。**Verification 通过**（2026-05-23）：baseline 0 → 开 A → 5 → 切 B → 3（不累积）→ 关闭 → 0 → 空 span 0 → 反复 open/switch/close 5-6 轮 → 永远在 close 回 0、永无 shell。**禁忌（future-you red list）**：① 不要重新尝试 CSS Custom Highlight API（trace 实证本 Electron/Chromium + markdown DOM 环境零渲染，注册却成功，是真零像素不是判错）② 不要用 `range.surroundContents`（markdown 选区常态跨边界、抛 INVALID_STATE_ERR）③ 不要把 `clearSourceHighlight` 退回 `while/insertBefore/removeChild` 两步（会留 shell）④ 不要从 `BranchAnchorContext.tsx` 删 `globalThis ??=` 单例化（删了之后编辑该文件就 HMR-replay 产生 context 分裂）⑤ 不要从 `Chat.onComposeCancel` 里删显式 `clearSourceHighlight()`（effect cleanup 兜底但有视觉闪烁）。**已知遗留**（不在本任务范围）：① 关闭分支不删 SQLite topic 行（path Y / T-006D-2C-5）② 切 topic 离开再回来高亮不恢复（anchor 不持久化、未来 v1.1） | 2026-05-23 | ✅ closed；代码未 commit（用户自管 git） |

## 命名约定

- `D-NNN` —— issue 编号，单调递增，跨任务跨日不重置
- 一条 issue 在被工程任务关闭前，始终列在「当前 open」
- 关闭时移到「已 closed」并记录关闭日期 + 关闭 commit / 任务

## 模板（新增 issue 时）

```markdown
| D-XXX | 简短标题 | 一句话复现步骤 | 🔴阻塞 / 🟡 影响功能 / 🟢 小毛刺 | T-YYY | tasks/T-YYY_*/诊断.md |
```

---

## D-003 详细记录

> **记录日期**：2026-05-20 深夜
> **D-003A 诊断完成**：2026-05-21（T-007）
> **D-003B 修复实施**：2026-05-21（T-007）—— `providers.json:425` 加 `"defaultChatEndpoint": "ollama-chat"`，自动化校验过，用户 fresh install 验证 Provider 设置页 ✅
> **D-003C 诊断完成**：2026-05-21（T-008）—— Chat 弹窗仍读 v1 Redux，与 v2 DataApi 无桥接；CherryAI 显示是 selector 硬编码
> **T-008B 方案 B 可行性确认**：2026-05-21 —— 实际只需改 1 文件 ~50 行
> **T-008C 方案 B 实施完成**：2026-05-21 —— `chat-model-popup.tsx` 数据源切 v2 + CHERRYAI fallback 保留；下游 0 改动；自动化 98/98 ✅
> **D-003 端到端手测通过**：2026-05-21 —— Provider 同步 ✅、Chat picker 可选 Ollama ✅、gemma4:e4b 正常生成 assistant 回复 ✅；同轮顺带验过 D-001/D-002 baseline FK 不复现
> **状态**：✅ **D-003 已 closed**（A/B/C 三段全部修复 + 手测通过）
> **完整诊断/实施**：[T-007](./tasks/T-007_OllamaProviderFix/) + [T-008](./tasks/T-008_ChatPickerV1V2Gap/) + [T-008C](./tasks/T-008C_ChatPickerV2Migration/)
> **手测步骤**（历史参考）：[T-007 验证](./tasks/T-007_OllamaProviderFix/验证.md) + [T-008C 验证](./tasks/T-008C_ChatPickerV2Migration/验证.md)

### 现象（用户观察，未代码验证）

| 维度 | 观察 |
|---|---|
| **Ollama 本身** | ✅ 正常 —— `ollama list` 能看到本地模型；`curl http://localhost:11434/api/tags` 正常 JSON；`curl http://localhost:11434/v1/models` 正常 JSON |
| **Cherry Studio Ollama Provider 显示** | ❌ "Model list 0/0 Enabled" |
| **Select Model 弹窗搜索** | ❌ 搜 "ollama" 无结果 |
| **日志关键字** | `Provider auto model sync failed` / `Invalid JSON response` |
| **Ollama 设置页 UI 异常** | ⚠️ 疑似显示了 **Anthropic 风格字段**：`Anthropic API Host`、`/v1/messages` —— 这本不该出现在 Ollama 配置里 |

### 复现步骤

1. 已修复 T-004 + T-005B 的状态下启动 `pnpm dev`（即 baseline FK 都通了）
2. 本机已运行 `ollama serve`，且 `ollama list` 有至少 1 个模型
3. 在 Cherry Studio 设置中找到 Ollama Provider
4. 观察：模型列表为空、auto sync 报错、Select Model 搜不到

### 根因（T-007 诊断确认）

`packages/provider-registry/data/providers.json` 里 Ollama 条目**没有 `defaultChatEndpoint` 字段**，且 endpointConfigs 同时含 `ollama-chat` 和 `anthropic-messages`。`getProviderHostTopology.resolvePrimaryEndpoint` 的优先级表是 `[openai-chat-completions, openai-responses, anthropic-messages, google-generate-content, ollama-chat]` —— Ollama 在前两位都没有，于是**第 3 位 `anthropic-messages` 命中**（永远轮不到第 5 位的 `ollama-chat`）。

三个错位现象同源：

1. **form 渲染 Anthropic 字段** —— `ApiHost.tsx:65–82` 用 `primaryEndpoint === 'anthropic-messages'` 切换组件 → 渲染 `AnthropicApiHostField`（i18n key `settings.provider.anthropic_api_host`，副本预览带 `/v1/messages`）。
2. **auto sync 用错 type** —— `v1ProviderShim.v1ProviderTypeFromV2` 在 `defaultChatEndpoint` 为 null 时 fallback 到 `OPENAI_CHAT_COMPLETIONS` → switch 走 `default: return 'openai'`。
3. **auto sync 用空 apiHost** —— `v1ProviderShim.defaultChatBaseUrl` 同样 fallback 到 OPENAI_CHAT_COMPLETIONS → 查 `endpointConfigs['openai-chat-completions'].baseUrl` 不存在 → 返回 `''`。Legacy AiProvider 拿到 `{ type: 'openai', apiHost: '' }` 去请求模型列表 → 命中 OpenAI 默认 host 或空 URL → 非 JSON 响应 → "Invalid JSON response"。

横向对照：63 个 provider 里有 8 个没写 `defaultChatEndpoint`，其中 ovms / new-api / lmstudio 的 endpointConfigs 含 `openai-chat-completions` → 优先级表第 1 位命中 → "运气好"没事。Ollama 是**唯一一个主端点 key 不是 OpenAI 兼容**且缺 `defaultChatEndpoint` 的 provider，所以单点暴雷。

### 跟既有 baseline bug 的关系

- 与 T-004 / T-005B 不同：这两个是 **v2 数据层 FK 校验失败**（fresh install 状态下数据缺失）
- D-003 看起来更像是 **provider 配置层 schema/数据错位**（PresetProviderSeeder 或 provider form 的 bug）
- 不属于已经修过的「v1 sentinel / 短 id 类」同源链路

### 影响范围

- ✅ **不阻塞** Expand Branch UI-only 原型 —— UI 原型走 mock `BranchMessagesResponse` 数据驱动
- ✅ **不阻塞** baseline 二连修的手动验证（topic 创建、message 写入都不依赖 Ollama）
- ⚠️ **阻塞** "用 Ollama 做真实模型回复测试" —— 选不到 Ollama 模型 → 没法发到 ollama → 流式回复测不出来
- ⚠️ **阻塞** Ollama 用户的端到端可用性（这是产品功能层，不是工程 baseline 层）

如果只是要测真实 AI 回复，**临时绕路**：手动添加一个非 Ollama provider（OpenAI / Anthropic 等只要 API key 通），不阻塞 Phase 3。

### 已实施修复（D-003B，2026-05-21）

在 `packages/provider-registry/data/providers.json:425` 给 Ollama 条目加一行：

```diff
   {
     "id": "ollama",
     "name": "Ollama",
     "description": "Ollama - AI model provider",
+    "defaultChatEndpoint": "ollama-chat",
     "endpointConfigs": { ... }
   }
```

Schema 安全（`ProviderConfigSchema.refine` 只要求该值是 endpointConfigs 的某个 key，`ollama-chat` 符合）。

**自动化校验已过**：
- seeder 测试 4/4（real RegistryLoader + zod schema + DB row transform）
- ApiHost / useProviderAutoModelSync / useProviderEndpoints 共 16/16
- typecheck:web + typecheck:node 静默通过

⏳ 手动 fresh install 验证步骤见 [tasks/T-007_OllamaProviderFix/验证.md](./tasks/T-007_OllamaProviderFix/验证.md)。

这一行同时治三个错位：

| 现象 | 修复路径 |
|---|---|
| form 显 Anthropic 字段 | `resolvePrimaryEndpoint` 在 `provider.defaultChatEndpoint` 上短路 → `'ollama-chat'` → `isAnthropicPrimaryEndpoint = false` |
| sync 用 `type: 'openai'` | `v1ProviderTypeFromV2` 的 `ep = v2.defaultChatEndpoint` = `'ollama-chat'` → switch 命中 OLLAMA_CHAT → `'ollama'` |
| sync 用空 apiHost | `defaultChatBaseUrl` 同一路径 → `endpointConfigs['ollama-chat'].baseUrl` = `http://localhost:11434` |

详细验证步骤见 [tasks/T-007_OllamaProviderFix/诊断.md §5](./tasks/T-007_OllamaProviderFix/诊断.md)。

**未做 / 待后续**：

- 老用户 DB 升级路径（已入库 `defaultChatEndpoint = null` 的行如何迁移到 `'ollama-chat'`）—— 待用户决定是否做迁移或要求 fresh install
- 把 `defaultChatEndpoint` 改为 schema required（cleanup task）
- 调整 `PRIMARY_CHAT_ENDPOINT_PRIORITY` 顺序（防御层，影响面大，不必要）

### 引用

- 索引一行：见上方 §当前 open 问题
- 影响 / 风险定位：[../01_Project/风险与限制.md#R0.3](../01_Project/风险与限制.md)
- 是否阻塞 Phase 3：见 [当前状态.md](./当前状态.md)

---

## 分支面板 S2b-3 → S2c 调试弧（B1–B5 + merge；2026-06-03）

> 背景：P1-S2b-3「sticky-stacking via `display:contents`」在 dev-smoke 一次性暴露 5 个缺陷(B1–B5);随后 S2c master/detail 又暴露一个 merge 变体。下表 + 详记是这一弧的诊断落档(之前只在会话里)。

| ID | 标题 | 引入 vs 既存 | 状态 |
|---|---|---|---|
| **B1** | 双流卡片重叠/串位 | **S2b-3 引入**(display:contents+手搓 sticky)| ✅ 已修(S2c accordion 真实盒子 + shrink-0) |
| **B2** | 关两个分支后第三个开不出 | 多半 = B4 或 S2b-1 stale-ref(既存)| ⏳ 待复现确认(随 accordion 可能已缓解;归 S2d/排查) |
| **B3** | 初始/follow-up composer Enter 不发送 | 初始 `BranchComposer` 从无 keydown(既存)+ 跟随偏好 | ✅ 已修(共享 `composerKeyboard` + forceEnterToSend,初始+follow-up 共用) |
| **B4** | 开关一次分支后右键 "Open as branch" 变灰 | **既存**(菜单 gating/findBlockContext/高亮 paint-clear 全在未动文件)| ✅ **已调查 = 非 bug**(菜单逻辑正确;重选即恢复;实证 STEP3 ENABLED)|
| **B5** | 流式中关闭分支不中止,回复继续 | **既存**(`handleCloseBranch` 自 S2b-1 起从不 abort)| ✅ **已修(未提交)**:close 前 `abortBranchTopicStream` 复用 abortCompletion |

### B1（核心,已修）
- **根因**:S2b-3 把 `BranchCard` 外层设 `display:contents`(无盒子)+ 每个 header `position:sticky` 递增 `top` → 所有 header 共享滚动容器为 containing block、同时常驻并叠在下方 body 上;双流增长时视觉交叉。
- **S2c 第一版(master/detail)**留下 merge 变体:detail 盒子 `flex min-h-0`(默认 `flex-shrink:1`、无 overflow)在高度有界的 `overflow-y-auto` 区里被 flex **压缩到比内容矮** → 内容溢出叠到下一个盒子(混态 conversation+compose 最明显);`overflow-y-auto` 因"压缩装下了"从不滚动。
- **修**:① 盒子 `shrink-0` + 去 `min-h-0`(自然高度,区接管滚动);② 最终 accordion 把"两区"并成单滚动区 + 标题贴内容(§3b 定稿)。**绝不用** sticky/display:contents。

### B3（已修）
- **根因**:`chat.input.send_message_shortcut` 默认 `'Enter'`,但 composer 跟随用户偏好(实例非纯 Enter)→ Enter 落换行;且**初始 `BranchComposer` 根本没接 keydown→submit**。
- **修**:共享 `composerKeyboard.ts` 唯一 `handleBranchComposerKeyDown`(`isSendMessageKeyPressed(event,'Enter',true)` 覆盖偏好 + IME 守卫),初始 + follow-up composer 共用。

### B4（已调查 = 非 bug，2026-06-03）
- **机制**:右键菜单 `disabled={!hasAnchor}`(`SelectionContextMenu.tsx:166,178,181`),`hasAnchor` = `hasSelection && blockContext!==null && role==='assistant'`,且 `handleOpenChange`(`:98-111`)**每次右键都重读** `window.getSelection()`,**无任何持久 gating flag**。
- **实证**(jsdom 临时复现,跑完即删):有选区→ENABLED;开分支后(选区被 `paintSourceHighlight` 的 splitText 打散)无选区→DISABLED(正确);**关闭后做新选区→ENABLED(STEP3)**。
- **结论**:**菜单逻辑正确,不是 menu-side/state-side bug**。"变灰"是菜单如实反映"当前没选区"(开分支 paint 把 live 选区打散了)。**重新选中文本即恢复**。
- **唯一能让"开分支后选区不丢"的修法** = 在 paint 时保存/恢复选区,触 `sourceHighlight.ts`(保护区)→ **不做**;现状可接受(重选即可)。

### B5（✅ 已修，未提交，2026-06-04）
- **机制**:`Chat.tsx handleCloseBranch`(S2b-1)只 `clearSourceHighlight + 移除 branch`,**从不 abort**。中止机制 = `abortCompletion(askId)`(`utils/abortController.ts:23`),key = `messageThunk` 发起时 `addAbortController(userMessageId,…)`(`:670/926`,userMessageId = 流式 assistant 消息的 `askId`)。
- **修(本步)**:新 `BranchPanel/abortBranchTopicStream.ts`(镜像 `useMessageOperations.pauseMessages:137-147`,scoped 到一个 topic:`selectMessagesForTopic(topicId)` → 过滤 `processing/pending` → `askId` → `abortCompletion`);`Chat.tsx handleCloseBranch` 关分支**前**先 `const branchTopicId = branches.find(b=>b.id===branchId)?.topic?.id; if(branchTopicId) abortBranchTopicStream(branchTopicId)`,其余 close 行为不变(仍只移除 + clear,不删 topic = S3)。
- **只 CALL 现有 abort,未改 StreamingService/messageThunk/abortController 内部**(git diff 全空);非流式分支不 abort;测试 5 + mutation 非空转。
- **未做(归后续)**:删 forked topic = **S3 disposition**。

### 测试缺口教训
- jsdom **无布局引擎** → "视觉不重叠 / 标题滚走 / 滚到顶"**单测测不了**。S2c 用**结构不变量**(header+content 同 item、无 display:contents/sticky、盒子 `shrink-0`)+ **行为**(locate scroll 调用)做契约代理,视觉一律列 **manual-smoke**,SCOPE 注释明写"绿 ≠ 不重叠"。
- B1 之所以"131 绿却坏":master/detail 的结构断言断的是 **DOM 分离**(真),而 bug 是 **flex 压缩溢出**(jsdom 盲区) —— 用错代理。accordion 的"header+content 同 item"是真实结构属性,mutation 可验。

