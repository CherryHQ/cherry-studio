# Agent Note: 会话列表的事件时读取

Status: implemented

[English](2026-10-31-conversation-list-row-ownership.md) | 中文

## 问题

`Sessions.tsx` 原有 2430 行，`Topics.tsx` 原有 2064 行。两者都是一个组件同时持有列表数据、显示推导、行处理函数、分组菜单、删除流程和拖拽排序。

`Sessions` 的行隔离没有生效。`reconcileSessionListItems` 让未变化的项保持引用相等，这样带 memo 的行可以跳过渲染；但渲染计数测试显示，一条会话变化时其他行仍全部重渲染，原因有两个：

- `handleDeleteSession` 依赖 `filteredGroupedSessions` 和 `sessionGroupBy`，所以每行都收到新的 `onDelete`。
- `ResourceListProvider` 在 `onReorder` 变化时重建 `actions`。`handleSessionReorder` 和 `handleTopicReorder` 依赖列表数据，而行通过 context 订阅 `actions`，`memo` 拦不住。

处理函数只在事件触发时才需要最新数据，而数据本来就在 React 外部：SWR 缓存、`preferenceService` 和 `cacheService`。

## 决定

行继续接收 `item` prop。引用共享已经做到按行失效，只传 ID 会增加迁移成本，却解决不了上述任何一个原因。

**1. 稳定的列表 actions。** `ResourceListProvider` 保持 `actions` 引用稳定，在事件触发时调用宿主最新的处理函数。`useLatest` 位于 `src/renderer/hooks/`，是这一机制唯一认可的位置。

**2. `Sessions` 在事件时读取。** `utils/chat/sessionListHelpers` 中的 `deriveSessionListView` 构建显示列表，渲染和 `handleDeleteSession` 都调用它。`useSessions` 提供 `readSessionListItems`，读取和列表相同的 SWR 键。删除处理函数在触发时读取列表，并叠加乐观改名（`useOptimisticResourceName` 提供的 `withOptimisticNames`）和进行中的拖拽（`optimisticMove`），所以选出的替代项和撤销提示里的名字都和屏幕一致。智能体和工作区不随会话列表变化，所以仍是普通依赖，没有单独的快照 hook。

**3. `Topics` 保留 ref。** `handleDeleteTopicFromMenu` 本来就在触发时读取 `topicsRef` 和 `activeTopicIdRef`，不依赖列表状态。渲染计数测试显示，在时间和助手模式下，一个话题变化时只重渲染该行。把 ref 换成缓存读取，需要多一个读取函数和同样的乐观叠加，却没有可观察的变化。

**4. 功能目录。** `Sessions` 位于 `pages/agents/components/sessions/`，`Topics` 位于 `pages/home/Tabs/components/topics/`，各自通过 `index.ts` barrel 对外。只有边界清楚的部分拆成独立文件：`sessions/` 里是行菜单操作、改名、创建、分组展开、分组结构和工作目录分组处理函数；`topics/` 里是带行组件的列表主体和助手分组菜单。删除流程、排序、分组头，以及把展开状态和显示模式绑在一起的逻辑都留在宿主文件里，两个宿主文件各 1498 行。

**5. 分组菜单仍由宿主构建。** 测量表明菜单回调只造成很少的分组头渲染轮次，所以较长的 `getGroupHeaderAction` 和 `getGroupHeaderContextMenu` 构建函数保持不变。

在 500 条会话、开发构建、7 次中位数的条件下，脚本耗时：单条会话更新从 341 毫秒降到 320 毫秒，删除从 133 毫秒降到 115 毫秒。

## 考虑过的替代方案

