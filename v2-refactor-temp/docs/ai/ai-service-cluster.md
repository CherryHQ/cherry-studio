# AiService & IPC — Reviewer Cluster

## Scope

| File | LOC | Role |
|---|---|---|
| `src/main/ai/AiService.ts` | 641 | Lifecycle service; IPC handler registration; non-stream entry points |
| `src/main/ai/types/requests.ts` | 83 | `AiBaseRequest`, `AiStreamRequest`, `AiTransportOptions`, `ListModelsRequest` |
| `src/main/ai/types/merged.ts` | 102 | `AppProviderSettingsMap` extension type merging |
| `src/main/ai/types/index.ts` | 45 | Re-exports + `AppProviderId` map |
| Tests | `__tests__/AiService.test.ts` (114) | Lifecycle + IPC handler smoke tests |

## Intent

`AiService` is the lifecycle-owned IPC owner for the `Ai_*` channel
namespace. It is intentionally thin — it routes IPC calls into the
shared building blocks (`Agent`, `buildAgentParams`, `dispatchStreamRequest`,
`translateService`) and is not where business logic lives. Adding a new
LLM-driven IPC entry should be one IPC line in `registerIpcHandlers()`
plus a method.

## IPC channels owned

| Channel | Mode | Handler |
|---|---|---|
| `Ai_GenerateText` | `ipcHandle` | `generateText(request)` — non-streaming |
| `Ai_CheckModel` | `ipcHandle` | `checkModel(request, timeout?)` — health probe |
| `Ai_EmbedMany` | `ipcHandle` | `embedMany(request)` |
| `Ai_GenerateImage` | `ipcOn` (MessagePort) | port-based abort, no main-side registry |
| `Ai_ListModels` | `ipcHandle` | `listModels(request)` |
| `Ai_Translate_Open` | `ipcHandle` | `translateService.translate(request)` — see [translate-on-main.md](./translate-on-main.md) |
| `Ai_ToolApproval_Respond` | `ipcHandle` | applies decision, dispatches `continue-conversation` when all decided |
| `Ai_Stream_Open` / `Ai_Stream_Attach` / `Ai_Stream_Abort` | `ipcHandle` | proxied to `AiStreamManager` (the manager registers these in its own lifecycle) |
| `Ai_EstimateTokens` | `ipcHandle` | thin forwarder to the [`token-estimator-p0`](./token-estimator-p0.md) pure module |

## Key changes

### Lifecycle decoration

```ts
@Injectable()
@ServicePhase(Phase.WhenReady)
@DependsOn(['McpService', 'AiStreamManager'])
export class AiService extends BaseService {
  protected async onInit(): Promise<void> {
    registerBuiltinTools()
    this.registerIpcHandlers()
  }

  protected async onStop(): Promise<void> {
    toolApprovalRegistry.clear('ai-service-stop')
  }
}
```

- **`@DependsOn(['McpService', 'AiStreamManager'])`** — explicit
  because some methods read from `AiStreamManager` (e.g. continue
  dispatch after approval). The manager is in the same phase; container
  resolves the order.
- **Tool registry init in `onInit`** — `registerBuiltinTools()` registers
  the built-in tools on the singleton.
- **Clean stop drains approvals** — outstanding `canUseTool` promises
  are rejected so they don't hang across a service restart.

### `Ai_GenerateImage` uses MessagePort

The image generation channel uses `MessagePort` instead of `ipcHandle`
so the renderer can drive abort without a main-side request registry.
Per-call MessageChannel; `port2` transferred; renderer posts
`{ type: 'abort' }`; main sends one terminal `result` / `error` and
closes.

This is the only IPC handler in the service that uses ports — the
pattern lives in `src/preload/invokeWithAbort.ts` and is referenced in
the `Ai_GenerateImage` handler comments.

### `Ai_ToolApproval_Respond`

The handler resolves an `approval-requested` ToolUIPart to
`approval-approved` / `approval-denied`:

1. Loads the anchor message's current parts.
2. Computes new parts via `applyApprovalDecisions(beforeParts, [decision])`.
3. **Writes only when the target part is present on the DB row** —
   guards the overlay-only case where the renderer sees the part before
   it persisted.
4. If any approval on the turn is still pending, returns early.
5. Otherwise either resolves the Claude-Agent `canUseTool` promise (via
   `toolApprovalRegistry`) or dispatches a synthetic
   `continue-conversation` through `dispatchStreamRequest`.

See [Tool Approval](../../../docs/references/ai/tool-approval.md) for
the design rationale.

### `AiRequestOptions` vs `AiTransportOptions`

- `AiTransportOptions` — IPC-serialisable; this is what renderer
  payloads use.
- `AiRequestOptions` — extends with `AbortSignal`; only in-process
  callers can attach (e.g. `AiStreamManager.runExecutionLoop`).

`AsInProcess<T>` widens a request type's `requestOptions` to accept
the in-process shape. Used on `AiService.*` method signatures so the
type system rejects the renderer trying to pass a signal across IPC.

### Ad-hoc prompt streams

Ad-hoc one-shot streams (translate, summarisation, model probes) do **not**
go through `AiService`. Callers invoke `AiStreamManager.streamPrompt(...)`
directly (e.g. `translateService.ts`) with a synthetic topicId and their own
`WebContentsListener`, using `promptStreamLifecycle` (no status broadcast, no
grace period). See [Stream Manager](./stream-manager-cluster.md).

### Types

- `types/requests.ts` — `AiBaseRequest`, `AiStreamRequest`,
  `ListModelsRequest`. All transport types are flat (no nested
  optionality), serialisable.
- `types/merged.ts` — `AppProviderSettingsMap` merges core SDK
  `CoreProviderSettingsMap` with Cherry's app-level extensions
  (claude-code, aihubmix, newapi). Provides the `AppProviderId` union
  via `StringKeys<...>`.

## Invariants

- `Ai_*` channels are the only IPC channels `AiService` owns. The
  `AiStreamManager` owns its own three stream channels.
- IPC handlers narrow renderer input to `AiTransportOptions` —
  `signal` injection happens only on in-process callers.
- `Ai_GenerateImage` is the only port-based handler; if a new abort-
  capable handler is added, it should follow the same pattern (not
  add a main-side abort registry).

## Validation

- `__tests__/AiService.test.ts` (114) — lifecycle smoke + IPC
  registration + ToolApproval handler edge cases.

## Follow-ups (out of scope)

- The `Ai_ToolApproval_Respond` handler's "all decided?" check assumes
  the approval-requested parts live on the anchor message. If
  approvals ever land on non-anchor parts we'll revisit.
- See memory [Cherry AI tools — open work items](../../../) for
  follow-up work on tool-loop refinement.
