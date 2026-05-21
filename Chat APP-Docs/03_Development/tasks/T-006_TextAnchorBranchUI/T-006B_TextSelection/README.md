# T-006B 文本选中捕获

**状态**：✅ 已完成 + 已 commit：`d579fdcf2`（feat(messages): tag MainTextBlock DOM with messageId/blockId for branch anchor）
**依赖**：无（与 T-006A 并行）
**实际工作量**：< 0.5 天

## 文件（实施过程中新增 / 改）

- [实施.md](./实施.md) — 改动清单 + 设计决策 + 校验记录
- [验证.md](./验证.md) — 自动化结果 + 浏览器 sanity check 指引
- [完成总结.md](./完成总结.md) — 结果 + 给 T-006C 的接口

## 一句话产出

`utils/branchAnchor/findBlockContext(range)` 把任意 Selection 解出 `{ messageId, blockId }`，跨 block 返回 null；MainTextBlock 加了 `data-message-id` + `data-block-id` 包裹 div。下游 T-006C / T-006D / T-006E 直接 import 即可。

## 目标

让任何选区操作都能拿到 `{ messageId, blockId, selectedText }` 三元组。

## 已交付（vs 原计划）

| 计划 | 实际 |
|---|---|
| `MainTextBlock` 接 `messageId` prop | ✅ |
| 包 wrapper div + `data-block-id` | ✅ |
| `findBlockContext` helper | ✅ |
| 跨 block 检测 | ✅ |
| vitest 至少 1 个 | ✅ 7 个 |
| ~~`data-block-streaming` 属性~~ | ⏸ 移到 T-006C（per Surgical Changes） |

## 实施要点（详见 [../设计.md §1](../设计.md)）

### 1. `MainTextBlock` 接收 `messageId` props

修改：
- `src/renderer/src/pages/home/Messages/Blocks/MainTextBlock.tsx`
  - 接收新 prop `messageId: string`
  - 把 `<Markdown />` 包在 `<div data-message-id={messageId} data-block-id={block.id}>` 内
- `src/renderer/src/pages/home/Messages/Blocks/index.tsx:204`
  - `<MainTextBlock>` 增传 `messageId={message.id}`

### 2. 新 helper `findBlockContext(range): { messageId, blockId } | null`

放置：`src/renderer/src/components/SelectionContextMenu.tsx`（同文件内，因为只这里用）或单独抽 hook（若 T-006D 也要复用）

实现：
```ts
function findBlockContext(range: Range): { messageId: string; blockId: string } | null {
  let node: Node | null = range.commonAncestorContainer
  while (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentNode
  if (!node) return null
  const blockEl = (node as Element).closest('[data-block-id]')
  if (!blockEl) return null
  const messageEl = blockEl.closest('[data-message-id]')
  if (!messageEl) return null
  return {
    blockId: blockEl.getAttribute('data-block-id')!,
    messageId: messageEl.getAttribute('data-message-id')!
  }
}
```

### 3. 跨 block 检测

如果 `range.startContainer` 和 `range.endContainer` 爬到不同的 blockId → 视为跨 block 选区，返回 null 让 T-006C 把新菜单项 disable。

## 验收

- [ ] vitest 1 个：构造 mock DOM（含 nested `<p data-block-id="b1" data-message-id="m1">`），断言 `findBlockContext` 正确返回
- [ ] vitest：跨 block 选区返回 null
- [ ] vitest：无选区 / 空选区返回 null
- [ ] 浏览器手测：在真实 assistant message 上选中文字 → console.log 输出正确 ids

## 不在范围

- 选区**字符偏移**（selectionStart/End）—— v1.0 不存
- selectionchange 实时监听 —— 第一版只在右键打开瞬间取一次
