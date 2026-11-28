# Agent Note: UI 响应性能优化栈（冷启动、全局搜索、主页面保活与话题原地复用）

Status: implemented

[English](2026-11-27-ui-responsiveness-stack.md) | 中文

## 问题

在 Electron 客户端上执行端到端 CDP 管线与 V8 CPU 采样，确认存在三类核心卡顿问题：

1. **冷启动到主窗口可见（dev 基线约 `7.59s`）**：`WindowManager.onAllReady()` 与主窗口启动并发急切创建辅助窗口（`subWindow`）；`TrayService` 在 macOS/Linux 上重复解码缩放托盘图标（Windows 存在冗余 `setImage()`）；`LocalModelService` 在 `WhenReady` 启动波次中同步扫描清理残留下载文件。
2. **全局搜索弹窗开关卡顿（热打开约 `130ms`，12 次 Monitor 长任务最高 `170ms`，`FireAnimationFrame` 耗时 `257.9ms`，关闭约 `260ms`）**：`GlobalSearchPopup` 在全屏弹窗上使用 `backdrop-blur-[8px]`，`GlobalSearchPanel` 同步挂载 `GlobalSearchMessagePreviewPanel` 与无条件挂载 `ResourceEditDialogHost`，初次聚焦触发同步重排，且缺少面板 Chunk 预加载与快速退场。
3. **页面与话题切换触发整棵树销毁重建及 `<Activity>` 恢复同步回流**：
   - 单标签页 `工作 ↔ 对话` 切换原先完整卸载并重建 `/app/chat` 与 `/app/agents`；接入 `<Activity>` 后，恢复可见时 React 的 `recursivelyTraverseReappearLayoutEffects` 会在 `DynamicVirtualList`（`measureScrollMargin`、`getRect`、`_willUpdate` `scrollTo`）、`MessageAnchorLine`（`scrollHeight`/`clientHeight`/`getBoundingClientRect`）与 `ComposerDockTransitionFrame`（重复两次同步 `updateInset`）引发集中同步回流。
   - 话题切换原先因外层 `<ChatContent key={activeTopic.id}>` 与 `<ComposerToolRuntimeProvider key={draftCacheScopeKey}>` 导致整棵对话区、ProseMirror/Tiptap 与 `CodeViewer` 反复重建；同时 `CodeViewer` 还会沿祖先链调用 `getComputedStyle`、在未换行首帧执行同步 `remeasureRows()` 并同步更新边距。
   - 关闭态的 `CommandContextMenu` / `CommandPopupMenu`（`webcontents.context`）、`SessionItem`、`groupMoreMenus`、`ResourceListGroups`、`AssistantGroupMoreMenu` 与 `MessageMenuBar` 在列表/消息渲染阶段即急切求值菜单动作、翻译项、快捷键订阅与导出文本。

## 决策

全部优化分为以下 5 层顺序实现并合入代码：

1. **主进程冷启动延后预热与后台并行清扫（`WindowManager`、`TrayService`、`LocalModelService`）**：
   - 存在未显示的主窗口时，`WindowManager.runEagerWarmups()` 延后至 `main` 触发 `ready-to-show` 之后运行（配备 `3000ms` `unref` 兜底定时器与 `onDestroy()` 清理）；无主窗口场景保持即时预热。
   - `TrayService` 在创建 `Tray` 前仅执行一次托盘 `NativeImage` 缩放解码。
   - `LocalModelService` 调整至 `Phase.Background` 并在初始化时通过 `Promise.all` 并行清理残留临时下载文件。
2. **全局搜索去模糊、预加载与极速开关（`GlobalSearchPopup`、`GlobalSearchPanel`、`ShellTabBarActions`、`AppShell`）**：
   - 移除全屏 `backdrop-blur-[8px]`，以 `React.lazy` + `Suspense` 拆分 `GlobalSearchMessagePreviewPanel`，按需挂载 `ResourceEditDialogHost`，以 `requestAnimationFrame` + `preventScroll: true` 延后聚焦，采用 `motion="fade-scale"` 配合 `45ms` 打开与 `animate-none` 关闭动效，并导出幂等 `preloadGlobalSearchPanel()` 于搜索按钮悬停/聚焦及 `AppShell` 空闲期预加载。
