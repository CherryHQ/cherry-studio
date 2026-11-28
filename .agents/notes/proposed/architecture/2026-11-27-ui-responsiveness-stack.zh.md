# Agent Note: UI 响应性能优化栈（冷启动、全局搜索、主页面保活与话题原地复用）

Status: proposed

[English](2026-11-27-ui-responsiveness-stack.md) | 中文

## 问题

在运行中的 Electron 客户端上执行端到端 CDP 管线采样与 V8 CPU 分析后，定位到三处交互延迟痛点及其根因：

1. **冷启动到主窗口可见（dev 基线约 `7.59s`）**：`WindowManager.onAllReady()` 在主窗口冷启动阶段同步并发预热池化/单例辅助窗口（`subWindow`），`TrayService` 在 macOS/Linux 上重复解码并缩放托盘图标（在 Windows 上存在冗余 `setImage()` 调用），且 `LocalModelService` 在 `WhenReady` 启动批次中同步扫描清理残留下载文件。
2. **全局搜索弹窗开关卡顿（热打开约 `130ms`，Monitor 长任务 12 次、最高 `170ms`，`FireAnimationFrame` 耗时 `257.9ms`，关闭约 `260ms`）**：`GlobalSearchPopup` 在带动画的全屏弹窗上使用 `backdrop-blur-[8px]`；`GlobalSearchPanel` 在弹窗挂载时同步渲染 `GlobalSearchMessagePreviewPanel`、无条件挂载 `ResourceEditDialogHost`，在入场动画期间通过即时 `inputRef.current?.focus()` 触发同步重排，无空闲/悬停 Chunk 预加载，且每次关闭都播放完整退场动画再销毁。
3. **主页面与话题切换触发整棵子树销毁重建及 `<Activity>` 恢复同步回流**：
   - **单标签页内 `工作 ↔ 对话` 切换（约 `500–816ms`，21 次长任务）**：`TabRouter` 的 `<Activity>` 仅按标签页粒度保活，不保活同一标签页内的顶层主路由，导致 `/app/chat` 与 `/app/agents` 间切换会完整卸载并重建整个工作区。进一步引入 `<Activity>` 后，从隐藏切回显示会触发 React 的 `recursivelyTraverseReappearLayoutEffects`，导致 `DynamicVirtualList`（`measureScrollMargin`、`getRect`、`_willUpdate` 中的 `scrollTo`）、`MessageAnchorLine`（`scrollHeight`/`clientHeight`/`getBoundingClientRect`）与 `ComposerDockTransitionFrame`（重复两次同步 `updateInset`）集中发生同步强制重排。
   - **对话话题切换（约 `254–532ms`，10 次长任务）**：`Chat.tsx` 将外层 `<ChatContent>` 的 `key` 绑定到 `activeTopic.id`，`ChatComposerRoot` 又将 `<ComposerToolRuntimeProvider>` 的 `key` 绑定到 `draftCacheScopeKey`，导致每次切换话题都会销毁并重建整棵 `ChatContent`、ProseMirror/Tiptap 编辑器、`ChatMain` 与代码块（`CodeViewer` 还会沿祖先链调用 `getComputedStyle`、在未换行首次挂载时执行同步 `remeasureRows()`，并在布局观察器里同步读取边界）。
   - **关闭态菜单与工具栏急切求值**：未打开的 `CommandContextMenu` / `CommandPopupMenu`（`webcontents.context`）、`SessionItem`、`groupMoreMenus`、`ResourceListGroups`、`AssistantGroupMoreMenu` 与 `MessageMenuBar` 在列表或消息渲染阶段就会提前计算菜单动作、翻译项、快捷键监听与导出文本。

## 提案

将优化工作拆分为基于本 Spec 的 5 层线性实现栈，使每个 PR 都具备清晰内聚的边界、独立可测的回归契约与可量化收益：

1. **`perf/cold-start-boot-deferral`（第 1 层：主进程冷启动延后预热与后台并行清扫）**：
   - 启动期存在未显示的主窗口时，将 `WindowManager` 非主窗口的急切预热（`runEagerWarmups()`）延后至 `main` 触发 `ready-to-show` 之后（附带 `3000ms` `unref` 兜底定时器与 `onDestroy()` 清理）；无主窗口场景保留即时预热。
   - `TrayService` 在创建 `Tray` 前一次性完成托盘图片缩放解码。
   - 将 `LocalModelService` 迁至 `Phase.Background` 并通过 `Promise.all` 并行清理残留临时下载文件，使其不再阻塞 `BeforeReady`/`WhenReady` 主窗口就绪。
