# T-006D Branch Panel 组件

**状态**：🔧 进行中（拆为 D-1/D-2/D-3 渐进）
**依赖**：T-006C ✅
**预估**：1–1.5 天（最大子任务，已拆）

## 子步进度

| ID | 主题 | 状态 | 入口 |
|---|---|---|---|
| T-006D-1 | Shell 原型（Dialog + state + 字段显示 + 占位 handler） | ✅ 代码完成；⏳ commit | [T-006D-1_Shell/](./T-006D-1_Shell/) |
| T-006D-2 | 真实 fork 调用 + useCache anchor 持久化 + 流式 disable | ⏳ 待启动 | — |
| T-006D-3（可选） | Sheet 侧滑替代 Dialog + "针对此处提问" 注入 inputbar | ⏳ 待启动 | — |

## 目标

新增 `BranchPanel` 组件 + 临时 anchor 状态管理 + fork 调用。

## 数据形态（详见 [../设计.md §3](../设计.md)）

```ts
interface BranchAnchor {
  anchorId: string             // UUID v7
  sourceTopicId: string
  sourceMessageId: string
  sourceBlockId: string
  selectedText: string
  createdAt: string            // ISO
  // v1.0 留位但不存：selectionStart/End
}
```

## 实施要点

### 1. 状态管理：临时 cache，不进 Redux

新建 hook：`src/renderer/src/hooks/useBranchAnchors.ts`
- 用 `useCache` 存 `branch-anchor.${topicId}.${anchorId}` → `BranchAnchor`
- 暴露 `{ anchors, add, remove, openPanel(anchorId), closePanel }` —— 后两个用 ephemeral cache key 控制
- 不持久化（v1.0 设计取舍）

### 2. UI 组件

新建：`src/renderer/src/pages/home/Messages/BranchPanel.tsx`

容器形态推荐：
- **Sheet**（来自 `@cherrystudio/ui`）从右侧滑入，固定宽度 360–420px；不抢消息流空间
- 或 Drawer + overlay；用 `@cherrystudio/ui` 已有原语

内容：
```
┌─ Branch Panel ─────────────────────────┐
│ from message #abcdef                   │  ← header（点击可滚回原 message）
├────────────────────────────────────────┤
│ "<引用选区，黄底 + 灰边框>"              │  ← selectedText preview
├────────────────────────────────────────┤
│ ┌──────────────────────────────────┐   │
│ │ <input/textarea>                  │   │  ← 新提问输入
│ └──────────────────────────────────┘   │
├────────────────────────────────────────┤
│  [取消]              [→ 开新分支]      │  ← actions
└────────────────────────────────────────┘
```

### 3. fork 调用（点 "开新分支"）

```ts
const newTopic = await dataApiService.post('/topics', {
  body: {
    name: anchor.selectedText.slice(0, 30),
    assistantId: currentAssistant.id === 'default' ? null : currentAssistant.id, // T-004 兼容
    sourceNodeId: anchor.sourceMessageId
  }
})
setActiveTopic(newTopic)
// 把 selectedText + 用户输入注入新 topic 的 user message
// 注：发送动作由现有 messageThunk.sendMessage 处理
```

### 4. "针对此处提问"（不切 topic）

- 把 selectedText 作为引用块注入当前 inputbar
- 不调 `POST /topics`
- 关闭 Panel

### 5. 集成进 Chat.tsx

`src/renderer/src/pages/home/Chat.tsx` 顶级渲染 `<BranchPanel />`，根据 anchor cache 是否有 open id 决定可见。

## 验收

- [ ] anchor cache 在 topic 内可读可写，切 topic 自动清空
- [ ] 选中文字 + 右键 + 点 "展开为分支" → Sheet 滑入
- [ ] Sheet 显示选区引用 + 输入框
- [ ] 点 "开新分支" → `POST /topics` 成功 → 切到新 topic
- [ ] 点 "取消" → Sheet 关闭，anchor 仍保留在 cache（供高亮点击重开）
- [ ] "针对此处提问" 注入当前 inputbar 并关闭 Panel
- [ ] 新 topic 的对话历史能 reach 源 message（v2 fork 自动）

## 不在范围

- anchor 持久化（v1.1+）
- 跨 topic 显示 anchor 列表（v1.1+）
- BranchPanel 历史栈 / 多 anchor 同时打开（v1.0 只支持单 anchor active）
