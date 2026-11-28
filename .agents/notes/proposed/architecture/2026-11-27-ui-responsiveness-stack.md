# Agent Note: UI responsiveness optimization stack (cold start, global search, route keep-alive, and in-place chat switching)

Status: proposed

English | [中文](2026-11-27-ui-responsiveness-stack.zh.md)

## Problem

End-to-end CDP and V8 CPU profiling on the live Electron client surfaced three interactive lag bottlenecks and their underlying causes:

1. **Cold start to visible main window (`~7.59s` dev baseline)**: `WindowManager.onAllReady()` eagerly pre-creates pooled/singleton secondary windows (`subWindow`) concurrently with main-window boot, `TrayService` decodes and resizes the tray icon twice on macOS/Linux (plus redundant `setImage()` on Windows), and `LocalModelService` sweeps stale temporary download files synchronously inside the `WhenReady` wave.
2. **Global Search modal open/close jitter (`~130ms` warm open, 12 monitor long tasks up to `170ms`, `257.9ms` `FireAnimationFrame`, `~260ms` close)**: `GlobalSearchPopup` applies a full-screen `backdrop-blur-[8px]` over the entire animated dialog, while `GlobalSearchPanel` synchronously mounts `GlobalSearchMessagePreviewPanel`, mounts `ResourceEditDialogHost` unconditionally, triggers synchronous layout reflow via immediate `inputRef.current?.focus()` during entry animation, and tears down/rebuilds the dialog tree across slow exit animations on every toggle without chunk prefetching.
3. **Full subtree unmount/remount and reappear reflow on primary page and conversation switching**:
   - **Single-tab `工作 ↔ 对话` navigation (`~500–816ms`, 21 long tasks)**: `TabRouter`'s `<Activity>` wraps per-tab routers rather than top-level primary routes within a tab, so clicking between `/app/chat` and `/app/agents` completely unmounts one workspace and mounts the other from scratch. Furthermore, once wrapped in `<Activity>`, re-showing hidden views runs `recursivelyTraverseReappearLayoutEffects`, triggering synchronous reflows across `DynamicVirtualList` (`measureScrollMargin`, `getRect`, `_willUpdate` `scrollTo`), `MessageAnchorLine` (`scrollHeight`/`clientHeight`/`getBoundingClientRect`), and `ComposerDockTransitionFrame` (duplicate synchronous `updateInset` reads).
   - **Chat topic switching (`~254–532ms`, 10 long tasks)**: `Chat.tsx` keys `<ChatContent>` on `activeTopic.id` and `ChatComposerRoot` keys `<ComposerToolRuntimeProvider>` on `draftCacheScopeKey`, forcing full destruction and re-initialization of `ChatContent`, ProseMirror/Tiptap, `ChatMain`, and `CodeViewer` blocks on every topic selection (`CodeViewer` also walks ancestors with `getComputedStyle`, runs synchronous `remeasureRows()` on unwrapped first mount, and runs synchronous observer margin checks).
   - **Eager closed-menu and toolbar resolution**: Closed `CommandContextMenu` / `CommandPopupMenu` (`webcontents.context`), `SessionItem`, `groupMoreMenus`, `ResourceListGroups`, `AssistantGroupMoreMenu`, and `MessageMenuBar` eagerly resolve menu actions, translation lists, keyboard shortcuts, and export text during list/message rendering even when menus remain closed.

## Proposal

Split the optimization work into a linear 5-layer implementation stack on top of this Spec so each PR has an isolated reviewable contract and measurable performance boundary:

