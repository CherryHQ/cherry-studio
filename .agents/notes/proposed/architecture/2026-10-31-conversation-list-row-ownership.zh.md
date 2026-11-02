# Agent Note: 会话列表的事件时读取

Status: proposed

[English](2026-10-31-conversation-list-row-ownership.md) | 中文

## 问题

`Sessions.tsx` 有 2430 行，`Topics.tsx` 有 2064 行。两者都是一个组件同时持有列表数据、显示推导、行处理函数、分组菜单、删除流程和拖拽排序。下层代码全部闭包依赖这些状态，带来两项具体代价。

行隔离没有生效。`reconcileSessionListItems` 和 `reconcileTopicListItems` 让未变化的项保持引用相等，这样带 memo 的行可以跳过渲染。但渲染计数测试显示，一条会话变化时其他行仍全部重渲染，原因有两个：

- `handleDeleteSession` 依赖 `filteredGroupedSessions` 和 `sessionGroupBy`，所以每行都收到新的 `onDelete`。
- `ResourceListProvider` 在 `onReorder` 变化时重建 `actions`。`handleSessionReorder` 和 `handleTopicReorder` 依赖列表数据，而行通过 context 订阅 `actions`，`memo` 拦不住。

分组菜单需要很长的依赖数组。菜单状态在宿主里，所以 `getGroupHeaderAction` 和 `getGroupHeaderContextMenu` 都依赖它，并各自重复同一份操作上下文。探索时试过 ref 和懒加载菜单订阅，两者都只是转移了绕路，没有消除它。

处理函数只在事件触发时才需要最新数据。它们闭包依赖状态，只是因为目前只能从宿主读取；而数据其实已在 React 外部：SWR 缓存、`preferenceService` 和 `cacheService`。

## 方案

行继续接收 `item` prop。引用共享已经做到按行失效，只传 ID 会增加迁移成本，却解决不了上述任何一个原因。

**1. 稳定的列表 actions。** `ResourceListProvider` 保持 `actions` 引用稳定，在事件触发时调用宿主最新的处理函数。actions 只在事件时运行，因此行为不变。`useLatest` 从 `components/composer/variants/shared/` 移到 `hooks/`，作为这一机制唯一认可的位置。

**2. 事件时的列表快照。** 显示推导移到 `utils/chat/sessionListHelpers` 和 `topicsHelpers` 的纯函数中。`useReadSessionListSnapshot` 这样的 hook 返回一个稳定的读取函数，用 `useReadCache` 和 `preferenceService.getCachedValue` 构建当前视图。处理函数调用读取函数，不再闭包依赖列表状态：

```ts
const readSnapshot = useReadSessionListSnapshot()
const handleDelete = useCallback(async (id: string) => {
  const { items, groupBy } = readSnapshot()
  // choose the neighbour from current data
}, [readSnapshot])
```

渲染列表和读取函数共用同一组纯函数，所以顺序不会不一致。响应式渲染仍使用 `useQuery`，快照只给处理函数用。

**3. 功能目录。** `Sessions` 按职责拆到 `pages/agents/components/sessions/`：列表宿主、行操作、分组菜单、删除流程、排序。这个模式验证后，`Topics` 采用相同结构。分组菜单的构建方式保持不变，随拆分一起移动。

### 预期性能

以下是预期效果，不是实测结果。渲染计数测试证明了目前行会重渲染，但还没有测过耗时。

- 行更新：一条会话变化时只重渲染一行，而不是所有已挂载的行。第 1 层和第 2 层实现这一点。
- 处理函数引用：列表变化时不再重建处理函数，下游也不会因此失效。
- 新增成本：处理函数在每次事件时推导视图。之前离线测过排序 2000 条约 10 毫秒，所以事件开销应该很小，但必须由 AC7 确认。

只有几十条会话的用户可能感觉不到差别。列表很长或流式输出时列表频繁更新，收益才会明显。

交付采用栈式 PR，每一层都能单独合并。AC7 的耗时基线要在第 1 层改代码之前记录：

1. 稳定的 actions 和 `useLatest`（AC1、AC2）。
2. `Sessions` 快照读取和行处理函数（AC3、AC4）。
3. `Sessions` 功能目录（AC5）。
4. `Topics` 迁移（AC6、AC7）。

## 考虑过的替代方案

- 像 Folo 一样引入 Zustand 或 Jotai：否决。Cherry Studio 已有四套数据系统，数据也已在 React 外部，第五套只会重复 SWR 缓存。
- 只传 ID 的行加 `useSessionById(id, selector)`：暂时否决。SWR 按页缓存而不是按实体缓存，需要在缓存上加实体索引，还要安置乐观改名；现有引用共享不需要这些就能按行失效。
- 在每个宿主用 `useLatest` 保存列表状态：不作为最终方案。它能解决渲染开销，但每个处理函数都隐式依赖宿主状态，推导也还留在组件里。
- 分组菜单自有化，并用 `ResourceList` 组件插槽替换 `getGroupHeaderContextMenu`：实测后否决。在开发构建、50 个智能体、11 个已挂载分组头的条件下，菜单回调只造成置顶时 12 轮分组头渲染中的 2 轮、侧边栏切换时 1 轮中的 1 轮、会话更新时 7 轮中的 1 轮。按每次分组头渲染约 0.55 毫秒估算，这只能在耗时 93–255 毫秒的操作上省下 5–12 毫秒，而菜单本来约 45 毫秒就能打开。它还会改变 `ResourceList` 的共享约定，并让每个已挂载的分组头多一份订阅。
- 懒加载菜单项加订阅 hook：否决。它需要给 `CommandPopupMenu` 增加 `getExtraItems` 和 `subscribeExtraItems`，只是为了补偿菜单状态放在宿主里。
- 两个宿主共用 `ConversationList`：否决。删除顺序、拖拽规则和分组维度是有意不同的，两者只有 6–7% 的代码行相同。

## 验收标准

- AC1 — 宿主重建 `onReorder`、`onSelectItem` 或其他列表处理函数时，`actions` 引用不变，下一次事件调用最新的处理函数。（验证：单元测试）
- AC2 — `useLatest` 位于 `src/renderer/hooks/`，现有 composer 调用方改用该位置，其测试无需修改即通过。（验证：单元测试）
- AC3 — 一条会话变化时，在时间、智能体、工作目录三种展示模式下都只重渲染该行。（验证：渲染层测试）
- AC4 — 列表变化后删除当前会话，替代项取自当前显示的列表，且 `handleDeleteSession` 不再依赖列表状态。（验证：渲染层测试）
- AC5 — `Sessions` 位于功能目录中，没有文件超过 800 行，选中、改名、拖拽、归档和撤销都不变。（验证：渲染层测试和 Electron）
- AC6 — `Topics` 在时间和助手模式下满足 AC3、AC4 和 AC5。（验证：渲染层测试和 Electron）
- AC7 — 在 500 条会话下，分别在第 1 层之前和最后一层之后分析单条会话更新和删除的耗时，在最后的 PR 中报告数据，两者都不比基线慢。（验证：Electron）

## 风险

- 快照读取的是服务端数据，不含拖拽进行中这类乐观覆盖。需要这些状态的处理函数必须显式传入；如果这样的处理函数变多，就要重新评估读取函数的范围。
- `useReadCache` 需要包含 `limit` 的精确查询键，所以读取函数必须和 `useSessions` 共用键构造逻辑，否则会静默读不到数据。AC4 覆盖这一点。
