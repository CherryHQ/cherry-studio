# Agent Note: IM channels can target a conversation

Status: proposed

English | [中文](2026-11-06-channel-conversation-target.zh.md)

## Problem

A channel must be bound to an Agent today. `readDesired` reports a connected runtime only when the row is active and carries an `agentId` whose Agent is not archived (`src/main/ai/channels/ChannelManager.ts:153`), the connected runtime target carries a non-null `agentId` (`src/main/ai/channels/ChannelRuntime.ts:11`), and an incoming message whose session has no Agent is dropped as an orphan (`src/main/ai/channels/ChannelMessageHandler.ts:390`). The settings form offers Agents plus "None" (`src/renderer/pages/settings/ChannelsSettings/ChannelDetail.tsx:292`), and a "None" channel never connects.

An Agent is not a neutral container. Binding a channel to one brings a session workspace, the Agent's model, MCP and disabled-tool configuration, and the Agent runtime; every reply lands in an Agent session. A user who wants their ordinary assistant conversation reachable from QQ, Telegram or Feishu has no way to expose it: creating an Agent to carry the conversation changes the model and tool setup and puts replies somewhere other than the conversation they meant (#23722).

## Proposal

A channel binds at most one target: an Agent (as today) or a conversation (a topic).

### Binding

- `agent_channel` gains a nullable `topicId` referencing `topic.id` with `ON DELETE SET NULL`, beside the existing nullable `agentId`. There is no backfill: every existing row keeps `agentId` and `topicId IS NULL`, so an upgrade changes nothing.
- Entity, create and update schemas gain `topicId`. The target pair is validated inside the service write transaction against the merged row, because a partial update can add one side while the other is already stored, internal callers bypass the transport schemas, and channel mutations arrive through the `channel.create` / `channel.update` IpcApi routes while the DataApi handlers for this resource are GET only.
- A row with neither target stays saved but disconnected, which is what "None" already does.
- The workspace and permission-mode controls configure an Agent only. For a conversation target the form hides them and says the conversation answers with its assistant's own model configuration.

### Runtime

- `ChannelRuntimeDesired`'s connected variant carries `target: {kind: 'agent', agentId} | {kind: 'conversation', topicId}` in place of a bare `agentId`, and `ChannelAdapterConfig` carries the same target. The adapter base class keeps `agentId` as a convenience that is undefined for conversation targets; no concrete adapter reads it today.
- `readDesired` reports a conversation target as connected when the row is active and its topic exists and is not trashed, and as disconnected otherwise. Trashing the topic disconnects the channel but keeps the binding, restoring it reconnects, and purging it clears the target for good.
- Credential callbacks and QR registration become target-neutral: `saveCredentials` currently checks Agent ownership, and a conversation target has none to check.
- Changing either target clears the other plus the channel's task subscriptions in the same written update, and the runtime reconcile aborts the live turn and drops queued batches before the new target connects. The boundary is that reconcile: a batch admitted before it may still deliver once, and a reply already sent cannot be unsent.

### Messages

