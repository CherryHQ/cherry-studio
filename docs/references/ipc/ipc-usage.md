---
description: Adding an IpcApi request route or main-to-renderer event — schema, handler, broadcast and send, useIpcOn subscribe
sources:
  - src/shared/ipc/schemas
  - src/main/ipc/handlers
  - src/renderer/ipc/useIpcOn.ts
---

# IpcApi Usage

Two recurring tasks: adding a request route (R→M call) and adding an event (M→R push). A new request changes **2 places** (schema + handler); a new event changes **1 contract** plus its emit and subscribe sites. Preload and the channel enum never change.

## Add a Request Route

### 1. Declare the schema (`src/shared/ipc/schemas/<domain>.ts`)

```ts
import { z } from 'zod'
import { defineRoute } from '../define'

export const windowRequestSchemas = {
  // route: dot snake_case; payload fields stay camelCase
  'window.main.set_minimum_size': defineRoute({
    input: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
    output: z.void()
  })
}
```

Register it in the composition (`src/shared/ipc/schemas/ipcSchemas.ts`):

```ts
export const ipcRequestSchemas = {
  ...windowRequestSchemas
} satisfies Record<string, RouteDef>
```

### 2. Implement the handler (`src/main/ipc/handlers/<domain>.ts`)

```ts
import { application } from '@application'
import type { IpcHandlersFor } from '@shared/ipc/types'
import type { windowRequestSchemas } from '@shared/ipc/schemas/window'

export const windowHandlers: IpcHandlersFor<typeof windowRequestSchemas> = {
  // input is parsed; this route deliberately targets the main-window singleton
  'window.main.set_minimum_size': async ({ width, height }) => {
    application.get('MainWindowService').setMainWindowMinimumSize(width, height)
  }
}
```

Register it (`src/main/ipc/handlers/ipcHandlers.ts`):

```ts
export const ipcHandlers: IpcHandlersFor<IpcRequestSchemas> = {
  ...windowHandlers
}
```

Miss a declared route → compile error. Add a handler for an undeclared route → compile error.

### 3. Call it from the renderer

```ts
import { ipcApi } from '@renderer/ipc'

await ipcApi.request('window.main.set_minimum_size', { width: 800, height: 600 })
const info = await ipcApi.request('app.get_info') // void input → no second argument
```

`route` is completed/checked against `IpcRoute`; input/output types follow from it. On failure the call rejects with an `IpcError` (its `code` lets you branch).

### 4. Surface a typed error (optional)

To signal a failure the renderer must branch on, throw an `IpcError` with a **domain code** — `IpcApiService` serializes it into `{ ok: false, error }` and the renderer facade rebuilds the `IpcError` and rejects. Do **not** throw the framework codes (`VALIDATION_FAILED` / `ROUTE_NOT_FOUND` / `FORBIDDEN_SENDER` / `INTERNAL`) by hand — the router owns those, and any uncaught non-`IpcError` throw is normalized to `INTERNAL` for you. See the [error model](./ipc-overview.md#error-codes--ipcerrorcode) for the framework-vs-domain-code rule and why codes live under `errors/`, not `schemas/`.

Put the domain's codes in `@shared/ipc/errors/<domain>.ts` as an `as const` map, and import it **directly** on both sides (no barrel — `errors/` has no aggregating index; each domain map is imported directly):

```ts
// src/shared/ipc/errors/file.ts — the domain's code map (zod-free, value-importable by both processes)
export const fileErrorCodes = { FILE_NOT_FOUND: 'FILE_NOT_FOUND' } as const
```

```ts
// main handler (src/main/ipc/handlers/file.ts)
import { IpcError } from '@shared/ipc/errors/IpcError'
import { fileErrorCodes } from '@shared/ipc/errors/file'

'file.read_doc': async ({ path }) => {
  if (!(await exists(path))) {
    // reference the constant, not a literal; machine-readable detail rides in `data`
    throw new IpcError(fileErrorCodes.FILE_NOT_FOUND, `No file at ${path}`, { path })
  }
  return read(path)
}
```

```ts
// renderer — branch on the rebuilt IpcError's `code` using the same constant
import { IpcError } from '@shared/ipc/errors/IpcError'
import { fileErrorCodes } from '@shared/ipc/errors/file'

try {
  await ipcApi.request('file.read_doc', { path })
} catch (e) {
  if (e instanceof IpcError && e.code === fileErrorCodes.FILE_NOT_FOUND) showMissing((e.data as { path: string }).path)
  else throw e
}
```

## Add an Event

### 1. Declare the contract (Event block of `schemas/<domain>.ts`)

```ts
import type { ThemeMode } from '@shared/data/preference/preferenceTypes'

export type SystemEventSchemas = {
  'system.native_theme_updated': ThemeMode
}
```

Register it in the composition (`schemas/ipcSchemas.ts`):

```ts
export type IpcEventSchemas = SystemEventSchemas & AppEventSchemas
```

### 2. Emit from a main service

```ts
import { application } from '@application'
import { WindowType } from '@main/core/window/types'

// to all windows (ThemeService)
application.get('IpcApiService').broadcast('system.native_theme_updated', theme)
// to all windows of one type (AppUpdaterService)
application.get('IpcApiService').broadcastToType(WindowType.Main, 'app.updater.not_available', undefined)
// to one window (WindowManager)
application.get('IpcApiService').send(windowId, 'window.maximized_changed', true)
```

### 3. Subscribe in the renderer

```ts
import { useIpcOn } from '@renderer/ipc'

useIpcOn('system.native_theme_updated', setActualTheme) // cleanup is automatic
```

Outside React, use the imperative form:

```ts
import { ipcApi } from '@renderer/ipc'

const unsubscribe = ipcApi.on('system.native_theme_updated', (theme) => { /* ... */ })
```

## Handler: Pure Function vs Service Delegate

| Capability | Where the handler lives |
|---|---|
| Small stateless logic (app info, font list) | Pure function directly in `handlers/` — no service needed |
| Lifecycle service (MCP / Knowledge / Window — registered in `serviceRegistry.ts`) | Handler in `handlers/`, delegating via `application.get('XxxService').method()`; business logic and resource lifecycle stay in the service |
| Non-lifecycle module (file topic, `printService`, `regionService`) | Handler in `handlers/`, importing the module's curated entry (topic barrel or direct-import singleton) and delegating — no DI handle exists and none should be fabricated |

The `handlers/` directory is the single audited list of capabilities exposed through IpcApi. Remaining legacy/data-subsystem channels stay outside it until their documented migration or carve-out is complete.

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
