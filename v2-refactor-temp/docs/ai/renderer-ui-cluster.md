# Renderer V2 Chat UI — Reviewer Cluster

## Scope

| Subpath | Files (~) | Role |
|---|---|---|
| `src/renderer/src/pages/home/V2*` | `V2ChatContent.tsx`, `V2Inputbar.tsx`, … | Page-level chat shell — wires up transport, overlay, history |
| `pages/home/Messages/Blocks/` | `PartsRenderer.tsx`, `ToolBlock*.tsx`, `MainTextBlock.tsx`, `ThinkingBlock.tsx`, `V2Contexts.ts`, … | Parts → React tree |
| `pages/home/Messages/Tools/` | approval cards, `useToolApproval`, defer hints | Tool-call rendering + approval UX |
| `pages/home/Messages/` (page-level) | `Message.tsx`, `MessageGroup.tsx`, `ChatVirtualList.tsx`, `MessageMenubar.tsx`, branch nav (`ChatNavigation.tsx`, `ChatFlowHistory.tsx`), `SiblingNavigator`, `MessageEditor.tsx` | Composition of blocks into messages |
| `pages/home/Messages/Blocks/__tests__/` | snapshots + interaction tests | Per-block coverage |

About 68 files in this cluster — the largest by file count.

## Intent

v1 rendered out of a Redux `messages` slice and an ad-hoc `blocks`
field on each message; streaming wrote into Redux through
`ChatSessionManager.handleFinish` (440 lines). v2 reads from:

- **`useTopicMessagesV2(topicId)`** — DataApi query for the topic tree.
- **`useExecutionOverlay(topicId)`** — in-memory parts during streaming.
- **`useTopicStreamStatus(topicId)`** — `pending` / `streaming` /
  `awaiting-approval` / terminal status from the shared cache.

The `blocks` field is gone (commit `78a02662b refactor(agent-message):
remove deprecated blocks field`); rendering reads `parts: CherryMessagePart[]`
directly.

## Key changes

### `PartsRenderer`

Renders `CherryMessagePart[]` by dispatching on `part.type`. The per-
type renderers live in `Blocks/` (one component per type). Adding a new
part type means adding one switch arm + one renderer component.

Beat-loader visibility uses `useIsActiveTurnTarget(message)` — the
single predicate covering "DB status says streaming AND this is the
turn-target message AND nothing else has rendered yet". See
[Renderer Transport](./renderer-transport-cluster.md) for the
classifier consolidation.

Commit `6ba5cd20c refactor(v2-chat): extract useIsActiveTurnTarget`.

### `V2Contexts.ts`

Two contexts:

- **`PartsContext`** — `Record<messageId, CherryMessagePart[]> | null`.
  `null` means "v1 mode" (no provider mounted) — handlers in Blocks/
  branch on this.
- **`TranslationOverlayContext` + `TranslationOverlaySetterContext`** —
  separate reader/writer contexts so writers don't re-render on every
  setter call. The setter context has a strict variant
  (`useTranslationOverlaySetter` — throws when no provider) and a
  non-strict variant (`useOptionalTranslationOverlaySetter` — returns
  `null` for scopes that intentionally don't mount the provider, e.g.
  agent sessions / quick assistant).

### Branch navigation

`SiblingNavigator` shows `< i/N >` arrows. For deep forks (subtree size
> 5 OR last activity > 1h ago) it shows the extended form
(`< 2/3 · 47 msgs · 3d ago >`). See [branch-navigation.md](./branch-navigation.md).

`ChatFlowHistory.tsx` is the modal tree view. Reads
`MessageService.getTree(topicId, opts)` from DataApi — no Redux,
no `state.messages`.

### Approval cards

Tool blocks with `state === 'approval-requested'` render an approval
card (`Blocks/ToolBlock.tsx` switching on state). The card:

- Reads the approval id from `part.approval.id`.
- On click, calls `useToolApprovalBridge(topicId)(match, approved, ...)`.
- Optionally calls `useToolApproval` to remember the per-server / per-tool
  decision for future calls (commit `a87a8cc65 refactor(tool-approval):
  enhance useToolApproval to support MCP tool persistence`).

### Translation overlay

`MessageTranslate.tsx` + `TranslationBlock.tsx`: when the user
translates a message, the translation appears as an overlay layer above
the original parts. Persists into the `translate_history` table via the
[translate-on-main](./translate-on-main.md) flow.

`MessageMenubar.tsx` was hardened against missing translation overlay
in agent sessions (commit `6f2cb19c3 fix(message-menubar): don't crash
agent sessions on missing translation overlay`).

### Streaming smoothness

Two perf-driven changes shipped in this cluster:

- `baa1a66f6 perf(markdown): block-split streaming render to remove
  O(n²) re-parse` — incremental markdown re-parse.
- `20d330b18 fix(smooth-stream): adaptive jitter-buffer playout to kill
  burst-pause sawtooth` + `e427bae44 fix(smooth-stream): keep render
  loop alive across mid-stream queue drains` + `1461b461c fix(stream-listener):
  bound delta coalescing by wall-clock and size` — smoothing the visual
  pacing of text-delta playback.

### `useScrollAnchor`

New hook that anchors the virtual list on the active message rather
than the bottom — keeps the user's reading position stable as the
assistant streams in.

## Invariants

- The renderer never PATCHes approval state directly. Decisions go
  through `useToolApprovalBridge`.
- Streaming parts come from the execution overlay, NOT from SWR.
  Writing streamed parts to SWR would race the DB-authoritative refresh
  and cause visible flicker; see commit `cd5560f26 feat(pending-messages):
  move optimistic turn out of the authoritative cache`.
- Overlay is disposed only after DB refresh resolves (`.finally`).
- The classification of "is this message the active turn target" lives
  exclusively in `useIsActiveTurnTarget` — duplicating that logic in
  consumers caused the Phase-2 regression.

## Validation

- `Blocks/__tests__/` — per-block snapshots + interaction
- `agents/__tests__/` for agent-session-specific UI
- Commit chain `3b2fb0752` → `6ba5cd20c` → `ed905ca45` consolidated the
  turn-state plumbing; each commit is small enough to review individually.

## Follow-ups (out of scope)

- The `ChatFlowHistory` modal is still functional but the design is
  pending UX iteration — see [branch-navigation.md](./branch-navigation.md).
- Some v1 → v2 bridge code still lives in `bridge.ts` / `legacy: only
  present in v1 settings` annotations on types; deletion is gated on
  the renderer cleanup chain (see memory: v1→v2 renderer cleanup blockers).
