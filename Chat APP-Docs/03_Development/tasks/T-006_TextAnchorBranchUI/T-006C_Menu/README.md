# T-006C 扩展 SelectionContextMenu（加分支菜单项）

**状态**：⏳ 待启动
**依赖**：T-006B
**预估**：0.5 天

## 目标

在已有的 `SelectionContextMenu` 上扩展两条菜单项：「展开为分支」「针对此处提问」。

## 实施要点

### 1. 修改 `src/renderer/src/components/SelectionContextMenu.tsx`

在 `handleOpenChange` 里调 T-006B 的 `findBlockContext(range)` → 设置 state `{ blockId, messageId }`。

```tsx
// 新增菜单项
<ContextMenuItem
  disabled={!hasSelection || !blockContext || isStreaming}
  onSelect={handleOpenAsBranch}>
  {t('chat.message.anchor.open_as_branch')}
</ContextMenuItem>
<ContextMenuItem
  disabled={!hasSelection || !blockContext}
  onSelect={handleAskHere}>
  {t('chat.message.anchor.ask_here')}
</ContextMenuItem>
```

### 2. 流式状态判定

需要从 DOM 反向查 block.status 不现实。两种方案：
- **A. 用 data 属性传 status**：T-006B 顺带在 `MainTextBlock` 的 wrapper div 加 `data-block-streaming="true|false"`；右键时读出来
- **B. 用 Cache key 查**：cacheService 里查 streaming task；麻烦
- **选 A**

### 3. 菜单 handler

`handleOpenAsBranch` / `handleAskHere` 只负责：
- 调用 `useBranchAnchors().add({ ...anchor })`（T-006D 提供 hook）
- 通过事件 / Redux 通知 BranchPanel 打开（T-006D 决定通信机制）
- 调用 T-006E 的 `highlightSelection(range, anchorId)` 注入 `<mark>`

具体 callback 实现接口对齐留给 T-006D / T-006E。

### 4. i18n key 新增

- `chat.message.anchor.open_as_branch` = "展开为分支" / "Open as branch"
- `chat.message.anchor.ask_here` = "针对此处提问" / "Ask about this"
- `chat.message.anchor.cross_block_hint` = "请将选区限制在同一段落内" / "Selection must stay within one paragraph"（disabled 时 tooltip 内容）

跑 `pnpm i18n:sync` 同步多语言。

## 验收

- [ ] 右键弹菜单显示 4 项：Copy / Quote / 展开为分支 / 针对此处提问
- [ ] 无选区时 "展开" 与 "针对此处提问" disabled
- [ ] 跨 block 选区时新菜单项 disabled（hover 显示 tooltip 提示）
- [ ] 流式状态时 "展开为分支" disabled（"针对此处提问"不依赖高亮，可以保留）
- [ ] 已有 Copy / Quote 行为不变
- [ ] `pnpm i18n:check` 通过

## 不在范围

- 浮动菜单（v1.1）
- 键盘快捷键（v1.1）
