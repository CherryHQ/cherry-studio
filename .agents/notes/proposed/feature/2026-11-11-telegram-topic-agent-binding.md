# Agent Note: Telegram forum topic agent binding

Status: proposed

English | [中文](2026-11-11-telegram-topic-agent-binding.zh.md)

## Problem

A Telegram channel binds to exactly one agent. A supergroup with forum topics enabled therefore sends every topic to the same agent, so a family or team that wants a marketplace topic, a research topic, and a cooking topic has to create one supergroup and one bot per workflow. Topics also share one conversation history, so unrelated prompts pollute each other's context.

## Proposal

A Telegram channel keeps one connection and one owning agent. A forum topic can be mapped to a different agent, and that agent answers messages posted in the topic.

### Configuration

- The Telegram channel config gains `topic_agents`: a map from a chat-scoped topic key (`chatId:threadId`, the numeric chat id plus `message_thread_id`) to agent id. Thread ids are only unique within a chat, so keying by chat keeps mappings unambiguous when one channel allows several groups. It is optional and defaults to empty, so existing channels behave as before apart from the per-topic history split described below.
- The map is read from the channel row when a message is dispatched, so an edit takes effect without reconnecting the bot.

### Dispatch

- Inbound Telegram messages and commands carry the thread id. Each forum topic gets its own conversation (`chatId:threadId`), so topics in one supergroup never share session history.
- The handler resolves the answering agent per message. A mapped topic uses its agent. An unmapped topic, or a mapped agent that is missing or not active, uses the channel agent; the fallback logs a warning.
- Replies and typing indicators for a topic message are sent into that topic's thread. Stream drafts follow Telegram's `sendMessageDraft`, whose `chat_id` accepts private chats only, so supergroup topics fall back to typing indicators plus the final message until Telegram offers a group streaming mechanism.
- Session ownership is already checked against the answering agent, so a persisted session that belongs to a previous topic agent is replaced rather than reused.

### Commands and UI

- `/topics` replies in the topic where it was sent with the configured topic-to-agent assignments, or says that none are configured.
- The Telegram channel form gets a "Topic agents" section: a chat select (from the channel's allowed chat ids), a numeric thread id, an agent select, add and remove. Non-numeric thread ids and duplicate chat/thread pairs are rejected before saving.

## Alternatives considered

- **Let one adapter serve several agents.** Rejected. Runtime ownership, status reporting, and reconcile are keyed by the channel's agent, so this would rework the connection lifecycle for a per-message routing change.
- **One channel per workflow (the current workaround).** Rejected as the goal. It needs one bot and one supergroup per workflow, which is the operational overhead this change removes.
- **Discover topics through `getUpdates` or a persisted topic registry.** Deferred. Telegram has no bot API to list forum topics, so discovery needs stored state and a migration. The MVP takes thread ids from the user, who can read them from the topic link.
- **Auto-create agents from topic names.** Rejected as out of scope.
- **Per-topic access control beyond agent choice.** Rejected as out of scope. Channel permissions and workspace still apply.

## Acceptance criteria

- AC1 — A message posted in a forum topic that is mapped in `topic_agents` is answered by the mapped agent, and a message in an unmapped topic or outside a topic is answered by the channel agent. (verification: unit; owner: channel message handler)
- AC2 — Messages posted in different topics of the same supergroup get separate conversations, so their sessions and history do not share state. (verification: unit; owner: Telegram adapter)
- AC3 — A reply to a topic message is posted into that topic's thread through `message_thread_id`, and a message outside a topic is sent without a thread id. (verification: unit; owner: Telegram adapter)
- AC4 — When a mapped topic agent is missing or not active, the message is answered by the channel agent and a warning is logged. (verification: unit; owner: channel message handler)
- AC5 — `/topics` replies in the topic where it was sent, listing each mapped thread id with its agent name, or states that no topic agents are configured. (verification: unit; owner: channel message handler)
- AC6 — The Telegram channel form adds and removes topic-agent mappings, rejects non-numeric thread ids and duplicate chat/thread pairs, and saves the map as `topic_agents`. (verification: renderer; owner: channel settings UI)

## Risks

- **Existing forum groups split their history.** Before this change, every topic in a supergroup shared one conversation. After it, each topic gets its own, including topics that are not mapped. Users who relied on the shared history will see it split on their next message.
- **The General topic is not special-cased.** Messages in General may carry no thread id or thread id 1 depending on the Telegram client. A mapping for General must be checked against real traffic before it is documented.
- **Agent-initiated file sends are not thread-aware.** `sendFile` has no reply options, so a file sent for a topic conversation lands in the General topic. Fixing it changes the file-send path and is left for follow-up.
- **`/topics` is not in `/help`.** The slash-command list is shared with Discord's command registration, so Telegram-only commands stay out of it for now.
- **The handler narrows on the Telegram channel type.** Thread routing reads `topic_agents` from the Telegram config directly. Other platforms that gain threads will need the same lookup generalized, which is a later change.