2. **`perf/global-search-responsiveness`（第 2 层：全局搜索零模糊、预加载与极速开关）**：
   - 移除全屏遮罩 `backdrop-blur-[8px]`，以 `React.lazy` + `Suspense` 拆分 `GlobalSearchMessagePreviewPanel`，按需挂载 `ResourceEditDialogHost`，将初次输入聚焦延后一帧（`preventScroll: true`），收紧开关动效（`motion="fade-scale"`，`45ms` 打开、`animate-none` 关闭），并在 `GlobalSearchPopup` 导出幂等 `preloadGlobalSearchPanel()` 于按钮悬停/聚焦（`ShellTabBarActions`）和主壳挂载空闲期（`AppShell`）预加载面板 Chunk。
3. **`perf/lazy-command-and-message-menus`（第 3 层：命令菜单、列表与消息工具栏懒解析）**：
   - 在共享命令层按 `location` 预建静态菜单索引（`hasStaticMenuContributions`），使无静态贡献位点（`webcontents.context`）的 `cherry` 模式 `CommandContextMenu` / `CommandPopupMenu` 在关闭态跳过 `useCommandContextReader()`、`useCommandShortcutPreferences()` 与 `useResolvedCommandMenu()` 订阅。
   - 在 `CommandPopupMenu`、`SessionItem`、`groupMoreMenus`、`ResourceListGroups`（`GroupHeader`）、`AssistantGroupMoreMenu` 与 `MessageMenuBar`（`hasMessageMenuBarMenuActions`、`hasMessageMenuBarTranslationItems`、懒 getter 与 `getExtraItems`）中将菜单解析、翻译项与导出文本计算全部延后至打开菜单时按需计算，保持菜单内容、禁用态与原生菜单一致性不变。
4. **`perf/route-keep-alive-zero-reflow`（第 4 层：单标签页主路由保活与 `<Activity>` 恢复零回流）**：
   - 在单标签页内通过 React 19 `<Activity>`（`TabRouter`、`TabIdProvider`、`useIsActiveTab`）保活 `/app/chat` 与 `/app/agents` 核心工作区路由，严格隔离焦点作用域、Portal 容器与快捷键边界。
   - `DynamicVirtualList` 缓存已测量的 `scrollMargin`、容器尺寸（`WeakMap`）与滚动偏移并在 `<Activity>` 恢复时直接复用（忽略 `0x0` 折叠尺寸、以 rAF 合并 `ResizeObserver`、跳过 `_willUpdate` 的 `scrollTo(0)` 并将非零偏移重连恢复延后到 rAF）。
   - `MessageAnchorLine` 在 `<Activity>` 恢复且轮次/高度未变时跳过（溢出时延后至 rAF）同步滚动重算，并跳过重复的初始高度同步读取；`ComposerDockTransitionFrame` 消除首次挂载重复两次同步 `updateInset()`，`<Activity>` 恢复时改走 rAF 合并刷新。
5. **`perf/in-place-topic-switch-and-code-viewer`（第 5 层：输入器与对话内容区原地切换、3 话题保活及 `CodeViewer` 优化）**：
   - 移除 `ChatComposer` / `ComposerSurface` / `useComposerKnowledgeBaseScope` 中由 `key={draftCacheScopeKey}` 触发的卸载重建，改为就地原子切换草稿、附件、知识库作用域，并严格遵守 [输入器重建 Token 恢复决策](../../implemented/bug-fix/2026-11-03-composer-token-restore.md) 中的芯片恢复契约。
   - 移除 `Chat.tsx` 外层的 `<ChatContent key={activeTopic.id}>`，为 `MessageEditingContext` 增加 `scopeKey` 切换重置、在 `ChatContent` 中按 `topic.id` 隔离定位请求 key、使用 `memo` 包裹 `ChatMain`，并在 `ChatContent` 内用固定 DOM 顺序的 `<Activity>` LRU 槽位保活最近 3 个话题（同时避免 `isHistoryStale` 过渡帧覆盖已缓存话题 props）。
   - `CodeViewer` 优先通过 `closest('[data-slot="scroll-area-viewport"]')` 定位滚动父容器以跳过 `getComputedStyle` 循环，跳过 `!wrapped` 首次挂载时的冗余同步 `remeasureRows()`，并以 rAF 合并布局观察器及 `<Activity>` 恢复时的 `updateMargin` 重算。

