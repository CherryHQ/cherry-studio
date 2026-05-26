# CherryClaw Channel System

The channel layer (`src/main/ai/channels/`) bridges agent sessions and IM platforms. Each platform has its own `ChannelAdapter`; `ChannelManager` owns lifecycle, and `ChannelMessageHandler` routes inbound messages into agent sessions through the shared streaming pipeline.

Supported platforms: `telegram`, `feishu`, `qq`, `wechat`, `discord`, `slack`.

## Architecture

```
ChannelManager                     — lifecycle service @Injectable, Phase.WhenReady, @DependsOn(['WindowManager'])
  adapters       Map<`${agentId}:${channelId}`, ChannelAdapter>
  qrWaiters      Map<key, { resolve, timer }>    // wechat / feishu QR setup
  channelLogs    ChannelLogBuffer                // per-channel ring buffer
  channelStatuses Map<channelId, ChannelStatusEvent>
  start()        → load all agent_channel rows, lazy-import needed adapter modules, connect active ones
  stop()         → disconnect everything
  syncChannel(channelId, { awaitConnect?, strictDisconnect? })
                  → disconnect this one channel + reconnect if isActive
  disconnectChannel(channelId, { suppressErrors? })
  disconnectAgent(agentId)
  getAdapter(channelId) | getAgentAdapters(agentId) | getAdapterStatuses(agentId) | getAllStatuses()
  waitForQrUrl(agentId, channelId, timeoutMs)   // resolves when an adapter emits 'qr'

ChannelAdapter                     — abstract EventEmitter base
  connect() / disconnect() / get connected
  sendMessage(chatId, text, opts?)
  sendTypingIndicator(chatId)
  onStreamComplete(chatId, text)   // adapters with native draft/edit return true; otherwise false → fall back to plain send
  onStreamError(chatId, message)
  events: 'message' → ChannelMessageEvent, 'command' → ChannelCommandEvent, 'qr' → string

ChannelMessageHandler              — singleton, message router + streaming bridge
  sessionTracker   Map<`${agentId}:${channelId}:${chatId}`, sessionId>    // bounded, LRU-evicted at 500
  pendingResolutions Map<key, Promise<...>>         // coalesce concurrent session resolutions
  pendingBatches   Map<key, PendingBatch>           // 8s debounce window per chat
  chatQueues       Map<key, Promise<void>>          // per-chat serial pipeline
  activeAbortControllers Map<sessionId, AbortController>
```

`ChannelManager` is a real lifecycle `BaseService` — it is created and stopped by the container, not a hand-rolled singleton. `ChannelMessageHandler` is a singleton (with TODO to migrate to `cacheService`).

## Adapter registration

Adapters self-register via `registerAdapterFactory(type, factory)`. `ChannelManager.start()` does not eagerly import them — it inspects active channels, then lazy-loads only the modules it needs from `adapterImportMap`:

```ts
discord: () => import('./adapters/discord/DiscordAdapter'),
feishu:  () => import('./adapters/feishu/FeishuAdapter'),
qq:      () => import('./adapters/qq/QqAdapter'),
slack:   () => import('./adapters/slack/SlackAdapter'),
telegram:() => import('./adapters/telegram/TelegramAdapter'),
wechat:  () => import('./adapters/wechat/WeChatAdapter'),
```

The module body executes `registerAdapterFactory` as a side effect, after which the factory is available to `ChannelManager.connectChannelFromRow`.

## Inbound message flow

```
adapter emits 'message' → ChannelMessageHandler.handleIncoming(adapter, message)
  1. batchKey = `${agentId}:${channelId}:${chatId}`
     Append to existing pendingBatch or open a new one, set 8s timer.
  2. After debounce (or first-message arrival), flushBatch:
     - mergeMessages — concatenate texts with '\n', union images / files
     - chain onto chatQueues[batchKey] so processIncoming runs serially per chat
  3. processIncoming(adapter, mergedMessage):
       resolveSession(agentId, channelId, channelType, chatId)
         → tracker hit → use it; else channel.sessionId → use it; else createSession
         → pendingResolutions coalesces concurrent lookups
       persistImages(workDir, msg.images) → save to `<workspace>/.cherry-studio/channel-images/`
       persistFiles(workDir, msg.files)   → save to `<workspace>/.cherry-studio/channel-files/`
       append attachment file paths to the prompt body
       wrap with wrapExternalContent(...) — adds boundary markers + per-message security notice
       AbortController + 4s typing-indicator interval
       collectStreamResponse(session, content, abortController, adapter, chatId):
         startAgentSessionRun({
           sessionId, userParts, listeners: [sentinel, new ChannelAdapterListener(adapter, chatId)]
         })
         sentinel.onChunk: text-delta → accumulatedText += c.text       // ← APPEND, not replace
         sentinel.onDone:  resolve(accumulatedText.trim())
       sanitizeChannelOutput → adapter.onStreamComplete (or sendChunked fallback split at 4096 chars)
```

### Streaming semantics

`text-delta` chunks are **appended**: `accumulatedText += c.text`. Each chunk is the *next slice* of text, not the cumulative running total. The `ChannelAdapterListener` likewise streams incremental updates to the adapter, which can either:

- support live editing (Telegram, Slack, Feishu — via `sendMessageDraft` or equivalent) and finalize through `onStreamComplete`; or
- fall through to `sendChunked` which splits at `MAX_MESSAGE_LENGTH = 4096` chars on paragraph / line / hard boundaries.

### Debounce + serialization