- 像 Folo 一样引入 Zustand 或 Jotai：否决。Cherry Studio 已有四套数据系统，数据也已在 React 外部，第五套只会重复 SWR 缓存。
- 只传 ID 的行加 `useSessionById(id, selector)`：暂时否决。SWR 按页缓存而不是按实体缓存，需要在缓存上加实体索引，还要安置乐观改名；现有引用共享不需要这些就能按行失效。
- 同时重新读取智能体和偏好设置的 `useReadSessionListSnapshot` hook：没有实现。两次渲染之间只有会话列表会变，其他输入仍是普通依赖。
- 把 `Topics` 的 ref 换成缓存读取：没有实现。`Topics` 已满足行和删除的标准，而读取函数需要同样的乐观叠加，构建 `Sessions` 读取函数时这正是两个缺陷的来源。
- 按职责全部拆开，直到没有文件超过 800 行：实际做过后否决。`Sessions.tsx` 虽然降到 759 行，但剩下的 4 个 hook 需要 11–25 个参数，都只调用一次，改动时仍要和宿主一起改。总行数增加约 650 行，没有带来复用或解耦。
- 在每个宿主用 `useLatest` 保存列表状态：对 `Sessions` 否决。它能解决渲染开销，但每个处理函数都隐式依赖宿主状态，推导也还留在组件里。
- 分组菜单自有化，并用 `ResourceList` 组件插槽替换 `getGroupHeaderContextMenu`：实测后否决。在开发构建、50 个智能体、11 个已挂载分组头的条件下，菜单回调只造成置顶时 12 轮分组头渲染中的 2 轮、侧边栏切换时 1 轮中的 1 轮、会话更新时 7 轮中的 1 轮。按每次分组头渲染约 0.55 毫秒估算，这只能在耗时 93–255 毫秒的操作上省下 5–12 毫秒，而菜单本来约 45 毫秒就能打开。它还会改变 `ResourceList` 的共享约定，并让每个已挂载的分组头多一份订阅。
- 懒加载菜单项加订阅 hook：否决。它需要给 `CommandPopupMenu` 增加 `getExtraItems` 和 `subscribeExtraItems`，只是为了补偿菜单状态放在宿主里。
- 两个宿主共用 `ConversationList`：否决。删除顺序、拖拽规则和分组维度是有意不同的，两者只有 6–7% 的代码行相同。

## 后果

- 一条会话或话题变化时只重渲染一行。分组头在每次列表变化时仍会重渲染：一次置顶会让所有已挂载的分组头渲染 12 轮。这里没有处理这部分开销。
- 两个宿主读取当前数据的方式不同。`Sessions` 通过 `readSessionListItems` 读取 SWR 缓存，`Topics` 读取 ref。读取缓存的处理函数必须自己叠加乐观状态，就像 `handleDeleteSession` 那样。
- `readSessionListItems` 读取 SWR 缓存，而行渲染的是 provider 提交的快照，所以后台刷新期间缓存可能略早于行。`resourceViewSources.ts` 记录了这一点。
- `useReadCache` 需要包含 `limit` 的精确查询键。`useSessions` 只构造一次键，列表和读取函数共用，并有真实缓存测试保护。
- 归档当前话题时，会为该话题的 `GET /topics/:id` 记录一条找不到的错误，因为 `Topics` 先删除再切换选中项。这在本次改动之前就存在。

## 验证

- AC1 — `src/renderer/components/chat/resourceList/base/__tests__/ResourceList.test.tsx` 的"keeps actions stable when host handlers change, and calls the latest handler"（#23352）。
- AC2 — `src/renderer/hooks/useLatest.ts` 被 `ResourceListProvider.tsx`、`AgentComposer.tsx` 和 `ChatComposer.tsx` 引用；composer 测试无需修改即通过（#23352）。
- AC3 — `src/renderer/pages/agents/components/sessions/__tests__/Sessions.test.tsx` 的"re-renders only the changed row"覆盖时间、智能体和工作目录三种模式；让 `handleDeleteSession` 重新依赖列表时三者都会失败（#23389）。
- AC4 — `Sessions.test.tsx` 的"picks the replacement from the latest list when deleting the active session"，加上未保存改名和未确认拖拽两个用例，以及基于真实 SWR 缓存的 `src/renderer/hooks/agent/__tests__/useSession.readList.test.ts`；每个用例在修复前都会失败（#23389）。
- AC5 — 搬移后 217 个渲染层测试无需修改即通过，逐行对比显示只有导出、路径和接线变化，Electron 中选中、改名、拖拽、归档、撤销和分组菜单流程都通过（#23413）。
- AC6 — `src/renderer/pages/home/Tabs/components/topics/__tests__/Topics.test.tsx` 的"rerenders only the changed topic row"覆盖时间和助手模式，删除处理函数依赖列表时会失败；现有删除测试覆盖同助手替代项和删除过程中的变化；Electron 中两种模式下的选中、改名、归档、撤销流程和助手分组菜单都通过；唯一未通过的检查是原本就有的找不到日志。
- AC7 — Electron、开发构建、500 条会话、7 次中位数：单条会话更新在第 1 层之前为 341 毫秒，最后一层之后为 320 毫秒；删除分别为 133 毫秒和 115 毫秒。
