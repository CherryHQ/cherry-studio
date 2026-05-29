# CherryClaw Channel System

The channel system provides IM integration for CherryClaw, allowing users to interact with agents through instant messaging platforms like Telegram. The system uses an abstract adapter pattern, supporting future expansion to Discord, Slack, and other platforms.

## Architecture

```
ChannelManager (singleton, lifecycle management)
  ├── adapters Map<key, ChannelAdapter>      — Active adapter instances
  ├── notifyChannels Set<key>                — Channels marked as notification receivers
  ├── start()   → Load all CherryClaw agents, create adapters for enabled channels
  ├── stop()    → Disconnect all adapters
  └── syncAgent(agentId) → Disconnect old adapters, rebuild from current config

ChannelAdapter (abstract EventEmitter)
  ├── connect() / disconnect()
  ├── sendMessage(chatId, text, opts?)
  ├── sendMessageDraft(chatId, draftId, text)  — Streaming draft updates
  ├── sendTypingIndicator(chatId)
  └── Events: 'message' → ChannelMessageEvent
              'command' → ChannelCommandEvent

ChannelMessageHandler (singleton, stateless message router)
  ├── handleIncoming(adapter, message)   — Route to agent session
  ├── handleCommand(adapter, command)    — Handle /new /compact /help
  └── sessionTracker Map<agentId, sessionId>  — Active session per agent
```

## Adapter Registration

Adapters self-register via `registerAdapterFactory(type, factory)`. Importing the adapter module triggers registration:

```typescript
// src/main/services/agents/services/channels/adapters/TelegramAdapter.ts
registerAdapterFactory('telegram', (channel, agentId) => {
  return new TelegramAdapter({ channelId: channel.id, agentId, channelConfig: channel.config })
})
```

`ChannelManager` imports all adapter modules at startup (via `channels/index.ts`); the `registerAdapterFactory` calls execute as module side effects.

## Message Processing Flow

### User Messages

```
User sends message in Telegram
  → TelegramAdapter emits 'message' event
  → ChannelManager forwards to ChannelMessageHandler.handleIncoming()
    1. resolveSession(agentId)
       → Check sessionTracker → Query existing session → Create new session
    2. Send typing indicator (refreshed every 4s)
    3. Generate random draftId
    4. collectStreamResponse(session, text, abort, onDraft):
       - Create session message (persist: true)
       - Read stream:
         text-delta → Update currentBlockText (accumulated within block)
         text-end   → Commit to completedText, reset current block
       - Send draft every 500ms via sendMessageDraft
    5. sendMessage(chatId, finalText) — Auto-split messages over 4096 characters
```

### Command Handling

| Command | Behavior |
|---|---|
| `/new` | Create new session, update sessionTracker |
| `/compact` | Send `/compact` to current session, collect response |
| `/help` | Return agent name, description, and available commands |

## Streaming Response

CherryClaw's streaming response follows these rules:

- `text-delta` events within the same text block are **cumulative** — each event contains the full text so far, not an increment
- `ChannelMessageHandler` uses `text = value.text` (replace) within a block, commits on `text-end`
- Drafts are sent via `sendMessageDraft` throttled to 500ms
- Typing indicator refreshes every 4s

## Telegram Adapter

### Configuration

```typescript
{
  type: 'telegram',
  id: 'unique-channel-id',
  enabled: true,
  is_notify_receiver: true,
  config: {
    bot_token: 'YOUR_BOT_TOKEN',
    allowed_chat_ids: ['123456789']
  }
}
```

### Features

- Uses **grammY** library, long polling only (desktop apps behind NAT don't support webhooks)
- **Authorization guard**: First middleware checks if chat ID is whitelisted; unauthorized messages are silently dropped
- **Message chunking**: Messages over 4096 characters are automatically split by paragraph/line/hard-split
- **Draft streaming**: Real-time response streaming via Telegram's `sendMessageDraft` API
- **Notification targets**: `notifyChatIds` equals `allowed_chat_ids`; all authorized chats receive notifications

### Known Limitations

| Limitation | Description |
|---|---|
| Rate limits | `sendMessage` global 30/s, per-chat 1/s. Draft throttle 500ms, typing 4s |
| Plain text output | Agent responses sent as plain text (no `parse_mode`) to avoid MarkdownV2 escaping issues |
| Long polling only | Desktop apps cannot receive webhooks |

## Notification Channels

`ChannelManager` tracks which adapters have channels configured with `is_notify_receiver: true` via the `notifyChannels` Set. `getNotifyAdapters(agentId)` returns all notification adapters for a given agent, used by the `notify` MCP tool and scheduler task notifications.

## Lifecycle

- **Start**: `channelManager.start()` is called at app ready alongside the scheduler
- **Stop**: `channelManager.stop()` is called at app exit
- **Sync**: `channelManager.syncAgent(agentId)` is called on agent update/delete, disconnecting old adapters and rebuilding from new config

## Extending with New Channels

Adding a new channel type requires:

1. Implement the `ChannelAdapter` abstract class
2. Call `registerAdapterFactory(type, factory)` in the module
3. Import the module in `channels/index.ts`

## Key Files

| File | Description |
|---|---|
| `src/main/services/agents/services/channels/ChannelAdapter.ts` | Abstract interface + event types |
| `src/main/services/agents/services/channels/ChannelManager.ts` | Lifecycle management + adapter factory registration |
| `src/main/services/agents/services/channels/ChannelMessageHandler.ts` | Message routing + streaming response collection |
| `src/main/services/agents/services/channels/adapters/TelegramAdapter.ts` | Telegram adapter implementation |
| `src/main/services/agents/services/channels/index.ts` | Public exports + adapter module imports |