3. **命令、列表与消息菜单懒解析（`menus.ts`、`CommandMenus`、`SessionItem`、`groupMoreMenus`、`ResourceListGroups`、`AssistantGroupMoreMenu`、`MessageMenuBar*`）**：
   - 在共享命令层按 `location` 预索引静态菜单（`hasStaticMenuContributions`），使无静态贡献位置（`webcontents.context`）的关闭态 `cherry` 模式 `CommandContextMenu` / `CommandPopupMenu` 在打开前跳过上下文、快捷键偏好及菜单解析订阅。
   - 通过 `getExtraItems` 与懒 getter（`hasMenuActions`/`getMenuActions`、`hasTranslationItems`/`getTranslationItems` 等）延后额外菜单项、翻译列表和导出文本计算，同时保持输出、禁用态与原生菜单行为完全一致。
4. **主路由 `<Activity>` 保活与恢复零回流（`TabRouter`、`TabIdProvider`、`useCurrentTab`、`DynamicVirtualList`、`MessageAnchorLine`、`ComposerDockTransitionFrame`）**：
   - 在单标签页内以 React 19 `<Activity>` 保活 `/app/chat` 与 `/app/agents`，维持独立 `CommandFocusScope` 与 Portal 隔离边界。
   - `DynamicVirtualList` 在 `<Activity>` 恢复重连时复用 `WeakMap` 缓存的容器尺寸与滚动偏移（忽略 `0x0` 折叠、以 rAF 合并 `ResizeObserver`、跳过 `_willUpdate` `scrollTo(0)` 并把非零偏移恢复延后至 rAF）。
   - `MessageAnchorLine` 在 `<Activity>` 恢复且轮次/高度未变时跳过（溢出时延后至 rAF）同步滚动重算与初始高度读取；`ComposerDockTransitionFrame` 消除首次挂载重复同步测量，并在 `<Activity>` 恢复时改走 rAF 刷新。
5. **话题与输入器原地复用、3 话题保活及 `CodeViewer` 优化（`ChatComposer`、`ComposerSurface`、`useComposerKnowledgeBaseScope`、`Chat`、`ChatContent`、`ChatMain`、`MessageEditingContext`、`CodeViewer`）**：
   - 移除 `ChatComposer` 与 `Chat.tsx` 中强制重建 `ChatContent` 的外层 `key`，通过 `MessageEditingContext` 的 `scopeKey` 清理编辑态、在 `ChatContent` 按 `topic.id` 隔离定位请求 key，并完整保留 [输入器重建 Token 恢复决策](../bug-fix/2026-11-03-composer-token-restore.md)。
   - 在 `ChatContent` 内用固定 DOM 顺序的 `<Activity>` LRU 槽位保活最近 3 个话题，配合 `memo(ChatMain)` 与 `isHistoryStale` 防覆盖保护避免热切闪烁或错乱。
   - `CodeViewer` 优先通过 `closest('[data-slot="scroll-area-viewport"]')` 查找滚动父级，跳过 `!wrapped` 首次挂载时的同步 `remeasureRows()`，并以 rAF 合并观察器与恢复期 `updateMargin` 重算。

## 考虑过的替代方案

- **仅修局部 Hook 与菜单微热点，不做路由保活与原地复用**：拒绝 — 无法消除整棵路由或 ProseMirror 重建造成的百毫秒级延迟。
- **把所有一级侧边栏导航强制拆分为新标签页**：拒绝 — 改变产品多标签心理模型与标签堆积形态。
- **用原生 CSS `display: none` 隐藏页面或对话**：拒绝 — 会让隐藏树里的订阅与副作用继续活跃，失去 `<Activity>` 原生暂停能力。
- **将全部改动打成单个超大 PR**：拒绝 — 混杂主进程启动、弹窗图形、菜单、虚拟列表与对话状态管理，不利于独立审阅。

## 影响

- **生产包端到端收益（`electron-vite preview`，`prod` L1–L6 对比 `prod4` L1–L9）**：全局搜索关闭耗时由 `127.6–238.7ms` 降至 `61.2–76.2ms`（0 次 LongTask）；`工作 ↔ 对话` `LayoutCount` 从 `66` 降至 `39`，完全消除 `DynamicVirtualList` `getRect`（`78.4ms`）、重连 `scrollTo`（`68.9ms`）与 `MessageAnchorLine` 回流（`51.5ms`）；重型 Markdown 话题冷切由 `332.4ms`/`395.9ms` 降至 `203.0ms`（热切 `123.3–153.5ms`），6 次点击 DOM `Nodes` 净增由 `+12,043` 改善为 `-4,106`，`getBoundingClientRect` 自耗时由 `85.8ms` 降至 `20.1ms`。
- **可控内存权衡**：最多常驻 2 个主路由与 3 个最近话题会增加适量空闲 DOM 内存，由 3 槽位 LRU 上限严格约束。
- **剩余尾端热点**：剩余 `20–54ms` 开销主要来自 `CodeViewer` 自持 `@tanstack/react-virtual` 的 `getRect`（`44–51ms`）、`i18next` `formatLanguageCode`（`24–34ms`）、`ComposerSurfaceRuntime.measure`（`30ms`）与 React Context 传播（`54ms`），保留在后续独立演进范围之外。

