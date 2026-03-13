# CherryClaw 频道系统

频道系统为 CherryClaw 提供 IM 集成能力，允许用户通过 Telegram 等即时通讯平台与代理交互。系统采用抽象适配器模式，支持未来扩展到 Discord、Slack 等平台。

## 架构

```
ChannelManager (单例, 生命周期管理)
  ├── adapters Map<key, ChannelAdapter>      — 活跃的适配器实例
  ├── notifyChannels Set<key>                — 标记为通知接收者的频道
  ├── start()   → 加载所有 CherryClaw agent，为启用的频道创建适配器
  ├── stop()    → 断开所有适配器
  └── syncAgent(agentId) → 断开旧适配器，根据当前配置重建

ChannelAdapter (抽象 EventEmitter)
  ├── connect() / disconnect()
  ├── sendMessage(chatId, text, opts?)
  ├── sendMessageDraft(chatId, draftId, text)  — 流式草稿更新
  ├── sendTypingIndicator(chatId)
  └── Events: 'message' → ChannelMessageEvent
              'command' → ChannelCommandEvent

ChannelMessageHandler (单例, 无状态消息路由)
  ├── handleIncoming(adapter, message)   — 路由到代理 session
  ├── handleCommand(adapter, command)    — 处理 /new /compact /help
  └── sessionTracker Map<agentId, sessionId>  — 每个 agent 的活跃 session
```

## 适配器注册

适配器通过 `registerAdapterFactory(type, factory)` 自注册。导入适配器模块即触发注册：

```typescript
// src/main/services/agents/services/channels/adapters/TelegramAdapter.ts
registerAdapterFactory('telegram', (channel, agentId) => {
  return new TelegramAdapter({ channelId: channel.id, agentId, channelConfig: channel.config })
})
```

`ChannelManager` 启动时导入所有适配器模块（通过 `channels/index.ts`），适配器的 `registerAdapterFactory` 调用作为模块副作用执行。

## 消息处理流程

### 用户消息

```
用户在 Telegram 发送消息
  → TelegramAdapter 触发 'message' 事件
  → ChannelManager 转发给 ChannelMessageHandler.handleIncoming()
    1. resolveSession(agentId)
       → 检查 sessionTracker → 查询已有 session → 创建新 session
    2. 发送 typing indicator（每 4s 刷新一次）
    3. 生成随机 draftId
    4. collectStreamResponse(session, text, abort, onDraft):
       - 创建 session message（persist: true）
       - 读取 stream：
         text-delta → 更新 currentBlockText（块内累积）
         text-end   → 提交到 completedText，重置当前块
       - 每 500ms 通过 sendMessageDraft 发送草稿
    5. sendMessage(chatId, finalText) — 超过 4096 字符自动分块
```

### 命令处理

| 命令 | 行为 |
|---|---|
| `/new` | 创建新 session，更新 sessionTracker |
| `/compact` | 向当前 session 发送 `/compact`，收集响应 |
| `/help` | 返回代理名称、描述和可用命令列表 |

## 流式响应

CherryClaw 的流式响应遵循以下规则：

- `text-delta` 事件在同一个文本块内是**累积的**——每个事件包含到目前为止的完整文本，而非增量
- `ChannelMessageHandler` 在块内使用 `text = value.text`（替换），在 `text-end` 时提交
- 草稿通过 `sendMessageDraft` 以 500ms 节流频率发送
- typing indicator 每 4s 刷新一次

## Telegram 适配器

### 配置

```typescript
{
  type: 'telegram',
  id: 'unique-channel-id',
  enabled: true,
  is_notify_receiver: true,  // 是否接收通知
  config: {
    bot_token: 'YOUR_BOT_TOKEN',
    allowed_chat_ids: ['123456789']  // 授权的 chat ID 列表
  }
}
```

### 特性

- 使用 **grammY** 库，仅支持长轮询（桌面应用在 NAT 后面，不支持 webhook）
- **授权守卫**：第一个中间件检查 chat ID 是否在白名单中，未授权消息直接丢弃
- **消息分块**：超过 4096 字符的消息自动按段落/行/硬分割发送
- **草稿流式**：通过 Telegram 的 `sendMessageDraft` API 实现实时响应流式展示
- **通知目标**：`notifyChatIds` 等于 `allowed_chat_ids`，所有授权的 chat 都接收通知

### 已知限制

| 限制 | 说明 |
|---|---|
| 速率限制 | `sendMessage` 全局 30/s，每 chat 1/s。草稿节流 500ms，typing 4s |
| 纯文本输出 | 代理响应以纯文本发送（无 `parse_mode`），避免 MarkdownV2 转义问题 |
| 仅长轮询 | 桌面应用无法接收 webhook |

## 通知频道

`ChannelManager` 通过 `notifyChannels` Set 跟踪哪些适配器的频道配置了 `is_notify_receiver: true`。`getNotifyAdapters(agentId)` 返回指定 agent 的所有通知适配器，供 `notify` MCP 工具和调度器任务通知使用。

## 生命周期

- **启动**: `channelManager.start()` 在应用就绪时与调度器一起调用
- **停止**: `channelManager.stop()` 在应用退出时调用
- **同步**: `channelManager.syncAgent(agentId)` 在 agent 更新/删除时调用，断开旧适配器并根据新配置重建

## 扩展新频道

添加新的频道类型只需：

1. 实现 `ChannelAdapter` 抽象类
2. 在模块中调用 `registerAdapterFactory(type, factory)`
3. 在 `channels/index.ts` 中导入该模块

## 关键文件

| 文件 | 说明 |
|---|---|
| `src/main/services/agents/services/channels/ChannelAdapter.ts` | 抽象接口 + 事件类型 |
| `src/main/services/agents/services/channels/ChannelManager.ts` | 生命周期管理 + 适配器工厂注册 |
| `src/main/services/agents/services/channels/ChannelMessageHandler.ts` | 消息路由 + 流式响应收集 |
| `src/main/services/agents/services/channels/adapters/TelegramAdapter.ts` | Telegram 适配器实现 |
| `src/main/services/agents/services/channels/index.ts` | 公开导出 + 适配器模块导入 |
