# Stream IPC Input Validation — Design

Where validation of the AI stream IPC lives and the scheme to add it. Answers review item **D2**.
In Electron the **renderer is untrusted** (a compromised/buggy renderer, or a malicious page in a
mis-scoped window, can call any exposed channel), so every Main-process IPC handler must validate
its payload before use.

## Current state — no validation

The AI IPC handlers **cast the payload to a TypeScript type and use it directly** — TS types are
erased at runtime, so nothing checks shape or bounds:

- `AiStreamManager.onInit` (`streamManager/AiStreamManager.ts`): `Ai_Stream_Open` / `_Attach` /
  `_Detach` / `_Abort` each take `req: AiStream*Request` and pass it straight into `dispatch` /
  `attach` / `detach` / `abort`.
- `AiService` IPC handlers: `Ai_ToolApproval_Respond`, `Ai_GenerateText`, `Ai_GenerateImage`,
  `Ai_EmbedMany` — payloads are used directly (e.g. the approval handler does
  `messageService.getById(payload.anchorId)` with no id check).
- Request types (`shared/ai/transport/stream.ts` `AiStreamOpenRequest` etc., `main/ai/types/requests.ts`)
  are **plain types — no zod/valibot schemas** (no `*.schema.ts` for the transport types).
- `BaseService.ipcHandle` (`core/lifecycle/BaseService.ts`) is a thin wrapper over
  `ipcMain.handle` (`listener: (event, ...args: any[])`) — **no validation hook**.
- Preload (`preload/index.ts`) is a pure pass-through bridge (correct — Main must validate).

### Attack surface (fields trusted today)

| Field | Flows to | If malformed/hostile |
|---|---|---|
| `topicId` | provider `canHandle`, `topicService.getById`, DB writes | wrong-provider routing; bad-id DB lookups |
| `userMessageParts` | persisted as the user message; rendered in UI | unbounded/мalformed parts stored; UI-render injection if not escaped downstream |
| `mentionedModelIds` | `resolveModels` → execution fan-out | a huge array → resource amplification (one execution per id) |
| `parentAnchorId` (+ approval `anchorId`) | `messageService.getById` | non-id values → wrong/empty rows |
| approval `updatedInput` | `respondToolApproval` → tool execution | arbitrary object reaches a tool's input |

## Reusable infra — the DataApi zod pattern

The codebase **already validates IPC-shaped input** in the DataApi layer; reuse that pattern
rather than inventing one:

- Schemas co-located in `shared/data/api/schemas/` (zod `strictObject`, `z.infer` for the TS type).
- Handlers `.parse()` the payload **before** the service call, e.g. `data/api/handlers/groups.ts`:
  `const parsed = CreateGroupSchema.parse(body)` / `GroupIdSchema.parse(params.id)`.
- `strictObject` rejects unknown keys (closes the "inject extra fields" vector, e.g. approval
  `updatedInput`).

## Proposed scheme

1. **Author zod schemas for the transport request types**, co-located beside the types
   (`shared/ai/transport/stream.schema.ts` and `main/ai/types/requests.schema.ts`), and **derive
   the TS types from them** (`export type AiStreamOpenRequest = z.infer<typeof …Schema>`) so type
   and validator can't drift. Use the existing `CherryMessagePart` / `UniqueModelId` schemas where
   they already exist; add field bounds:
   - `topicId`: non-empty; accept the `agent-session:<id>` / topic-id shapes (a refinement, not a
     bare `uuid()` — topic ids aren't all UUIDs).
   - `trigger`: `z.discriminatedUnion('trigger', …)` mirroring the existing union (`submit-message`
     requires `userMessageParts`; `regenerate-message` requires `parentAnchorId`).
   - `userMessageParts`: `z.array(MessagePartSchema)` with a sane `.max(N)`.
   - `mentionedModelIds`: `z.array(UniqueModelIdSchema).max(N)` (cap the fan-out).
   - `parentAnchorId` / approval `anchorId`: the shared id schema.
   - approval `updatedInput`: keep it a record but consider gating it behind the tool's own input
     schema at the approval site (defense-in-depth).

2. **Validate at the IPC boundary.** Two ways, pick one:
   - **(recommended) a validating `ipcHandle` overload** — `this.ipcHandle(channel, schema, handler)`
     that `schema.parse(arg)` before calling `handler(event, parsed)`, returning a structured
     error response on `ZodError` (don't throw across IPC). One change in `BaseService`, every AI
     channel opts in by passing a schema. DRY and uniform.
   - **per-handler `.parse()`** — explicit `Schema.parse(req)` at the top of each handler, exactly
     like the DataApi handlers. Zero infra change, more boilerplate.

3. **Failure handling**: a parse failure returns a typed error result (the stream IPC already has
   response shapes — e.g. an `{ mode: 'error' | 'blocked', … }`), logged once; never crash the
   handler or leak the raw zod issue to the renderer beyond a safe message.

## Scope / rollout

Validate highest-risk first: `Ai_Stream_Open` and `Ai_ToolApproval_Respond` (they write the DB and
drive tool execution), then `_Attach`/`_Detach`/`_Abort` (cheap — just `{ topicId }`), then the
`Ai_Generate*` handlers. Each channel is independent, so this can land incrementally.

## Status

Not implemented in this PR. Tracked as the follow-up the reviewer (D2) asked for; the design is the
DataApi zod pattern applied at the AI IPC boundary.
