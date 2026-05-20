# T-006E 高亮标注

**状态**：⏳ 待启动
**依赖**：T-006C（菜单触发）+ T-006D（anchor 数据）
**预估**：1 天

## 目标

在选区位置注入临时 `<mark class="branch-anchor-hl">` 高亮；切 topic 清空；点击重开 Panel。

## 实施要点（详见 [../设计.md §4](../设计.md)）

### 1. 注入函数 `highlightSelection(range, anchorId)`

```ts
function highlightSelection(range: Range, anchorId: string): boolean {
  try {
    const mark = document.createElement('mark')
    mark.className = 'branch-anchor-hl'
    mark.dataset.anchorId = anchorId
    range.surroundContents(mark)
    return true
  } catch (e) {
    // 跨段落选区会抛 INVALID_STATE_ERR
    logger.warn('Selection crosses block boundary; highlight skipped', { anchorId })
    return false
  }
}
```

### 2. CSS

放 `src/renderer/src/pages/home/Messages/Blocks/branchAnchor.css`（或 Tailwind utility class —— 实施时确定）：

```css
mark.branch-anchor-hl {
  background-color: hsl(48 100% 88%);
  border-bottom: 1.5px dashed hsl(43 80% 50%);
  padding: 0 1px;
  cursor: pointer;
  transition: background-color 150ms;
}
mark.branch-anchor-hl:hover {
  background-color: hsl(48 100% 78%);
}
@media (prefers-color-scheme: dark) {
  mark.branch-anchor-hl {
    background-color: hsl(48 70% 25%);
    color: inherit;
  }
}
```

### 3. 点击 `<mark>` 重开 Panel

事件委托：在 `MessageContentContainer` 上挂 `onClick`，event.target.closest('mark.branch-anchor-hl') → 取 `data-anchor-id` → 调用 `useBranchAnchors().openPanel(anchorId)`。

### 4. 流式块禁用

T-006C 已做：`block.status !== 'success'` 时菜单 disabled。本任务不需要额外措施 —— 高亮自然不会被注入。

### 5. block.id 变化时清 anchor

`useEffect` 在 MainTextBlock 里监听 `block.id` 变化（新 block 取代旧 block），调 `useBranchAnchors().removeByBlockId(blockId)` 清理对应 anchor。

### 6. 切 topic 自动清

`useCache` 的 key 含 `topicId`，切 topic 后旧 key 不会被读到；不需要显式清空。**但**：已注入 DOM 的 `<mark>` 标签是切 topic 时 React 自动卸载消息组件 → DOM 一起销毁。✅ 自然清。

## 验收

- [ ] 选中文字 → 右键 → "展开分支" → 选区获得黄底 `<mark>` 高亮
- [ ] hover 高亮：颜色加深
- [ ] 点击高亮 → 重开 Branch Panel
- [ ] 切到别的 topic → 高亮消失（DOM 卸载）
- [ ] 切回原 topic → 高亮**不**恢复（v1.0 接受这一限制；持久化是 v1.1+）
- [ ] 跨段落选区时 `surroundContents` 抛错，T-006C 已 disable 入口 + 这里 try/catch fallback log warn
- [ ] dark mode 颜色正确

## 已知限制（v1.0 接受）

- 切 topic 回来高亮丢（不持久化）
- 跨段落不支持
- 流式中高亮不可建（菜单 disabled）
- Markdown 重渲染（如用户编辑消息后重新渲染）会丢高亮

## v1.1 升级路径

迁移到 **CSS Custom Highlight API**（`CSS.highlights`）：
- 用 Range 对象 + `new Highlight(...)` 注册到 `CSS.highlights`
- 不污染 DOM（不需要插 `<mark>` 标签）
- React 重渲染时 Range 仍然有效（除非节点被替换）
- Chromium ≥ 105 支持，Electron 较新版本 OK
