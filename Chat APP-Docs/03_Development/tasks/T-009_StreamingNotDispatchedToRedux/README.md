# T-009 流式数据未回灌 Redux（D-004 + D-005 同源诊断）

**关联 issue**：D-004（assistant 文本上 Ask/Open 仍 disabled）+ D-005（assistant 回复结束后底部三个点不消失）
**状态**：🩺 诊断完成；🔧 修复方案待用户决策（A: cache→Redux 桥 / B: 渲染层切 cache / C: 完成时单次 dispatch）
**记录日期**：2026-05-21

## 文件

- [任务.md](./任务.md) — brief
- [诊断.md](./诊断.md) — 完整调用链 + 同源解释 + 3 条修复路径
- 本 README — 一句话产出 + 修复矩阵

## 一句话

T-008C 修了 Chat picker，但更深一层的同款"v1/v2 数据断层"还没修：**整条流式管线（StreamingService + BlockManager + 所有 callbacks）写的是 `cacheService` 内存 + DataApi/SQLite，但完全不 dispatch 到 Redux `messageBlocksSelectors` / `messages` slice**。然而 `MessageBlockRenderer`（`Blocks/index.tsx:117-123`）仍然只读 Redux。结果：

- Redux 的 assistant Message 永远是 fresh-create 状态：`blocks: []`、`status: PENDING`
- `MessageBlockRenderer` 拿不到任何 block → MainTextBlock 不被渲染 → 没有 `data-message-id` + `data-block-id` + `data-message-role="assistant"` wrapper → `findBlockContext` 返回 null → Ask/Open 永远 disabled（**D-004**）
- `isMessageProcessing(message)` 因 `status === PENDING` 永远 true → `Blocks/index.tsx:253-265` 的 `PlaceholderBlock` 永远渲染 → BeatLoader 永远转（**D-005**）

D-004 和 D-005 **是同一个 bug 的两个面**，修一处都修。

## 用户能看到 assistant 文本的解释

如果用户**确实看到了 assistant 回复文本**（非空白），那是因为 `loadTopicMessagesThunk` 在切换 topic 或 fresh load 时**从 SQLite 重新拉**了 assistant message + blocks 到 Redux —— 即 streaming 结束后切走再切回来才能看到。**在流中或刚结束未切 topic 时，Redux 仍是空的**。这是诊断的关键提示。

## 与 T-007 / T-008C 的关系

T-007 D-003B 修了 providers.json 数据 / T-008C D-003C 修了 Chat picker 数据源；本 issue 是**消息渲染层**的同款问题：v2 写 / v1 读，没有桥。3 个 issue 同源 = "v2 迁移做了一半"。

## 修复矩阵（详见 [诊断.md §6](./诊断.md)）

| 方案 | 触发 | 改动 | 优 | 劣 |
|---|---|---|---|---|
| **A: cache→Redux 桥** | streamingService.{addBlock, updateBlock, updateMessage, finalize} 同步 dispatch | ~30 行 in StreamingService | 实时反应；流中也对 | 双写两个 store，留 v2 迁移技术债 |
| **B: 渲染层切 cache** | Blocks/index.tsx 读 useSharedCache(getBlockKey)，message 读 useSharedCache(getMessageKey)；fallback Redux | ~50 行 in renderer | 单一数据源；与 v2 方向对齐 | 影响 MessageBlockRenderer 主链路；测试要重写 |
| **C: 完成时单次 dispatch** | onComplete callback finalize 之后 dispatch upsertManyBlocks + updateMessage | ~10 行 in baseCallbacks | 最小手术 | 流中仍卡 3 点 + 空 wrapper；只解决"完成后"的视图问题 |

**短期推荐 A**（与 T-008C 选 A 同款短期策略：解锁 T-006 Text Anchor 实测，留双写技术债到 v2 完整迁移）。

## 不在范围

- 修复 v1/v2 渲染层完整迁移（属于 v2 大方向独立 task）
- 修 streaming 中 useSmoothStream 的 reset 时机（与本 issue 同源但要等渲染层切换确定后再决定）
- 修 regenerate / 默认模型策略（独立 issue D-006 / D-007）