## 验证

- AC1 — `pnpm test:main src/main/core/window/__tests__/WindowManager.test.ts src/main/services/__tests__/TrayService.test.ts src/main/services/__tests__/TrayService.control.test.ts src/main/ai/localModel/__tests__/LocalModelService.test.ts src/main/core/lifecycle/__tests__/DependencyResolver.test.ts src/main/core/lifecycle/__tests__/LifecycleManager.test.ts`（6 个文件 228/228 通过）：验证主窗口显示后再预热、托盘图标单次解码以及 `LocalModelService` 在 `Phase.Background` 并行清理残留下载。
- AC2 — `pnpm test:renderer src/renderer/components/GlobalSearch/__tests__/GlobalSearchPopup.test.tsx src/renderer/components/GlobalSearch/__tests__/GlobalSearchPanel.test.tsx src/renderer/components/layout/__tests__/AppShell.test.tsx`（3 个文件 80/80 通过）及 `prod4` CDP 实机采样（关闭耗时 `61.2–76.2ms`，0 次 LongTask）：验证全局搜索焦点延迟、预览/弹窗按需渲染、Chunk 预加载与关闭加速。
- AC3 — `pnpm test:shared src/shared/utils/command/__tests__/menus.test.ts`（1 个文件 4/4 通过）及 `pnpm test:renderer src/renderer/components/command/__tests__/CommandMenus.test.tsx src/renderer/components/chat/resourceList/base/__tests__/ResourceList.test.tsx src/renderer/pages/agents/components/sessions/__tests__/SessionItem.test.tsx src/renderer/pages/agents/components/sessions/__tests__/Sessions.test.tsx src/renderer/pages/home/Tabs/components/topics/__tests__/Topics.test.tsx src/renderer/components/chat/messages/frame/__tests__/messageMenuBarActions.test.tsx src/renderer/components/chat/messages/frame/__tests__/MessageMenuBar.exportMarkdown.test.tsx src/renderer/components/chat/messages/frame/__tests__/MessageMenuBar.deleteAffordance.test.tsx`（8 个文件 362/362 通过）：验证关闭态命令菜单隔离订阅、列表/消息栏懒解析及菜单内容/禁用态完全一致。
- AC4 — `pnpm test:renderer src/renderer/components/layout/__tests__/TabRouter.test.tsx src/renderer/components/layout/__tests__/AppShell.test.tsx src/renderer/pages/home/components/__tests__/HomeTabRuntime.test.tsx src/renderer/pages/agents/components/__tests__/AgentTabRuntime.test.tsx src/renderer/components/VirtualList/__tests__/DynamicVirtualList.test.tsx src/renderer/components/chat/messages/list/__tests__/MessageAnchorLine.test.tsx src/renderer/components/composer/__tests__/ComposerDockTransitionFrame.test.tsx`（7 个文件 96/96 通过）及 `prod4` 导航采样：验证 `<Activity>` 路由保活隔离、缓存尺寸/偏移复用、重连 `scrollTo` 延后以及导航轨/输入框布局框恢复零回流。
- AC5 — `pnpm test:renderer src/renderer/components/composer/variants/__tests__/ChatComposer.test.tsx src/renderer/components/composer/variants/shared/__tests__/useComposerKnowledgeBaseScope.test.tsx src/renderer/pages/home/__tests__/Chat.test.tsx src/renderer/pages/home/__tests__/ChatContent.test.tsx src/renderer/components/__tests__/CodeViewer.test.tsx src/renderer/components/__tests__/CodeViewer.firstPaint.test.tsx src/renderer/components/__tests__/CodeViewer.shiki.test.tsx src/renderer/pages/agents/messages/__tests__/agentMessageEditing.test.tsx`（8 个文件 231/231 通过）及 `prod4` 话题实机采样（点击切换全部 `contentChanged: true`、`pageErrors: 0`）：验证 `ChatComposer`/`ChatContent` 原地复用、最近 3 话题 `<Activity>` LRU 保活/淘汰与 `CodeViewer` 重排消除。
