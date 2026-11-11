# Agent Note: Bind Telegram forum topics to agents

Status: proposed

English | [中文](2026-11-11-telegram-topic-agent-binding.zh.md)

## Problem

A Telegram channel is bound to exactly one agent. A forum supergroup with several topics therefore either runs one agent for every topic or needs one supergroup per agent. Replies also ignore forum topics: a message sent in a topic is answered in the General topic, because the adapter never reads `message_thread_id` and every send targets the chat only.

## Proposal

- Config: `topic_agents` maps `<chatId>:<message_thread_id>` to an agent id. It is added to the shared channel schema and to the strict API schema. Keys include the chat id because thread ids are unique only within a chat.
- Inbound: text, photo, document, and command updates from a forum topic carry `threadId`. A mapped topic also carries its own `conversationId` and `dispatchAgentId`. An unmapped topic keeps the chat's conversation.
- Dispatch: the handler resolves the effective agent once per event, from `dispatchAgentId`. A target that is not `active` falls back to the channel agent with a warning log.
- Replies: `threadId` flows through `SendMessageOptions` into Telegram message sends (including the plain-text fallback), typing actions, and streaming drafts. Error replies from `ChannelManager` carry it too.
- Settings: the Telegram form gets a Topics editor with one row per topic key and agent. Incomplete or malformed rows are kept locally and not saved.

## Alternatives considered

- Key `topic_agents` by thread id alone, as the issue proposed. Rejected: thread ids collide across chats.
- Give every forum topic its own conversation. Rejected for now: it changes the history of existing forum channels. Unmapped topics keep the chat conversation, so an empty map keeps today's behaviour.
- Topic discovery and a `/topics` command. Deferred: they need persisted records of topics the bot has seen. Users get the chat id from `/whoami` and the topic id from a topic message link.
- Dispatch only within the channel's own agent. Rejected: it does not deliver per-topic agents.

## Acceptance criteria

- AC1 — The Telegram config schemas accept `topic_agents` keyed `<chatId>:<threadId>` and reject malformed keys and empty agent ids (verification: unit)
- AC2 — A mapped forum topic dispatches to its agent, in its own conversation, and replies into that topic (verification: unit)
- AC3 — An unmapped forum topic stays on the channel agent and replies into its thread (verification: unit)
- AC4 — Two topics bound to different agents do not share a session (verification: unit)
- AC5 — A topic bound to an agent that is not active falls back to the channel agent (verification: unit)
- AC6 — The Telegram form binds a valid topic to a chosen agent and does not save a malformed topic key (verification: renderer)

## Risks

- Cross-agent dispatch runs an agent other than the channel's owner inside that channel. Deleting an agent leaves its topic bindings in config; they fall back at dispatch time, and the form does not flag them.
- `topic_agents` values are not checked against existing agents on save.
- Telegram requires `message_thread_id` to be accepted by each send method. This is checked by the typecheck against the grammY types, not by a live bot.
