# Agent Note: UI responsiveness optimization stack (cold start, global search, route keep-alive, and in-place chat switching)

Status: implemented

English | [中文](2026-11-27-ui-responsiveness-stack.zh.md)

## Problem

End-to-end CDP and V8 CPU profiling on the Electron client surfaced three interactive lag bottlenecks:

1. **Cold start to visible main window (`~7.59s` dev baseline)**: `WindowManager.onAllReady()` eagerly created secondary pooled/singleton windows (`subWindow`) concurrently with main-window boot, `TrayService` decoded and resized the tray icon twice on macOS/Linux (and called `setImage()` redundantly on Windows), and `LocalModelService` swept stale temporary download files synchronously inside the `WhenReady` wave.
2. **Global Search modal open/close jitter (`~130ms` warm open, 12 monitor long tasks up to `170ms`, `257.9ms` `FireAnimationFrame`, `~260ms` close)**: `GlobalSearchPopup` applied full-screen `backdrop-blur-[8px]` over the animated dialog, `GlobalSearchPanel` mounted `GlobalSearchMessagePreviewPanel` and `ResourceEditDialogHost` synchronously and unconditionally, immediate `inputRef.current?.focus()` forced layout reflow mid-animation, exit animations dragged out closure without preloading the search chunk, and closing remained slow.
3. **Full subtree teardown and `<Activity>` reappear reflows on page and topic switching**:
   - Single-tab `工作 ↔ 对话` navigation unmounted and rebuilt `/app/chat` and `/app/agents`; once kept alive via `<Activity>`, `recursivelyTraverseReappearLayoutEffects` forced synchronous layout and scroll reads across `DynamicVirtualList` (`measureScrollMargin`, `getRect`, `_willUpdate` `scrollTo`), `MessageAnchorLine` (`scrollHeight`/`clientHeight`/`getBoundingClientRect`), and `ComposerDockTransitionFrame` (duplicate `updateInset`).
   - Switching topics forced full remounts via `<ChatContent key={activeTopic.id}>` and `<ComposerToolRuntimeProvider key={draftCacheScopeKey}>`, while `CodeViewer` walked ancestors with `getComputedStyle`, ran synchronous `remeasureRows()` on unwrapped first mount, and ran synchronous layout observers.
   - Closed `CommandContextMenu`/`CommandPopupMenu` (`webcontents.context`), `SessionItem`, `groupMoreMenus`, `ResourceListGroups`, `AssistantGroupMoreMenu`, and `MessageMenuBar` eagerly resolved menus, translation lists, shortcut subscriptions, and export strings before menus opened.

## Decision

The 5-layer responsiveness stack ships across five focused layers:

