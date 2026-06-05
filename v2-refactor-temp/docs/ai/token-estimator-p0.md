# Backend Token Estimation (P0)

## Context

In an earlier cleanup pass we deleted `src/renderer/src/services/TokenService.ts` along with the input-bar token-count badge — its message-count-based "X / Y context" UX was incompatible with V2's per-model context window awareness. The user wants the feature back, but redesigned:

- **Compute in main process** so we can use the model registry's `contextWindow` and avoid shipping tokenizer bundles to the renderer.
- **Reuse `MessageStats.promptTokens` / `completionTokens`** for already-sent history. Provider-billed numbers are ground truth — tokenize-locally-from-scratch can't match them on tool definitions, file attachments, or vendor-specific prompt framing.
- **Tokenize only the user's unsent text** — orders of magnitude cheaper and tokenizer-agnostic in P0.

P0 scope: get a working "current prompt tokens / model context window" badge back in the input bar with a clean architecture. Tokenizer accuracy can be ratcheted up in P1 (tiktoken / Anthropic / Gemini per-vendor) without touching the API surface.

## Architecture

### Pure module (no lifecycle service)

Token estimation is stateless and side-effect-free — it doesn't own resources, doesn't subscribe to events, doesn't need lifecycle ordering. Per `CLAUDE.md`'s decision guide, it's a plain module/function exported from main, called by an `ipcHandle` registered inside the existing `AiService` lifecycle service (which already owns AI-namespace IPC channels: `Ai_Stream_Open`, `Ai_GenerateText`, `Ai_ToolApproval_Respond`, …).

```
renderer
  └── window.api.ai.estimateTokens(req)
        ↓ IPC: Ai_EstimateTokens
main: AiService.ipcHandle (thin forwarder)
        ↓ direct call
main: estimateTokens(req)  ← pure async function in src/main/ai/tokenEstimator.ts
        ├── modelService.getByKey(providerId, modelId)        — context window
        ├── messageService.getPathToNode(activeNodeId)        — history
        │   └── walk back to most recent assistant w/ stats   — reuse promptTokens + completionTokens
        └── tokenx.estimateTokenCount(text)                    — only for text after that point
```

### Request / response

```ts
// packages/shared/ai/transport/tokenEstimate.ts (NEW)
export interface TokenEstimateRequest {
  modelId: UniqueModelId
  text?: string                    // current unsent input
  topicId?: string                 // include topic history when set
  parentAnchorId?: string          // anchor for branch — defaults to topic.activeNodeId
}

export interface TokenEstimateResponse {
  promptTokens: number             // sum of (history reused or tokenized) + new input
  contextWindow?: number           // model.contextWindow ?? model.maxInputTokens (undefined when neither populated)
  maxOutputTokens?: number         // model.maxOutputTokens
  tokenizer: 'heuristic'           // P0: tokenx only. P1 adds 'tiktoken' / 'anthropic' / 'gemini'.
  historyExact: boolean            // true if we reused MessageStats end-to-end
}
```

### Where `contextWindow` comes from (data layer)

| Layer | What lives there | Reference |
|---|---|---|
| `Model` runtime type | `contextWindow?: number` + `maxInputTokens?: number` + `maxOutputTokens?: number` | `packages/shared/data/types/model.ts:262-267` (`ModelSchema`) |
| SQLite | `user_models` table has the columns; populated at model creation from provider-registry preset catalogs (or user override via Model Settings UI) | DB columns match the schema |
| Main reader | `modelService.getByKey(providerId, modelId)` → `rowToRuntimeModel(row)` direct field mapping `row.contextWindow → model.contextWindow` | `src/main/data/services/ModelService.ts:147-159` (specifically line 158) |

So the lookup chain in `tokenEstimator.ts`:

```ts
import { parseUniqueModelId } from '@shared/data/types/model'
import { modelService } from '@main/data/services/ModelService'

const { providerId, modelId } = parseUniqueModelId(req.modelId)
const model = await modelService.getByKey(providerId, modelId)
const contextWindow = model.contextWindow ?? model.maxInputTokens
// ↑ undefined if neither was populated for this preset (rare for major providers,
//   common for self-hosted / custom models — the response leaves it `undefined`
//   and the renderer shows the badge without a "/ Y" right-hand side).
```

**No new field, no new query** — the data is already in `user_models` rows since the v2 migration; we just plumb it through the IPC.

### Where the usage ratio (占比) lives

**Backend never computes the ratio** — it returns raw `promptTokens` and `contextWindow` only. This keeps the IPC contract independent of how UI chooses to render (badge text, ring, threshold colors, …).

**Renderer derives the ratio at render time** in `TokenCount.tsx`:

```ts
const ratio = res.contextWindow ? res.promptTokens / res.contextWindow : null
const tier =
  ratio == null ? 'unknown' :
  ratio >= 0.95 ? 'critical' :
  ratio >= 0.80 ? 'warn'     :
  'ok'
```