- A conversation target answers with an ordinary chat turn on the bound topic, through a new main-side helper modelled on `startAgentSessionRun`. The existing chat entry `dispatchCommand` takes no caller listeners, so the helper must register the completion sentinel and `ChannelAdapterListener` inside the same dispatch lock; the dispatch acknowledgement is not turn completion, and only the terminal event releases the reply.
- The turn continues the topic's selected active branch. `parentAnchorId` is resolved to the branch tip under that same admission lock: omitting it parents the new user row under the virtual root, which would turn every platform message into a new branch of conversation.
- The turn uses the assistant's configured model, or `chat.default_model_id` for an assistant-less topic. A missing model or provider fails as a translated notice in the platform reply instead of parking the turn.
- The turn runs under a main-only headless policy threaded from the request into the SDK tool boundary. The existing `headless` flag reaches only the Agent runtime; a window-less chat turn today keeps SDK tool approvals enabled and parks at `awaiting-approval` with no viewer. Under the policy, tools that need user approval or user input are refused for that turn while tools that can run unattended still work, and the outcome must not depend on whether some window happens to be viewing the topic. The shared tool registry is not mutated and no Agent session is faked.
- A platform message that arrives while the topic has a live turn is refused before any user row is written, with a translated notice. A normal chat submit would instead persist a steer row and attach to the running turn, which would deliver another turn's output to the platform. The refusal applies to platform submissions only; an interactive submit from the UI keeps today's steer behaviour.
- Images and files reuse the existing `FileManager`-backed persistence; the current Agent-workspace precondition is dropped for conversation targets.
- `/help` becomes target-aware, since it reads Agent metadata and the session command catalogue today; `/whoami` is unchanged; `/new` and `/compact` stay Agent-only and a conversation target answers them with a notice.
- Every platform conversation of a channel writes into the one bound conversation, so those external chats share history and context and one can influence the reply delivered to another. Reply routing stays per originating platform conversation: a reply reaches only the chat that asked.

### Settings

- The channel detail form keeps "Bind Agent" and adds "Bind conversation", each clearing the other. The conversation picker lists existing topics by assistant and title.
- The channel list shows the bound target's name; a channel whose target no longer exists shows as unbound.

## Alternatives considered

- **Bind an assistant and create one topic per platform conversation.** Closer to how Agent sessions already fan out, and topic provisioning already exists, but it needs a durable external-conversation-to-topic mapping (the existing mapping references `agent_session`, not `topic`) and it delivers different behaviour: separate conversations without the shared context described above. Deferred; nothing in this proposal blocks it.
- **Keep Agent-only and document "create an Agent".** Status quo, declined: it is precisely the path the request cannot use.
- **Reuse an Agent session whose Agent is null.** Impossible: the session runtime needs the Agent for model and tool configuration, and the handler already drops such sessions as orphans.

## Acceptance criteria

- AC1 — A channel can be created or updated with a conversation target from Settings, the binding survives a reload and a restart, and one channel can never hold both an Agent and a conversation. (verification: main service tests, renderer tests, Electron)
- AC2 — A message in the bound platform conversation is persisted as a user message in the bound topic and a reply is delivered back to that same platform conversation. (verification: main integration test with a deterministic model stream and a fake adapter; live platform delivery reported separately)
- AC3 — Successive platform messages continue the topic's active branch with its existing history in context instead of starting a new branch per message. (verification: main integration test)
- AC4 — A message that arrives while the bound topic has a live turn is refused before any user row is written, and the platform receives a translated notice. (verification: main integration test)
- AC5 — Tools that need user approval or user input neither execute nor park the turn while a channel turn runs, including when a window is viewing that topic. (verification: main integration test)
- AC6 — Agent-bound channels keep their observable behaviour: one session per platform conversation, the existing slash commands, attachment persistence and streamed replies. (verification: existing channel and Agent suites plus a fake-adapter regression)
- AC7 — Trashing, purging, restoring or bulk-deleting the bound topic leaves the channel disconnected without a crash, reconnects on restore, and shows as unbound in Settings. (verification: main service tests and renderer tests)
- AC8 — New labels, hints and notices are translated in every shipped locale and the i18n gate passes. (verification: i18n gate and semantic review)

## Risks

- Shared topic context is the accepted cost of binding one conversation: one external chat can influence the reply another receives. If that is not acceptable, the deferred alternative is the one to build.
- A target switch cannot retract a reply already sent, and a batch admitted before the reconcile may still deliver once.
- Ordinary chat has no workspace, so attachment persistence and any path that assumes `session.workspace` must be branched rather than inherited.
- The column is additive and nullable, but it is still a schema change: the implementation layer needs a generated migration and an upgrade check against a populated database.
- A user typing in the same topic in the UI shares the same admission rule; the busy refusal above is what keeps a platform message from interleaving with an interactive turn.
