import type { RouteDef } from '../define'
import { type SelectionEventSchemas, selectionRequestSchemas } from './selection'
import { type WindowEventSchemas, windowRequestSchemas } from './window'

/**
 * Global request registry — the single source of truth the main router parses
 * against. Each migrated domain spreads its own `*RequestSchemas` object here.
 *
 * Renderer code MUST `import type` from this module so the zod schema *values*
 * never enter the renderer bundle (see ipc-overview.md, "zod across processes").
 */
export const ipcRequestSchemas = {
  ...selectionRequestSchemas,
  ...windowRequestSchemas
} satisfies Record<string, RouteDef>

export type IpcRequestSchemas = typeof ipcRequestSchemas
/** Union of all declared request routes (`never` until a domain is migrated). */
export type IpcRoute = keyof IpcRequestSchemas

/**
 * Global event registry (pure types — main is the TCB that constructs events, so
 * the renderer trusts them and never re-parses). Each migrated domain intersects
 * its own `*EventSchemas` type here.
 */
export type IpcEventSchemas = SelectionEventSchemas & WindowEventSchemas
/** Union of all declared event names (`never` until a domain is migrated). */
export type IpcEventName = keyof IpcEventSchemas
