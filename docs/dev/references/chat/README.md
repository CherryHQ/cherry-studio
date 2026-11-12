---
description: Current chat-domain map covering shared renderer modules, page-owned adapters, rich clipboard, the message tree, and ordinary-chat context handling
sources:
  - src/renderer/components/chat
  - src/renderer/components/composer
  - src/renderer/pages/home/messages
  - src/renderer/pages/agents/messages
  - src/main/data/services/MessageService.ts
  - scripts/data-classify/data/target-key-definitions.json
  - src/shared/data/preference/preferenceSchemas.ts
  - src/shared/data/types/contextSettings.ts
  - src/shared/data/types/assistant.ts
  - src/shared/data/types/model.ts
  - src/main/ai/constants.ts
  - src/main/ai/contextBuild
  - src/main/ai/streamManager/context/PersistentChatContextProvider.ts
  - src/main/ai/runtime/aiSdk/params/features/contextBuild.ts
  - src/main/ai/runtime/aiSdk/params/features/inLoopCompaction.ts
  - src/main/ai/streamManager/persistence/trimToolOutputs.ts
  - src/main/ai/messages/attachmentBudget.ts
  - src/main/ai/messages/attachmentRouting.ts
  - src/main/data/services/ModelService.ts
  - src/renderer/pages/home/useChatRuntimeState.ts
  - src/renderer/pages/home/hooks/useChatWriteActions.ts
  - src/renderer/utils/errorToast.ts
  - src/shared/utils/errorCategory.ts
---

# Chat Reference

The chat domain spans reusable renderer modules, page-owned adapters, composer UI,
and the main-process message tree. There is no root
`@renderer/components/chat` barrel or generic `components/chat/adapters/`
directory; consumers import from the module that owns the capability.

## Current ownership

| Path | Responsibility |
|---|---|
| `src/renderer/components/chat/messages/` | Shared message-list contracts, rendering, actions, tools, markdown, streaming, and list behavior |
| `src/renderer/components/chat/actions/` | Generic action descriptors/registry plus current topic and session action sets |
| `src/renderer/components/chat/{resourceList,shell,panes,flow}/` | Shared resource navigation, conversation shell, auxiliary panes, and topic-tree visualization |
| `src/renderer/components/composer/` | Shared composer surface and its Chat/Agent variants |
| `src/renderer/pages/{home,agents}/messages/` | Page-owned projections from business state into the shared message-list contract |
| `src/main/data/services/MessageService.ts` | SQLite-backed topic-message tree operations and invariants |

The repository previously carried target-architecture documents for a generic
adapter layer and root package barrel. Those APIs did not land; the current
reference set documents implemented behavior only.

## Agent mode controls

The Agent composer exposes Plan as an independent Quick Panel toggle on harnesses
that support it. Shift+Tab switches ordinary/Plan without changing the draft;
open-panel and prompt-variable navigation take priority. Plan is absent from the
composer's Permission Mode submenu. The toggle still saves the native Agent
permission mode (`plan` or `default`).

Goal is selected separately in the Quick Panel through the existing native
`/goal` command. Selection prefixes the draft once and leaves submission to the
user. Pi and Durable provide a static command entry; Claude uses its live SDK
catalog. Draft keywords and the input placeholder do not suggest modes.

## Horizontal conversation previews

Conversation tabs reuse the sidebar status priority and completion read receipt.
Inactive topic and Agent session tabs, including pinned tabs, open a read-only
message preview on hover or keyboard focus. The card loads bounded history only
while open, observes live execution overlays, and refreshes on read-model changes
and each reopening. Sidebar hover cards retain their own content.

`MessagePreviewContent` owns the compact message presentation: Markdown and tool
requests without links, decision controls, media playback, or scrolling. Pending
requests take precedence over the latest two-message tail. Opening a request
revalidates its persisted state before locating it in the existing tab; hovering
never marks a completion as seen. File and embedded-image previews use text
placeholders so background previews do not fetch or play media.

## Ordinary persisted chat context

These settings, budgets, and recovery paths apply to ordinary persisted chat
topics. Agent/Work sessions resolve context differently and are out of scope.

### Defaults and overrides

The six global preferences are defined in
`scripts/data-classify/data/target-key-definitions.json`; generated runtime defaults
live in `src/shared/data/preference/preferenceSchemas.ts`.

| Preference | Default | Effect |
|---|---|---|
| `chat.context_settings.enabled` | `true` | Master toggle for the context-build layer |
| `chat.context_settings.truncate_threshold` | `50000` characters | Size above which eligible oversized tool-output text or codec fields are offloaded into stored-output references; outputs with an exemption, or an offload that fails, keep their full content |
| `chat.context_settings.max_messages` | `null` (unlimited) | Selects the last N message rows, extending backward when the drop point would not begin on a user message, so the served history can exceed N |
| `chat.context_settings.compress.enabled` | `true` | Enables history compression when the context budget is exceeded |
| `chat.context_settings.compress.model_id` | `null` | Uses the current request model; a blank string also means no explicit pick, not a disabled compressor |
| `chat.context_settings.compress.threshold_percent` | `80` | Percentage of available input room used as the compaction trigger |

Per-assistant `contextSettings` overrides globals field by field in
`resolveContextSettings.ts`. `maxMessages` merges by property presence: an explicit
assistant `null` overrides a finite global limit. `thresholdPercent` is clamped
at merge time. `max_messages` is independent of the master toggle: it bounds how
much history is sent, not what happens on overflow.
An assistant-level `compress.modelId` of `null` inherits the global selection instead of forcing the current request model.

