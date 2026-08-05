# Channel Ingress Trust — Design

How an externally-triggered agent run (inbound IM → auto agent run → tool calls) is authorized,
and the gaps to close. Answers review item **D1**. The threat model: a remote party can reach a
bound channel (Slack / Discord / Telegram / Feishu / WeChat / QQ), but only an allow-listed chat,
channel, or user should drive an agent that can call tools and touch the session workspace with
**no human watching the renderer**. Once admitted, the message has the same trust and agent policy
as a request submitted through the Cherry Studio UI.

## Ingress flow

`adapter` (webhook/socket) → adapter allow-list check → `ChannelManager` registers
`adapter.on('message', …)` → `ChannelMessageHandler.handleIncoming` (per-chat 8 s debounce +
serial queue) → `processIncoming` resolves the bound session+agent →
`startAgentSessionRun({ sessionId, userParts, listeners })`. One run at a time per
`${agentId}:${channelId}:${chatId}`. The channel message text is passed through unchanged, apart
from appending paths for downloaded attachments.

## Defenses already in place

| Layer | Where | What it does |
|---|---|---|
| **Channel allow-listing** | `allowed_chat_ids` / `allowed_channel_ids` in each adapter | Drops inbound messages whose chat, channel, or user ID is not configured. An empty list currently means no restriction. |
| **Agent-owned permissions** | Claude Code settings and tool policy | An admitted channel turn uses the same prompt and tool policy as a local turn. Channel delivery remains headless, so tools that require interactive approval are denied unless the agent policy already permits them. |
| **Output secret-redaction** | `channels/security/OutputSanitizer.ts` (`sanitizeChannelOutput`, called `ChannelMessageHandler.ts:282`) | Redacts PEM keys, AWS/GitHub/Anthropic/OpenAI keys, bearer tokens, etc. **before** any agent output leaves through the channel |
| **Workspace isolation** | session `workspace.path`; attachments persisted under `${workspace}/.cherry-studio/channel-*` | The agent's fs reach is bounded to the session workspace — but **only as strong as the agent's tool policy**: a channel-bound agent with broad `Bash`/`Write` and no per-channel narrowing (see G3) is not effectively bounded |
| **Per-chat serialization** | `ChannelMessageHandler.ts:111` | One stream per chat; no concurrent interleave |

Trust-boundary summary: **inbound authorization is owned by the adapter allow-list**; admitted text
is not rewritten; **inbound files/images are not content-inspected** (persisted to the workspace,
agent reads via the Read tool, bounded by workspace); **outbound is secret-redacted**; **sender
identity is not separately authorized in group chats** (see gap 1).

## Gaps to close (the actual D1 work)

### G1 — Authorization is chat-level, not sender-level
Adapters gate on the *chat/channel* allow-list; `userId`/`userName` do not participate in that
authorization. So **any member of an allow-listed group chat can trigger agent runs.** Proposed
direction: an optional per-channel **sender allow-list** (user ids)
enforced in the adapter alongside the chat check; default off (chat-level remains the baseline),
opt-in for group chats. Deny → silent drop (consistent with the chat gate).

### G2 — Tool approval has no answer for an unwatched run
A channel run binds no renderer, so the approval `emit` is unbound; `canUseTool`
(`runtime/claudeCode/settingsBuilder.ts:418`) logs and **auto-denies** ("Approval emitter not
ready"). Net effect today: an approval-required tool **fails the run** unless the agent is set to
`bypassPermissions` — which is the unsafe workaround. This is the key external-run design hole.
Options (pick per product intent, document the choice):
- **Policy-driven, no interactive card** (recommended): for channel runs, resolve every tool to
  `allow`/`deny` from a **non-interactive policy** (the agent's `permission_mode` + the
  per-channel tool allow/deny list), never "ask". An unlisted approval-required tool denies with a
  clear, model-visible reason ("not permitted on this channel"), so the agent can continue or
  explain rather than hang.
- **Out-of-band approval**: surface the approval to a human via the channel itself (a reply with
  approve/deny) or a companion renderer notification. Heavier; only if interactive approval on
  channels is a real requirement.

### G3 — No per-channel permission override
v1 let a channel override the agent's `permission_mode`; v2 dropped it when config moved onto the
agent (`ChannelMessageHandler.ts:202` TODO). Without it, a channel can't be made **stricter** than
its agent (e.g. read-only tools for an otherwise-broad agent). Proposed direction: a per-channel
`permission_mode` + tool allow/deny override threaded as a **per-dispatch option** into
`startAgentSessionRun` → the Claude Code `toolPolicySnapshot`, applied on top of the agent's
policy (channel can only **narrow**, never widen). This is also the lever G2's policy-driven
option reads from.

## Recommended posture (until G1–G3 land)

Channels are an opt-in, high-trust feature. Configure `allowed_chat_ids` or `allowed_channel_ids`
explicitly because an empty list currently admits every reachable chat. Bind a channel only to an
agent whose tool policy matches the control granted to those remote callers; `bypassPermissions`
is equivalent to granting the allow-listed chat unattended control of that agent and workspace.
G2 is the first usability gap to fix because approval-required tools cannot ask a remote caller for
confirmation.

## Status

Channel messages are authorized by the existing per-adapter allow-list and are then delivered
without content wrapping or channel-specific prompt restrictions. G1–G3 remain follow-up work.
