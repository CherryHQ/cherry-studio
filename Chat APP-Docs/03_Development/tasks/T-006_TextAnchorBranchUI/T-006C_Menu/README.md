# T-006C 扩展 SelectionContextMenu（加分支菜单项）

**状态**：✅ 代码完成 + 自动化全过；⏳ 待 commit
**依赖**：T-006B ✅
**实际工作量**：< 0.5 天

## 文件（实施过程中新增 / 改）

- [实施.md](./实施.md) — 改动清单 + 设计决策 + 校验记录
- [验证.md](./验证.md) — 自动化 + 浏览器手测期望现象
- [完成总结.md](./完成总结.md) — 结果 / 遗留 / 给 T-006D 的接口

## 一句话产出

`SelectionContextMenu` 现在通过 `findBlockContext` 识别选区是否落在单一 `MainTextBlock` 内；右键菜单新增「针对此处提问」+「展开为分支」两项，**只在选中 assistant MainTextBlock 内文本时才点亮**（user 消息 / error card / 跨 block / 无 data 属性 → disabled）；Copy / Quote 行为完全不变。Handler 当前是 `logger.debug` 占位，T-006D / T-006E 接业务。

## 已交付（vs 原计划）

| 计划 | 实际 |
|---|---|
| 扩展 SelectionContextMenu 接 findBlockContext | ✅ |
| 2 个新菜单项 + i18n keys（3 locale） | ✅ |
| disabled 逻辑（无选区 / 跨 block / 无 data） | ✅ |
| **限制只在 assistant MainTextBlock 内启用（user / error card / 无 data → disabled）** | ✅ 补丁：data-message-role + BlockContext.role |
| handler 占位（console / logger debug 输出） | ✅ logger.debug |
| 测试覆盖（enabled / disabled / Copy-Quote 不变 / role 分支） | ✅ 11 + 9 个用例 |
| ~~`data-block-streaming` 属性 + 流式 disable~~ | ⏸ 移到与 T-006D 联动时（守 scope） |
| ~~disabled 时 tooltip 提示~~ | ⏸ 不在用户需求范围 |

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