1. **Main-process boot deferral and background sweep (`WindowManager`, `TrayService`, `LocalModelService`)**:
   - `WindowManager.runEagerWarmups()` waits for a non-visible `main` window to emit `ready-to-show` (with a `3000ms` unref'd fallback timer cleaned up on destroy) while retaining immediate warmup in headless/mainless runs.
   - `TrayService` decodes and resizes the tray `NativeImage` once before constructing `Tray`.
   - `LocalModelService` runs in `Phase.Background` and sweeps stale downloads concurrently with `Promise.all`.
2. **Global Search instant open/close and chunk prefetch (`GlobalSearchPopup`, `GlobalSearchPanel`, `ShellTabBarActions`, `AppShell`)**:
   - Removes overlay `backdrop-blur-[8px]`, lazy-loads `GlobalSearchMessagePreviewPanel` inside `Suspense`, conditionally renders `ResourceEditDialogHost`, defers focus via `requestAnimationFrame` with `preventScroll: true`, uses `motion="fade-scale"` with `45ms` open and `animate-none` close transitions, and preloads the search panel chunk on search button hover/focus and `AppShell` idle time.
3. **Lazy closed command, resource-list, and message menus (`menus.ts`, `CommandMenus`, `SessionItem`, `groupMoreMenus`, `ResourceListGroups`, `AssistantGroupMoreMenu`, `MessageMenuBar*`)**:
   - Indexes static menu contributions per `location` (`hasStaticMenuContributions`) so closed `cherry`-mode `CommandContextMenu` and `CommandPopupMenu` triggers without static items (`webcontents.context`) skip command-context, shortcut-preference, and resolved-menu subscriptions until opened.
   - Defers extra/translation/action resolution and markdown/plain-text getters via lazy callbacks (`getExtraItems`, `hasMenuActions`/`getMenuActions`, `hasTranslationItems`/`getTranslationItems`) while preserving rendered items, disabled states, and native popup parity.
4. **Primary route keep-alive and `<Activity>` reappear zero-reflow (`TabRouter`, `TabIdProvider`, `useCurrentTab`, `DynamicVirtualList`, `MessageAnchorLine`, `ComposerDockTransitionFrame`)**:
   - Retains visited `/app/chat` and `/app/agents` primary routes per tab under React 19 `<Activity>` with scoped `CommandFocusScope` and portal containers.
   - `DynamicVirtualList` caches measured `scrollMargin`, element rects (`WeakMap`), and scroll offsets across `<Activity>` reconnects (ignoring `0x0` collapses, coalescing `ResizeObserver` via rAF, skipping `_willUpdate` `scrollTo(0)`, and deferring non-zero reconnect `scrollTo` into rAF).
   - `MessageAnchorLine` skips unchanged reappear scroll/height reflows (deferring overflowing re-pins to rAF) and `ComposerDockTransitionFrame` deduplicates initial `updateInset()` reads while refreshing reappear insets via rAF.
5. **In-place topic/composer switching, 3-topic keep-alive, and `CodeViewer` optimization (`ChatComposer`, `ComposerSurface`, `useComposerKnowledgeBaseScope`, `Chat`, `ChatContent`, `ChatMain`, `MessageEditingContext`, `CodeViewer`)**:
   - Removes key-forced remounts on `ChatComposer` and `ChatContent` (`scopeKey` resets `MessageEditingContext`, topic-namespaced locate keys prevent cross-topic leaks, and [the composer token restore decision](../bug-fix/2026-11-03-composer-token-restore.md) remains intact).
   - Retains up to 3 recently visited topics inside `ChatContent` in stable insertion-ordered `<Activity>` LRU slots with memoized `ChatMain` and stale-frame prop protection (`isHistoryStale`).
   - Fast-paths `CodeViewer` scroll-parent lookup via `closest('[data-slot="scroll-area-viewport"]')`, skips initial `!wrapped` `remeasureRows()`, coalesces observer `updateMargin` callbacks via rAF, and defers reappear margin checks to rAF.

## Alternatives considered

- **Fix only micro-hotspots without keep-alive or in-place reuse**: rejected — route and topic switches would still pay full React tree and ProseMirror teardown/rebuild latency.
- **Open every primary workspace view in a separate tab**: rejected — changes user-facing tab proliferation instead of making intra-tab switching fast.
- **Hide routes or topics with raw CSS `display: none`**: rejected — leaves background effects, listeners, and subscriptions active instead of suspending them through `<Activity>`.
- **Merge all changes in one monolithic PR**: rejected — mixes main-process boot, popup UX, menu resolution, virtualizer infrastructure, and composer/topic state.

## Consequences

- **End-to-end production bundle gains (`electron-vite preview`, `prod` L1–L6 baseline vs `prod4` L1–L9 final)**: Global Search close drops from `127.6–238.7ms` to `61.2–76.2ms` with `0` LongTasks; `工作 ↔ 对话` reduces `LayoutCount` from `66` to `39` and eliminates `DynamicVirtualList` `getRect` (`78.4ms`), reconnect `scrollTo` (`68.9ms`), and `MessageAnchorLine` reappear reflow (`51.5ms`); heavy Markdown topic switching drops from `332.4ms`/`395.9ms` cold to `203.0ms` (warm revisits `123.3–153.5ms`) while cutting `DOM Nodes` churn from `+12,043` to `-4,106` and `getBoundingClientRect` from `85.8ms` to `20.1ms`.
- **Bounded memory tradeoff**: Retaining up to 2 primary routes and 3 recent topics in memory trades modest idle DOM footprint for faster repeat switches, strictly bounded by the 3-topic LRU cap.
- **Residual downstream hotspots**: Remaining `20–54ms` tails stem from `CodeViewer`'s direct `@tanstack/react-virtual` `getRect` (`44–51ms`), `i18next` `formatLanguageCode` (`24–34ms`), `ComposerSurfaceRuntime.measure` (`30ms`), and React context propagation (`54ms`), left outside this stack.

## Verification

- AC1 — `pnpm test:main src/main/core/window/__tests__/WindowManager.test.ts src/main/services/__tests__/TrayService.test.ts src/main/services/__tests__/TrayService.control.test.ts src/main/ai/localModel/__tests__/LocalModelService.test.ts src/main/core/lifecycle/__tests__/DependencyResolver.test.ts src/main/core/lifecycle/__tests__/LifecycleManager.test.ts` (6 files, 228/228 passed): verifies deferred main-window warmup, single tray decode, and concurrent background `LocalModelService` download sweeping.
- AC2 — `pnpm test:renderer src/renderer/components/GlobalSearch/__tests__/GlobalSearchPopup.test.tsx src/renderer/components/GlobalSearch/__tests__/GlobalSearchPanel.test.tsx src/renderer/components/layout/__tests__/AppShell.test.tsx` (3 files, 80/80 passed) + `prod4` CDP benchmark (`closeMs` `61.2–76.2ms`, `0` LongTasks): verifies Global Search autofocus, lazy preview/edit hosting, chunk preload, and close latency reduction.
- AC3 — `pnpm test:shared src/shared/utils/command/__tests__/menus.test.ts` (1 file, 4/4 passed) + `pnpm test:renderer src/renderer/components/command/__tests__/CommandMenus.test.tsx src/renderer/components/chat/resourceList/base/__tests__/ResourceList.test.tsx src/renderer/pages/agents/components/sessions/__tests__/SessionItem.test.tsx src/renderer/pages/agents/components/sessions/__tests__/Sessions.test.tsx src/renderer/pages/home/Tabs/components/topics/__tests__/Topics.test.tsx src/renderer/components/chat/messages/frame/__tests__/messageMenuBarActions.test.tsx src/renderer/components/chat/messages/frame/__tests__/MessageMenuBar.exportMarkdown.test.tsx src/renderer/components/chat/messages/frame/__tests__/MessageMenuBar.deleteAffordance.test.tsx` (8 files, 362/362 passed): verifies closed-menu isolation, lazy menu evaluation, and rendered parity.
- AC4 — `pnpm test:renderer src/renderer/components/layout/__tests__/TabRouter.test.tsx src/renderer/components/layout/__tests__/AppShell.test.tsx src/renderer/pages/home/components/__tests__/HomeTabRuntime.test.tsx src/renderer/pages/agents/components/__tests__/AgentTabRuntime.test.tsx src/renderer/components/VirtualList/__tests__/DynamicVirtualList.test.tsx src/renderer/components/chat/messages/list/__tests__/MessageAnchorLine.test.tsx src/renderer/components/composer/__tests__/ComposerDockTransitionFrame.test.tsx` (7 files, 96/96 passed) + `prod4` nav benchmark: verifies `<Activity>` route keep-alive isolation, cached rect/offset reuse, reconnect `scrollTo` deferral, and anchor/dock reappear zero-reflow.
- AC5 — `pnpm test:renderer src/renderer/components/composer/variants/__tests__/ChatComposer.test.tsx src/renderer/components/composer/variants/shared/__tests__/useComposerKnowledgeBaseScope.test.tsx src/renderer/pages/home/__tests__/Chat.test.tsx src/renderer/pages/home/__tests__/ChatContent.test.tsx src/renderer/components/__tests__/CodeViewer.test.tsx src/renderer/components/__tests__/CodeViewer.firstPaint.test.tsx src/renderer/components/__tests__/CodeViewer.shiki.test.tsx src/renderer/pages/agents/messages/__tests__/agentMessageEditing.test.tsx` (8 files, 231/231 passed) + `prod4` topic benchmark (`contentChanged: true`, `pageErrors: 0`): verifies in-place `ChatComposer`/`ChatContent` reuse, 3-topic LRU `<Activity>` keep-alive/eviction, and `CodeViewer` layout reduction.