- `MESSAGE_BATCH_DELAY_MS = 8000` — IM users (notably WeChat) often send several short messages in quick succession; debouncing prevents each fragment from triggering a separate stream.
- `chatQueues` chains streams per `batchKey`, so two batches for the same chat never interleave. Cross-chat parallelism is unaffected.
- `pendingResolutions` deduplicates concurrent `resolveSession` calls so two parallel inbound messages can't each create a new session.

### Bounded session tracker

`sessionTracker` is capped at `SESSION_TRACKER_MAX_SIZE = 500` entries; oldest insertion-order entries are evicted on overflow. Tracker keys are `${agentId}:${channelId}:${chatId}` (not `${agentId}`-only).

### Abort

`activeAbortControllers` is keyed by **sessionId**. `abortSession(sessionId)` aborts the in-flight stream owned by that session. When an agent is deleted/updated, `clearSessionTracker(agentId)` aborts every tracked session for that agent before dropping the tracker entries, otherwise the stream keeps running against a deleted agent and `adapter.sendMessage` would throw.

## Commands

`adapter` emits `'command'` for slash commands; the handler covers:

| Command | Behavior |
|---|---|
| `/new` | Create a fresh session, update `agent_channel.sessionId`, update tracker, ack `"New session created."` |
| `/compact` | Resolve current session, run `/compact` as the user message through `collectStreamResponse`, return the reply (or `"Session compacted."`) |
| `/help` | Reply with agent name, description, and the `SLASH_COMMANDS` list |
| `/whoami` | Reply with the caller's chat id and a hint about `allow_ids` for notifications |

## Security boundaries

- `wrapExternalContent(text, { chatId, userId, userName, channelType })` wraps inbound text with `<<<EXTERNAL_UNTRUSTED_CONTENT>>>` boundary markers. The system prompt (`CHANNEL_SECURITY_PROMPT` in `packages/shared/ai/claudecode/constants.ts`) instructs the model to treat boundary-wrapped content as untrusted.
- `sanitizeChannelOutput(text)` runs before the final reply leaves the process, redacting accidental secret leakage.
- Path-traversal-safe attachment persistence: filenames are sanitised, timestamps prefixed.

## Notification subscriptions

The earlier draft "all authorized chats receive notifications" pattern is gone. Notification routing is now explicit:

- `mcp__claw__notify` calls `ChannelManager.getAgentAdapters(agentId)` and iterates each adapter's `notifyChatIds`.
- Scheduled tasks subscribe to specific channels through `agent_channel_task` (`agentChannelService.getSubscribedChannels(scheduleId)`); only those channels receive task completion / failure messages from `runAgentTask`.

## Lifecycle

- **Start**: `ChannelManager.onReady()` runs at `Phase.WhenReady` after `WindowManager`.
- **Stop**: `onStop()` disconnects every adapter in parallel.
- **Channel CRUD**: changes to `agent_channel` rows flow through `agentChannelWorkflowService`, which calls `ChannelManager.syncChannel(channelId)` — there is no `syncAgent(agentId)` method on the current `ChannelManager`; cross-agent teardown uses `disconnectAgent(agentId)`.

## QR-based setup (WeChat / Feishu)

For channel types that require an out-of-band scan, the claw `config.add_channel` / `config.reconnect_channel` paths:

1. Insert/keep the `agent_channel` row.
2. Fire `ChannelManager.syncChannel(channelId)` in the background.
3. `await ChannelManager.waitForQrUrl(agentId, channelId, 30_000)` for the adapter to emit `'qr'`.
4. Render to a PNG via `qrcode` and return an MCP `image` block to the agent.
5. On timeout, remove the orphan channel row so it does not block future attempts.

## Extending with new channels

1. Implement a subclass of `ChannelAdapter` under `src/main/ai/channels/adapters/<type>/`.
2. Call `registerAdapterFactory(type, factory)` at module top-level.
3. Add the dynamic-import entry to `adapterImportMap` inside `ChannelManager`.
4. Add the type to the `CHANNEL_CONFIG_SCHEMAS` map in `claw.ts` (required/optional fields + setup description) so `mcp__claw__config` recognises it.
5. Add the type to the `agent_channel_type_check` CHECK constraint in the schema (`src/main/data/db/schemas/agentChannel.ts`).

## Key files

| File | Description |
|---|---|
| `src/main/ai/channels/ChannelManager.ts` | Lifecycle service + adapter registry + sync/disconnect API |
| `src/main/ai/channels/ChannelMessageHandler.ts` | Message router, debounce/serialization, streaming bridge |
| `src/main/ai/channels/ChannelAdapter.ts` | Abstract base + event types |
| `src/main/ai/channels/adapters/telegram/TelegramAdapter.ts` | Telegram (grammY, long polling, sendMessageDraft) |
| `src/main/ai/channels/adapters/feishu/FeishuAdapter.ts` | Feishu / Lark |
| `src/main/ai/channels/adapters/slack/SlackAdapter.ts` | Slack (socket mode) |
| `src/main/ai/channels/adapters/discord/DiscordAdapter.ts` | Discord (gateway) |
| `src/main/ai/channels/adapters/wechat/WeChatAdapter.ts` | WeChat (local client bridge, QR login) |
| `src/main/ai/channels/adapters/qq/QqAdapter.ts` | QQ (official open platform) |
| `src/main/ai/channels/security/ExternalContentGuard.ts` | `wrapExternalContent` |
| `src/main/ai/channels/security/OutputSanitizer.ts` | `sanitizeChannelOutput` |
