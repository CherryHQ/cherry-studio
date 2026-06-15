import type { RouteDef } from '../define'

/**
 * Global request registry — the single source of truth the main router parses
 * against. Stage 0 ships empty; each migrated domain spreads its own
 * `*RequestSchemas` object here (e.g. `...windowRequestSchemas`).
 *
 * Renderer code MUST `import type` from this module so the zod schema *values*
 * never enter the renderer bundle (see ipc-overview.md, "zod across processes").
 */
export const ipcRequestSchemas = {
  // ...domainRequestSchemas — added per domain during migration
} satisfies Record<string, RouteDef>

export type IpcRequestSchemas = typeof ipcRequestSchemas
/** Union of all declared request routes (`never` until a domain is migrated). */
export type IpcRoute = keyof IpcRequestSchemas

/**
 * Global event registry (pure types — main is the TCB that constructs events, so
 * the renderer trusts them and never re-parses). Stage 0 ships empty; each domain
 * intersects its own `*EventSchemas` type here.
 */
export type IpcEventSchemas = {
  // ['window.maximized_changed']: { maximized: boolean } — added per domain during migration
}
/** Union of all declared event names (`never` until a domain is migrated). */
export type IpcEventName = keyof IpcEventSchemas
