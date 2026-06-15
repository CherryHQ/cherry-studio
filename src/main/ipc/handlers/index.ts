import type { IpcRequestSchemas } from '@shared/ipc/schemas'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Global request handler map — exactly one handler per declared route, exhaustive
 * and closed (enforced by the `IpcHandlersFor<IpcRequestSchemas>` annotation:
 * miss a route → compile error; add an undeclared one → compile error).
 *
 * Stage 0 ships empty; each migrated domain spreads its own `*Handlers` object
 * here (e.g. `...windowHandlers`). This is the single place that enumerates every
 * main capability the renderer can reach — the audited exposure surface.
 */
export const ipcHandlers: IpcHandlersFor<IpcRequestSchemas> = {
  // ...windowHandlers — added per domain during migration
}
