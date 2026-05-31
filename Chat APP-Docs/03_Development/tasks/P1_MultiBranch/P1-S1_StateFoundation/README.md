# P1-S1 — State Shape Foundation（branches[] 数组化）

**状态**：✅ 已完成（2026-06-01；focused 36/36 绿；待 commit）
**前置**：T-006E source-passage highlight 已 closed
**前一篇**：[[../README|P1 概览]]

---

## 目标

把单分支双 useState（`branchAnchor: BranchAnchor | null` + `branchTopic: Topic | null`）推广成 `branches: Branch[]` 数组形 state，所有派生（BranchAnchorContext / BranchAssistantContext / BranchPane props）一并改成 list-based，**且 `branches.length ≤ 1` invariant 保持 —— 用户视角零行为变化**。

> 「state foundation」= 状态形态先做好，行为还是单分支。下一步 S2 才在这套基础上解约束 + 加多分支 UI。

## 为什么要先单独做

> P1 里最高风险的状态迁移 = state shape。一旦 shape 改错，N 个下游会同时碎掉。所以把这一步**单独隔离**：
> - 不加 UI，用户没法跑出 length > 1
> - 不动 paint/clear/wrap（length ≤ 1 时它们的语义还正确）
> - 不动 fork / streaming / provider / model picker / Redux / Dexie
> - 测试断言全部不变，只换 Context value 的 shape

这样如果有问题，回退面很窄；通过则 S2/S3 可以直接在 N-shape 上建。

## 新 type — `Branch`

`src/renderer/src/pages/home/Messages/BranchPanel/types.ts`：

```ts
export interface Branch {
  id: string                  // 客户端 uuid v4，≠ topic.id；UI 列表 key
  source: {
    messageId: string
    blockId: string
    selectedText: string
    offsets: { start: number; end: number }
  }
  topic: Topic | null         // null = 正在 POST /topics / 还没创建；S2 也保留这个 null 通道
  createdAt: number           // wall-clock millis，排序 + debug
}
```

`BranchAnchor`（5 字段）保留 —— 它仍是 SelectionContextMenu → Messages → Chat 的 hand-off 形态，也是 `useBranchFork.fork()` 的输入。Chat.tsx 在两边做适配翻译。

## 改动逐项

| 文件 | 改动 | 说明 |
|---|---|---|
| `BranchPanel/types.ts` | + `import { Topic }` + 新增 `Branch` 接口 | 1-for-1 文档化 |
| `BranchPanel/index.ts` | 多 export `Branch` 类型 | 给 Chat.tsx 用 |
| `context/BranchAnchorContext.tsx` | `BranchAnchorHighlight` 字段从 `{highlightedBlockId, ...}` 改成 `{branchId, blockId, selectionStart, selectionEnd}`；新增 `BranchAnchorContextValue = { anchors: BranchAnchorHighlight[] }`；hook 返回值改 `BranchAnchorContextValue`；默认值 `{ anchors: [] }` | `__BRANCH_ANCHOR_CTX_CACHE__` HMR 缓存模式**完全保留** —— 仅类型参数改 shape |
| `pages/home/Chat.tsx` | 两个 useState → `branches: Branch[]` + `collapsedBranchIds: Set<string>`；加 `openBranchAnchor` 包 BranchAnchor→Branch；onCreated 用 functional updater 写 .topic；新增 `composerAnchor` / `activeBranchTopic` 适配 BranchPane prop；`branchTopics` filter Boolean；`branchOverride` 改成 spread；`branchAnchorHighlight` map 出 anchors[]；close 路径 setBranches([]) + setCollapsedBranchIds(new Set()) | 唯一的「真改」入口 |
| `Messages/Blocks/MainTextBlock.tsx` | 解构 `{ anchors }`；useMemo `matchingAnchors = anchors.filter(blockId match + offsets valid)`；effect 改成迭代（length ≤ 1 时单次 paint，行为不变） | 注释明确写 S2 才解 length ≤ 1 |
| `Messages/Blocks/__tests__/MainTextBlock.test.tsx` | `highlight()` helper 改成产 `{ anchors: [...] }` shape；**断言一字不动** | 测试覆盖 = 同样的真行为，只是 Provider value shape 变 |