## 考虑过的替代方案

- **仅修局部 Hook 与菜单微热点，不做路由保活与原地复用**：拒绝 — 首轮采样表明局部优化无法消除整棵路由树或对话/ProseMirror 重建带来的百毫秒级卡顿。
- **强制侧边栏每个主入口都在新标签页打开**：拒绝 — 会改变用户可见的标签页数量与使用模型，而非加速页内切换。
- **直接用 CSS `display: none` 隐藏而不使用 React 19 `<Activity>`**：拒绝 — 会让隐藏子树中的副作用、键盘监听与订阅继续活跃，无法借助 React 原生机制暂停。
- **把所有改动合进单一超大 PR**：拒绝 — 跨主进程启动、弹窗动效、菜单系统、虚拟列表/路由保活和对话/输入器/代码块多条主线，不利于评审与独立回滚。

## 验收标准

- AC1 — 启动期存在未显示的主窗口时，`WindowManager` 将辅助窗口急切预热延后至 `main` 触发 `ready-to-show` 之后（配备兜底定时器与销毁清理），`TrayService` 仅执行一次托盘图片解码/缩放，且 `LocalModelService` 在 `Phase.Background` 并发清理残留下载文件。（验证：主进程生命周期与 LocalModelService 单测 + 启动耗时日志；负责人：主进程生命周期）
- AC2 — 全局搜索移除全屏 `backdrop-blur`、懒拆分 `GlobalSearchMessagePreviewPanel` 与 `ResourceEditDialogHost`、支持悬停/聚焦/空闲预加载面板 Chunk、延后初次聚焦重排并实现极速开关动效（`45ms` 打开 / `animate-none` 关闭），同时保留查询、键盘导航、预览与编辑弹窗契约。（验证：GlobalSearch 与 AppShell 单测 + CDP/Trace 采样；负责人：GlobalSearch）
- AC3 — 无静态项的关闭态命令菜单（`webcontents.context`）与关闭态列表/分组/消息菜单跳过急切上下文订阅、动作求值与导出文本计算，直到打开时按需计算，且保持禁用态、快捷键与菜单输出完全一致。（验证：command/menus、CommandMenus、ResourceList、SessionItem/Sessions/Topics 与 MessageMenuBar 单测；负责人：菜单与资源列表）
- AC4 — 单标签页 `/app/chat ↔ /app/agents` 切换通过 `<Activity>` 保活已挂载路由且不泄漏 `CommandFocusScope`/快捷键/Portal，同时 `DynamicVirtualList`、`MessageAnchorLine` 与 `ComposerDockTransitionFrame` 在恢复可见时不触发冗余同步布局或 `scrollTo` 回流。（验证：TabRouter、DynamicVirtualList、MessageAnchorLine 与 ComposerDockTransitionFrame 单测 + Electron 采样；负责人：应用布局与虚拟列表）
- AC5 — 切换话题时原地复用 `ChatComposer`、Tiptap 与 `ChatContent`（按 `scopeKey` 干净重置草稿、附件、知识库、编辑态与定位请求），以 `<Activity>` LRU 保活最近 3 个话题，并消除 `CodeViewer` 的冗余滚动父级遍历、未换行首帧重测与同步边距重排。（验证：Chat、ChatContent、ChatComposer、useComposerKnowledgeBaseScope 与 CodeViewer 单测 + Electron 采样；负责人：对话与输入器）

## 风险

- **隐藏 `<Activity>` 边界泄漏**：React `<Activity mode="hidden">` 保留 DOM 并暂停 effect；焦点作用域、Tooltip 或 Portal 必须像 `TabRouter` 一样锚定在路由容器边界内。
- **可控内存开销**：保留至多 2 个主路由和至多 3 个最近话题会带来适度常驻内存，通过严格 `3` 槽位 LRU 淘汰限制增长上界。
- **原地复用话题切换的状态串扰**：原地复用 `ChatComposer` 与 `ChatContent` 时必须显式按 `topic.id` / `scopeKey` 重置草稿、Token、附件、知识库、编辑态与定位请求，由单测与实机回归保障。
- **开发环境与打包环境耗时差异**：Electron Dev 模式包含未打包 ESM、`jsxDEV`、React DevTools 与诊断日志开销；端到端对比需在相同操作序列与生产包（`electron-vite preview`）下进行。