### Budget with a declared window

With a valid model `contextWindow`, `resolveInputRoom.ts` and
`PersistentChatContextProvider.ts` use token budgets:

```text
inputRoom = max(contextWindow - outputReservation, floor(contextWindow * 0.2))
trigger = floor(inputRoom * thresholdPercent / 100)
keptRecentBudget = floor(trigger * 0.375)
```

An unset `outputReservation` subtracts nothing, so `inputRoom = contextWindow`.
Request construction resolves the requested output limit in this order: explicit call override,
numeric custom parameter, assistant `maxTokens` when enabled, then `model.maxOutputTokens` only for
the Anthropic Messages endpoint. The assistant default has `enableMaxTokens = false`, so an assistant
that never enabled it contributes no reservation. Turn-start durable compaction resolves the
assistant and endpoint limits itself and uses the largest reservation across a multi-model send; the
in-loop hook additionally sees the call override. Neither compaction path passes the custom output
parameter.

Compaction is attempted only when estimated history is **strictly greater** than
`trigger`, with context building and compression enabled and a compression model
resolved. The kept-recent fraction is `0.375` in `src/main/ai/constants.ts`.
`model.maxInputTokens` is not an input to these formulas; filling it alone does not
establish a compaction budget. Crossing the trigger does not guarantee that the
request fits: if no earlier prefix can be folded, history is served as-is.

Compaction can fail open. If the compression model cannot be resolved, the produced summary is
empty, or summarization throws, the turn-start durable-compaction stage serves the marker-applied
history unchanged. In the unresolved-model case, with context building and compression enabled and
a known request-model window, request construction still installs the sliding-window fallback
(`contextBuild.ts:142–145`); over-budget history may therefore lose its oldest turns before reaching
the provider. An in-loop summarization failure stops further in-loop compaction for that request and
lets it continue. A finite `max_messages` also short-circuits turn-start durable compaction: the window
is computed over raw rows without applying existing compaction summaries, so the two settings do not
compose, although the in-loop hook can still run.

### Unknown model window

`contextWindow` is optional: custom, v1-imported, and catalog-less model rows can
omit it. `resolveContextWindow.ts` maps missing, non-finite, and non-positive
values to `null`. Window-derived budgets then skip instead of computing a number.
With the context-build layer enabled, the following behavior applies:

| Protection | Behavior without a known window |
|---|---|
| Turn-start durable compaction | Skipped with a warning log when durable compaction is otherwise eligible and no selected model declares a valid `contextWindow` |
| In-loop compaction | No compaction hook is installed for the request |
| Window-relative in-flight tool-output truncation | Disabled; the absolute `truncate_threshold` character limit still applies |
| Sliding-window fallback when no compression model resolves | Absent; it also requires a known window |
| `max_messages` | Still applies, independently of the master toggle |
| Persist-time tool-output trimming | Still applies at `truncate_threshold`; offloads individual oversized tool results, with per-tool exemptions and fail-open behaviour, so it is not a cap on total history |
| Attachment budgeting | Falls back to a fixed per-file character cap for inlined text |

There is no hidden default window. If no selected runtime model declares a valid window, that request
has no window-derived compaction trigger, and it also runs without the in-loop hook. With unlimited
`max_messages` and no applicable boundary, ordinary text history has no window-derived application cap
and can grow until the endpoint rejects it.

A custom row whose window field was left empty can still receive a window at read
time from the bundled catalog when its API model id matches: `ModelService.ts`
fills limit fields only while undefined. An empty field in the form does not by
itself prove that no window is in effect.

### Recovering from a context-length rejection

`src/shared/utils/errorCategory.ts` maps provider-message patterns such as
`context_length_exceeded`, `too many tokens`, `maximum context length`,
`context window`, `prompt is too long`, and `input is too long` to `context_length`.
The error toast offers one action for that category: `trimContext`, wired in
`src/renderer/utils/errorToast.ts` and handled in `useChatRuntimeState.ts`.

The action invokes `useChatWriteActions.ts` to insert a **context-boundary marker**
as a synthetic user message, a child of the current active node. Earlier messages stay in the topic and remain visible. A request whose anchor path
contains the boundary excludes the marker and everything before it before the rest
of history processing runs, so the boundary shrinks the request without deleting
earlier messages.

The action is unavailable without an active node, while a boundary operation is
already in progress, and while a turn is opening, streaming, awaiting approval, or
persisting, or while history is loading. The general clear-context action
removes the marker when the active node is already a boundary, rather than adding
a second marker. The error-toast handler refuses to run on an existing boundary.

**After establishing the boundary, send the question again.** Retrying the failed
assistant message does not pick up the new boundary: `PersistentChatContextProvider.ts`
rebuilds history from that message's parent anchor, so the retry re-sends the
pre-boundary history (settings resolution and compaction do run again for it). This
recovery path has no automatic retry and no one-click compaction.

## Documents

| Document | What it covers |
|---|---|
| [Composer Rich Clipboard](./composer-rich-clipboard.md) | Private clipboard format that preserves composer tokens across copy/paste, its restore rules, and ownership boundaries |
| [Message Tree](./message-tree.md) | The topic message-tree model: adjacency list, virtual root, sibling groups, invariants, delete semantics, consumer contract |
