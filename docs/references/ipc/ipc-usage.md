# IpcApi Usage

Two recurring tasks: adding a request route (R→M call) and adding an event (M→R push). A new request changes **2 places** (schema + handler); a new event changes **1 contract** plus its emit and subscribe sites. Preload and the channel enum never change.

## Add a Request Route

### 1. Declare the schema (`src/shared/ipc/schemas/<domain>.ts`)

```ts
import { z } from 'zod'
import { defineRoute } from '../define'

export const windowRequestSchemas = {
  // route: dot snake_case; payload fields stay camelCase
  'window.set_minimum_size': defineRoute({
    input: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
    output: z.void()
  })
}
```

Register it in the composition (`src/shared/ipc/schemas/index.ts`):

```ts
export const ipcRequestSchemas = {
  ...windowRequestSchemas
} satisfies Record<string, RouteDef>
```

### 2. Implement the handler (`src/main/ipc/handlers/<domain>.ts`)

```ts
import type { IpcHandlersFor } from '@shared/ipc/types'
import type { windowRequestSchemas } from '@shared/ipc/schemas/window'

export const windowHandlers: IpcHandlersFor<typeof windowRequestSchemas> = {
  // input is the parsed type; ctx.senderId is the caller WindowId (omit ctx if unused)
  'window.set_minimum_size': async ({ width, height }, { senderId }) => {
    if (senderId != null) application.get('WindowManager').setMinimumSize(senderId, width, height)
  }
}
```

Register it (`src/main/ipc/handlers/index.ts`):

```ts
export const ipcHandlers: IpcHandlersFor<IpcRequestSchemas> = {
  ...windowHandlers
}
```

Miss a declared route → compile error. Add a handler for an undeclared route → compile error.

### 3. Call it from the renderer

```ts
import { ipcApi } from '@renderer/ipc'

await ipcApi.request('window.set_minimum_size', { width: 800, height: 600 })
const info = await ipcApi.request('app.get_info') // void input → no second argument
```

`route` is completed/checked against `IpcRoute`; input/output types follow from it. On failure the call rejects with an `IpcError` (its `code` lets you branch).

## Add an Event

### 1. Declare the contract (Event block of `schemas/<domain>.ts`)

```ts
export type WindowEventSchemas = {
  'window.maximized_changed': { maximized: boolean }
}
```

Register it in the composition (`schemas/index.ts`):

```ts
export type IpcEventSchemas = WindowEventSchemas & AppEventSchemas
```

### 2. Emit from a main service

```ts
// to all windows
application.get('IpcApiService').broadcast('window.maximized_changed', { maximized: true })
// to one window (e.g. the caller, by its WindowId)
application.get('IpcApiService').send(windowId, 'window.maximized_changed', { maximized: true })
```

### 3. Subscribe in the renderer

```ts
import { useIpcOn } from '@renderer/ipc/useIpcOn'

useIpcOn('window.maximized_changed', ({ maximized }) => setMax(maximized)) // cleanup is automatic
```

Outside React, use the imperative form:

```ts
const unsubscribe = ipcApi.on('window.maximized_changed', (p) => { /* ... */ })
```

## Handler: Pure Function vs Service Delegate

| Capability | Where the handler lives |
|---|---|
| Stateless (app info, font list) | Pure function directly in `handlers/` — no service needed |
| Stateful (MCP / Knowledge / Window) | Handler in `handlers/`, delegating via `application.get('XxxService').method()`; business logic and resource lifecycle stay in the service |

The `handlers/` directory is the single audited list of every main capability the renderer can reach.

## Testing

Test the **handler**, not the schema. A per-domain schema is a thin structural contract — a TS type's runtime mirror — so asserting that `z.boolean()` rejects a string, or that `z.infer` yields `boolean`, only re-tests zod. The contract is already locked three ways:

1. compile-time `IpcHandlersFor<typeof schemas>` — every route needs a handler, no extras;
2. `z.infer` drives the handler signature and the renderer call types — a mismatch is a compile error;
3. the single framework type test (`src/shared/ipc/__tests__/schema.types.test.ts`) exercises the reusable `IpcHandlersFor` generic once.

So unit-test the handler (`src/main/ipc/handlers/__tests__/<domain>.test.ts`) for real behavior — senderId routing, null-window fallback, service delegation — and do **not** add a per-domain `schemas/__tests__`. Business validation belongs in the handler/service, not the schema, so a schema with custom logic worth testing effectively never arises; if a genuine custom `.refine` predicate ever appears, test that predicate as a plain function rather than through the schema.

## High-Frequency / Topic Streams

Token streams and file-tree mutations do **not** go through `broadcast`. The owning service keeps a listener registry (preserving its batching) and directs `send(windowId, …)` per topic to attached windows — avoiding the O(windows × frequency) fan-out of broadcasting a hot event. See the migration guide (class B).

The two directions diverge under load:

- **M→R high-frequency** stays in IpcApi — its transport is already one-way `webContents.send`, so frequency costs no extra round-trip; just use directed `send` + batching (above).
- **R→M high-frequency** (per-frame, e.g. tab-drag window moves) gets no such luck — R→M is `invoke`/`handle`, so the rare per-frame channel may leave IpcApi via the escape hatch. See the [migration guide](./ipc-migration-guide.md#escape-hatch--when-a-channel-may-stay-out).
