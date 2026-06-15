# IpcApi Schema Guide

## File Organization

One file per domain under `src/shared/ipc/schemas/`, each split into two blocks:

| Block | Form | Direction | Trust |
|---|---|---|---|
| Request (`*RequestSchemas`) | zod **values** (`defineRoute`) | renderer→main | untrusted → parsed |
| Event (`*EventSchemas`) | pure **types** | main→renderer | trusted → not parsed |

A domain with no events simply omits the Event block. `schemas/index.ts` composes the per-domain pieces:

```ts
export const ipcRequestSchemas = { ...windowRequestSchemas, ...appRequestSchemas } satisfies Record<string, RouteDef>
export type IpcRequestSchemas = typeof ipcRequestSchemas
export type IpcRoute = keyof IpcRequestSchemas

export type IpcEventSchemas = WindowEventSchemas & AppEventSchemas
export type IpcEventName = keyof IpcEventSchemas
```

## Naming

| Element | Rule | Example |
|---|---|---|
| Route name | dot **snake_case** `namespace.action` | `file.read_doc`, `window.set_minimum_size` |
| Event name | dot **snake_case** `namespace.event` | `window.maximized_changed`, `shortcut.conflict` |
| Payload fields | JS **camelCase** (snake constrains only the route/event string) | `{ minWidth: number }` |
| Request value/type | `*RequestSchemas` / `IpcRequestSchemas` / `IpcRoute` | `windowRequestSchemas` |
| Event contract/type | `*EventSchemas` / `IpcEventSchemas` / `IpcEventName` | `WindowEventSchemas` |

The dot structure is a naming convention, not type syntax — `IpcRoute` is the strong-typed union `keyof IpcRequestSchemas`; an undeclared route is a compile error. Reuse Preference's `data-schema-key`/`valid-key` ESLint rule for the snake-case keys.

> **ESLint glob (must do on first domain migration):** the `data-schema-key`/`valid-key` rule's `files` glob is currently hard-limited to `cacheSchemas.ts`/`preferenceSchemas.ts`/`pathRegistry.ts`. Add `src/shared/ipc/schemas/**` to that glob, otherwise the naming convention has no lint enforcement here.

## Types Derived From Schemas

| Type | Meaning |
|---|---|
| `defineRoute({ input, output })` | declare one route; identity at runtime, captures the zod schemas |
| `InputFor<R>` / `OutputFor<R>` | parsed input / output type for a global route `R` |
| `EventPayload<E>` | payload type for a global event `E` |
| `IpcHandlersFor<S>` | exhaustive, closed handler map for a schema set `S` |
| `IpcContext` | `{ senderId: WindowId \| null }` — handler's controlled second argument |

`InputFor`/`OutputFor`/`EventPayload`/`IpcRoute`/`IpcEventName` are bound to the *global* registry, so they resolve to `never` until at least one domain is migrated. The reusable inference (`IpcHandlersFor<S>`) is generic and verifiable against any schema set today.

## zod Across Processes (critical)

zod schemas are runtime values.

- **Main** (`IpcRouter`) imports `ipcRequestSchemas` as a **value** to `parse`.
- **Renderer** must `import type` from `@shared/ipc/schemas` and `@shared/ipc/types` only. A value import would pull the entire zod schema set into the renderer bundle. This is enforced by an ESLint rule (`@typescript-eslint/no-restricted-imports` with `allowTypeImports`, scoped to `src/renderer/**` in `eslint.config.mjs`) that flags any value import of `@shared/ipc/schemas`. `IpcError` is the one exception — it is a value import, but plain TS with no zod dependency, so it is bundle-safe.

Validation is always on: the router `parse`s every request route. There is no skip-validation knob (add a field later only if profiling proves a hot route needs it).
