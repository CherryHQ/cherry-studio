# Channel Ingress Security — Design

How an externally-triggered agent run (inbound IM → auto agent run → tool calls) is secured,
and the gaps to close. Answers review item **D1**. The threat model: an **untrusted remote
party** sends a message on a bound channel (Slack / Discord / Telegram / Feishu / WeChat / QQ);
that message drives an agent that can call tools and touch the session workspace, with **no
human watching the renderer**.

## Ingress flow

`adapter` (webhook/socket) → `ChannelManager` registers `adapter.on('message', …)`
(`ChannelManager.ts:301`) → `ChannelMessageHandler.handleIncoming` (per-chat 8 s debounce +
serial queue, `:54`, `:111`) → `processIncoming` resolves the bound session+agent →
`wrapExternalContent(...)` (`:254`) → `startAgentSessionRun({ sessionId, userParts, listeners })`
(`:552`). One run at a time per `${agentId}:${channelId}:${chatId}`.

## Defenses already in place

| Layer | Where | What it does |
|---|---|---|
| **Prompt-injection boundary** | `channels/security/ExternalContentGuard.ts` (`wrapExternalContent`, called `ChannelMessageHandler.ts:254`) | Normalizes full-width/CJK angle brackets (anti boundary-spoof), strips invisible/zero-width chars, wraps the message in `<<<EXTERNAL_UNTRUSTED_CONTENT boundary="<rand>">>> … >>>` with a `[SECURITY NOTICE: UNTRUSTED INPUT]` preamble; logs suspicious patterns (advisory) |
| **System-prompt hardening** | `shared/ai/claudecode/constants.ts` `CHANNEL_SECURITY_PROMPT` | Standing instruction that external content is data, not commands — overrides per-message injection attempts |
| **Output secret-redaction** | `channels/security/OutputSanitizer.ts` (`sanitizeChannelOutput`, called `ChannelMessageHandler.ts:282`) | Redacts PEM keys, AWS/GitHub/Anthropic/OpenAI keys, bearer tokens, etc. **before** any agent output leaves through the channel |
| **Workspace isolation** | session `workspace.path`; attachments persisted under `${workspace}/.cherry-studio/channel-*` | The agent's fs reach is bounded to the session workspace — but **only as strong as the agent's tool policy**: a channel-bound agent with broad `Bash`/`Write` and no per-channel narrowing (see G3) is not effectively bounded |
| **Channel allow-listing** | per-adapter allow-list config (`allowedChatIds` / `allowedChannelIds`) in `channels/adapters/<platform>/<Platform>Adapter.ts` | Inbound from a non-allow-listed chat/channel is silently dropped |
| **Per-chat serialization** | `ChannelMessageHandler.ts:111` | One stream per chat; no concurrent interleave |

Trust-boundary summary: **inbound text is guarded** (wrap + prompt); **inbound files/images are
not content-inspected** (persisted to the workspace, agent reads via the Read tool, bounded by
workspace); **outbound is secret-redacted**; **sender identity is unvalidated** (see gap 1).

## Gaps to close (the actual D1 work)

### G1 — Authorization is chat-level, not sender-level
Adapters gate on the *chat/channel* allow-list; `userId`/`userName` are used only in the preamble
and logs (`ChannelMessageHandler.ts:254`). So **any member of an allow-listed group chat can
trigger agent runs.** Proposed direction: an optional per-channel **sender allow-list** (user ids)
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

Channels are an opt-in, high-trust feature. Document the conservative defaults: enable only for
trusted workspaces; require explicit chat allow-listing; give channel-bound agents a **read-only**
tool set; do **not** use `bypassPermissions` for a channel-connected agent. G2 is the first to fix
because today's only "make tools work on a channel" answer (`bypassPermissions`) is the least safe.

## Status

Not implemented in this PR — parity with v1 (which also had no inbound auth). Tracked as a
follow-up; this doc is the design the reviewer (D1) asked for.