P0 visual (small badge in input bar's right toolbar):

```
  [⊙] 2,345 / 128,000   ← ⊙ = small progress ring filled by `ratio`,
                          color follows `tier` (text grey / amber / red)
```

- Heuristic / inexact estimates render the count with a leading `~`.
- Click → tooltip shows breakdown: history tokens (with "exact" / "estimated" tag) + new-input tokens + remaining headroom.
- Percentage display (`(1.8%)`) deferred to P1 — the ring already conveys it visually and a number adds clutter.

This split means future redesigns (e.g., gauge bar across the input footer, "you're 90% full" warnings) only touch one renderer file; the IPC stays stable.

### History token computation

```ts
// pseudo
async function estimateHistoryTokens(topicId, parentAnchorId): Promise<{tokens, exact}> {
  const topic = await topicService.getById(topicId)
  const anchor = parentAnchorId ?? topic.activeNodeId
  if (!anchor) return { tokens: 0, exact: true }       // fresh topic
  const path = await messageService.getPathToNode(anchor)

  // Walk from end backwards for the most recent assistant whose stats are populated.
  for (let i = path.length - 1; i >= 0; i--) {
    const m = path[i]
    if (m.role === 'assistant' && m.stats?.promptTokens != null) {
      const tail = path.slice(i + 1)                    // anything after that assistant
      return {
        tokens:
          m.stats.promptTokens +
          (m.stats.completionTokens ?? 0) +
          tokenx.estimateTokenCount(extractText(tail)),
        exact: tail.length === 0
      }
    }
  }

  // No history with stats → tokenize the whole path (degraded path).
  return { tokens: tokenx.estimateTokenCount(extractText(path)), exact: false }
}
```

`extractText(messages)`: use existing `getTextFromParts(message.parts)` (or `getMainTextContent`) to flatten parts into plain text. **Tool definitions and file blobs are intentionally NOT included** in the heuristic path because we have no honest way to estimate them client-side — they show up under-counted, which is consistent with how `tokenx` treats things and we tag the result `historyExact: false` so the UI can show a `~` qualifier. Once a turn has happened, the `MessageStats` reuse path covers tool/file framing exactly.

### `MessageStats` reliability

Verified: `PersistenceListener` writes `stats` on all three terminal paths — `onDone` (`PersistenceListener.ts:111`), `onPaused` (`:116`), `onError` (`:121`) — via `statsFromTerminal()` (`:155`). So the "reuse" assumption holds for all properly-terminated turns. Only mid-stream / persistence-failed messages lack stats, in which case the fallback tokenization kicks in.

## Files

### NEW

| Path | Purpose |
|---|---|
| `packages/shared/ai/transport/tokenEstimate.ts` | `TokenEstimateRequest` / `TokenEstimateResponse` types (re-exported from `index.ts`) |
| `src/main/ai/tokenEstimator.ts` | Pure async `estimateTokens(req)` function |
| `src/renderer/src/hooks/useTokenEstimate.ts` | Debounced renderer hook calling the IPC |

### MODIFIED

| Path | Change |
|---|---|
| `packages/shared/IpcChannel.ts` | Add `Ai_EstimateTokens = 'ai:estimate-tokens'` next to `Ai_GenerateText` |
| `src/main/ai/AiService.ts` | One `this.ipcHandle(IpcChannel.Ai_EstimateTokens, …)` registration that delegates to `estimateTokens` |
| `src/preload/index.ts` | Add `estimateTokens` to the `ai` namespace (line ~825, sibling of `generateText`) |
| `src/renderer/src/pages/home/Inputbar/Inputbar.tsx` | Wire `useTokenEstimate` + restore right-toolbar badge (re-use the deleted `TokenCount.tsx` design as a smaller new component) |
| `src/renderer/src/pages/home/Inputbar/TokenCount.tsx` (NEW or restored) | Simple `current / contextWindow` display with `~` prefix when `historyExact === false` or `tokenizer === 'heuristic'` |

### NOT TOUCHED

- The 6 settings/translate pages still using `tokenx.estimateTokenCount` directly — those are sync, single-string estimates with no model awareness. P1 may migrate them; P0 keeps them as-is.
- `MessagesService.getContextCount` / `filterContextMessages` — already deleted in earlier pass; not coming back.

## Verification

Run on dev build:

1. **No history (fresh topic)**:
   - Open empty topic, model=any.
   - Type "hello" — badge shows `~5 / <model.contextWindow>` (heuristic flag because `historyExact: false`).
   - Send. After response lands, type again — badge should now show non-`~` number.

2. **History reuse**:
   - On a topic with ≥1 successful turn, click the input box without typing.
   - Badge: `<exact promptTokens of last assistant> / <contextWindow>`.
   - Verify against the persisted `message.stats.promptTokens` of the last assistant.

3. **No-stats fallback**:
   - Manually clear `stats` on the latest assistant DB row.
   - Reload — badge should still render but with `~` qualifier (heuristic for the whole history).

4. **Branch / regenerate**:
   - Use SiblingNavigator to switch active branch — badge updates to that branch's tip stats (different number per branch).

5. **Tests**:
   - Unit test for `estimateTokens` in `src/main/ai/__tests__/tokenEstimator.test.ts`:
     - empty topic
     - last assistant has stats → result equals `stats.promptTokens + stats.completionTokens`
     - last assistant missing stats → falls back to heuristic
     - nonexistent model → reasonable error
   - `pnpm vitest run src/main/ai/__tests__/tokenEstimator.test.ts`

6. **CI**: `pnpm lint` + `pnpm test`.

## Out of scope (P1 / later)

- Per-vendor tokenizers (`tiktoken`, `@anthropic-ai/tokenizer`, Gemini SDK `countTokens`). Swap-in behind the same API.
- Including system prompt / tool schemas in heuristic estimate.
- Replacing the 6 settings/translate-page direct `tokenx` calls.
- Multi-model `@` token estimate (show min-context across mentioned models).
- Memoization of identical estimate requests (cacheService memory tier).
- Restoring V1's "Gemini search-entry-point widget" — independent UX work, not token-related.