1. **`perf/cold-start-boot-deferral` (Layer 1 — Main-Process Cold Start & Background Services)**:
   - Defer `WindowManager` eager non-main warmups (`runEagerWarmups()`) until the non-visible `main` window emits `ready-to-show` (with a bounded `3000ms` unref'd fallback timer and `onDestroy()` cleanup), while keeping immediate warmup when no `main` window exists.
   - Decode/resize the tray image once before constructing `Tray` in `TrayService`.
   - Move `LocalModelService` to `Phase.Background` and parallelize its startup `sweepStaleDownloads()` pass via `Promise.all` so stale temporary download cleanup does not block `BeforeReady` / `WhenReady` window readiness.
2. **`perf/global-search-responsiveness` (Layer 2 — Global Search Instant Open/Close & Prefetch)**:
   - Remove the full-screen `backdrop-blur-[8px]` overlay, code-split `GlobalSearchMessagePreviewPanel` behind `Suspense`, conditionally render `ResourceEditDialogHost`, defer initial input focus by one animation frame with `preventScroll: true`, tighten transitions (`motion="fade-scale"`, `45ms` open, `animate-none` close), and add an idempotent `preloadGlobalSearchPanel()` helper triggered on search button pointer/focus (`ShellTabBarActions`) and post-mount idle time (`AppShell`).
3. **`perf/lazy-command-and-message-menus` (Layer 3 — Lazy Command, List & Message Menus)**:
   - Pre-index static menu contributions by `location` (`hasStaticMenuContributions`) and isolate closed `cherry`-mode `CommandContextMenu` / `CommandPopupMenu` triggers at locations without static items (`webcontents.context`) from subscribing to command contexts/shortcuts or resolved menus until opened.
   - Defer closed-menu action evaluation via `getExtraItems` callbacks and lazy toolbar getters in `CommandPopupMenu`, `SessionItem`, `groupMoreMenus`, `ResourceListGroups` (`GroupHeader`), `AssistantGroupMoreMenu`, and `MessageMenuBar` (`hasMessageMenuBarMenuActions`, `hasMessageMenuBarTranslationItems`, memoized export/text getters) without changing rendered menu items, disabled states, or native popup parity.
4. **`perf/route-keep-alive-zero-reflow` (Layer 4 — Primary Route Keep-Alive & `<Activity>` Reappear Zero-Reflow)**:
   - Retain mounted primary workspace routes (`/app/chat` and `/app/agents`) inside single-tab navigation using React 19 `<Activity>` (`TabRouter`, `TabIdProvider`, `useIsActiveTab`) with scoped `CommandFocusScope` and portal boundaries.
   - Make `DynamicVirtualList` cache measured `scrollMargin`, element rects (`WeakMap`), and scroll offsets across `<Activity>` hide/show reconnects (ignoring `0x0` hidden collapses, coalescing `ResizeObserver` via rAF, skipping `_willUpdate` `scrollTo(0)` and deferring non-zero reconnect `scrollTo` into rAF).
   - Skip unchanged `<Activity>` reappear synchronous scroll/height reads in `MessageAnchorLine` (deferring overflowing re-pins to rAF) and deduplicate initial + reappear inset measurements in `ComposerDockTransitionFrame`.
5. **`perf/in-place-topic-switch-and-code-viewer` (Layer 5 — In-Place Topic Switch, 3-Topic Keep-Alive & `CodeViewer` Optimization)**:
   - Remove `key={draftCacheScopeKey}` remounting in `ChatComposer` / `ComposerSurface` / `useComposerKnowledgeBaseScope` to reuse Tiptap in place while strictly preserving the chip-restoration contract in [the composer token restore decision](../../implemented/bug-fix/2026-11-03-composer-token-restore.md).
   - Remove the outer `<ChatContent key={activeTopic.id}>` boundary in `Chat.tsx`, add `scopeKey`-based edit state reset in `MessageEditingContext`, namespace locate keys per `topic.id` in `ChatContent`, memoize `ChatMain`, and retain up to 3 recently visited topics inside `ChatContent` using stable insertion-ordered `<Activity>` LRU slots (preventing transient `isHistoryStale` frames from clobbering warm props).
   - Fast-path `CodeViewer` expanded scroll-parent lookup via `closest('[data-slot="scroll-area-viewport"]')`, skip redundant initial mount `remeasureRows()` when `!wrapped`, coalesce observer `updateMargin` callbacks via rAF, and defer reappear margin verification to rAF once measured.

## Alternatives considered

- **Fix only micro-hotspots without architectural keep-alive or composer/topic reuse**: rejected — initial profiling confirmed hook/menu fixes alone cannot eliminate full subtree teardown and ProseMirror reconstruction on route or topic switches.
- **Force every primary sidebar link to open a separate tab**: rejected — changes user-visible tab proliferation and tab-bar mental model rather than making in-tab switching fast.
- **Hide routes or topics with raw CSS `display: none` instead of React 19 `<Activity>`**: rejected — leaves effects, keyboard layers, and background subscriptions active in hidden subtrees instead of suspending them cleanly via React's built-in primitive.
- **Bundle everything into one monolithic PR**: rejected — mixes main-process boot, popup graphics/focus lifecycle, menu infrastructure, virtual-list/router keep-alive, and topic/composer/CodeViewer work into an unreviewable diff.

## Acceptance criteria

- AC1 — When a non-visible `main` window exists at boot, `WindowManager` defers eager secondary-window warmups until `main` emits `ready-to-show` (with bounded fallback cleanup on destroy), `TrayService` decodes/resizes the tray icon once, and `LocalModelService` sweeps stale downloads concurrently in `Phase.Background`. (verification: main lifecycle & localModel tests + boot timing log; owner: main lifecycle)
- AC2 — Global Search removes full-viewport `backdrop-blur`, code-splits `GlobalSearchMessagePreviewPanel`, conditionally renders `ResourceEditDialogHost`, prefetches its panel chunk on hover/focus/idle, defers initial focus reflow, and completes fast open/close transitions (`45ms` open / `animate-none` close) while preserving query, keyboard navigation, preview, and edit dialogs. (verification: GlobalSearch & AppShell tests + CDP/Trace profiling; owner: GlobalSearch)
- AC3 — Closed command menus (`webcontents.context` without static items) and closed list/group/message menus skip eager command-context/shortcut subscriptions, menu action evaluation, and export/text derivation until opened, without altering disabled states, shortcuts, or menu outputs. (verification: command/menus, CommandMenus, ResourceList, SessionItem/Sessions/Topics & MessageMenuBar tests; owner: menus & resource lists)
- AC4 — Single-tab `/app/chat ↔ /app/agents` navigation preserves mounted routes via `<Activity>` without leaking `CommandFocusScope`/shortcuts/portals, while `DynamicVirtualList`, `MessageAnchorLine`, and `ComposerDockTransitionFrame` avoid synchronous reappear layout/scrollTo reflows. (verification: TabRouter, DynamicVirtualList, MessageAnchorLine & ComposerDockTransitionFrame tests + Electron profiling; owner: app layout & virtual list)
- AC5 — Topic switching reuses `ChatComposer`, Tiptap, and `ChatContent` in place without outer `key`-forced remounts (resetting drafts, attachments, knowledge-base scope, editing state via `scopeKey`, and locate tracking cleanly), keeps up to 3 recent topics warm in `<Activity>` LRU order, and avoids redundant `CodeViewer` scroll-parent/margin/unwrapped reflows. (verification: Chat, ChatContent, ChatComposer, useComposerKnowledgeBaseScope & CodeViewer tests + Electron profiling; owner: chat & composer)

## Risks

- **Hidden `<Activity>` boundary leaks**: React `<Activity mode="hidden">` suspends effects while keeping DOM nodes mounted; focus scopes, tooltips, or portals must stay scoped inside the route boundary like `TabRouter`.
- **Bounded memory footprint**: Keeping up to 2 primary routes and up to 3 recent topics warm increases idle DOM memory moderately; strict LRU cap (`3` topics) bounds memory growth.
- **In-place state leakage across `topic.id` switches**: Reusing `ChatComposer` and `ChatContent` in place requires explicit scope resets across drafts, tokens, attachments, knowledge base, locate requests, and message editing state, covered by unit and live tests.
- **Dev vs packaged timing variance**: Electron dev mode incurs unbundled ESM, `jsxDEV`, React DevTools, and diagnostic logging overhead; end-to-end verification compares production bundles (`electron-vite preview`) under identical sequences.