### 未改 — sourceHighlight.ts 字节零变化

```
$ git diff -- src/renderer/src/utils/branchAnchor/sourceHighlight.ts
（空）
$ git diff -- src/renderer/src/utils/branchAnchor/__tests__/sourceHighlight.test.ts
（空）
```

## Length ≤ 1 等价性证明

对每个派生值，列对应的旧/新表达式 + length ≤ 1 时的化简：

| 派生 | 旧表达式 | 新表达式 | length ≤ 1 时化简 |
|---|---|---|---|
| Context value | `{ highlightedBlockId: branchAnchor?.blockId ?? null, selectionStart: branchAnchor?.selectionStart ?? 0, selectionEnd: branchAnchor?.selectionEnd ?? 0 }` | `{ anchors: branches.map(b => ({ branchId: b.id, blockId: b.source.blockId, selectionStart: b.source.offsets.start, selectionEnd: b.source.offsets.end })) }` | 字段 1-to-1 映射，单元素 list |
| `synthetic.topics` | `[...assistant.topics, branchTopic]` | `[...assistant.topics, ...branchTopics]` 且 `branchTopics = branches.map(b => b.topic).filter(Boolean)` | 同一 Topic 单元素 spread = 同一 entry |
| MainTextBlock effect 条件 | `if (!isBranchAnchored \|\| selectionStart >= selectionEnd) return` | `if (matchingAnchors.length === 0) return`；matchingAnchors filter 已经做了 blockId 匹配 + offsets 校验 | 等价 |
| MainTextBlock effect 主体 | `paintSourceHighlight(el, selectionStart, selectionEnd)` | `for (const a of matchingAnchors) paintSourceHighlight(...)` | length ≤ 1 时 for 跑 0 或 1 次，与旧 path 一一对应 |
| BranchPane.anchor 输入 | `branchAnchor` (BranchAnchor \| null) | `composerAnchor` (从 `branches[0]?.source` 翻译回 BranchAnchor) | branches.length ≤ 1 时 `branches[0] = previously branchAnchor` |
| BranchPane.branchTopic 输入 | `branchTopic` | `activeBranchTopic = branches[0]?.topic ?? null` | 同上 |
| close 路径 | `setBranchAnchor(null) + setBranchTopic(null)` | `setBranches([]) + setCollapsedBranchIds(new Set())` | 都把 derived 三态归零 |

## 测试

### 改 1 处（test helper）—— 断言一字不动

`MainTextBlock.test.tsx` 的 `highlight()` helper 改成产新 shape：

```ts
const highlight = (blockId: string | null, start = 0, end = 0) =>
  blockId === null
    ? { anchors: [] }
    : { anchors: [{ branchId: 'test-branch-1', blockId, selectionStart: start, selectionEnd: end }] }
```

5 个 highlight 用例签名不变，全绿。

### Non-vacuous check（验证测试不是 vacuous-green）

迁移完成后临时把 "matched block injects span" 用例的 Provider value 从 `highlight('blk-A', 0, 8)` 改成 `highlight(null)`，跑：
- 期望：RED（`length > 0` 失败）
- 实际：RED ✓（line 518 失败）
- 然后还原 → 重跑 → GREEN

证明断言确实依赖 paint 真的注入了 span，不是 trivially 成立的。

### sourceHighlight.test.ts —— 未动一字，15/15 仍绿

## 结果

- focused 36/36 全绿（sourceHighlight 15 + MainTextBlock 21）
- `pnpm lint` 全过（typecheck web + node + aicore + i18n + format + biome lint）
- `sourceHighlight.ts` git diff 空
- `__BRANCH_ANCHOR_CTX_CACHE__` 模式保留（注释也保留并加 P1-S1 备注）
- 用户视角：开分支 → 高亮出现 → 关闭 → 高亮清；A → B 切换；close path —— 跟之前一字不差（通过测试覆盖 + length ≤ 1 等价性证明）

## 后续

- **P1-S2** 解 length ≤ 1 + 加多分支 UI + 加 paintSourceHighlight 的 per-branch span 标识
- **P1-S3** disposition（discard vs save on close）
