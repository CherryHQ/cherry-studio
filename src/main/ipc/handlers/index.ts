import type { IpcRequestSchemas } from '@shared/ipc/schemas'
import type { IpcHandlersFor } from '@shared/ipc/types'

import { fileProcessingHandlers } from './fileProcessing'
import { knowledgeHandlers } from './knowledge'
import { selectionHandlers } from './selection'
import { windowHandlers } from './window'

/**
 * Global request handler map — exactly one handler per declared route, exhaustive
 * and closed (enforced by the `IpcHandlersFor<IpcRequestSchemas>` annotation:
 * miss a route → compile error; add an undeclared one → compile error).
 *
 * Each migrated domain spreads its own `*Handlers` object here. This is the single
 * place that enumerates every main capability the renderer can reach — the audited
 * exposure surface.
 */
export const ipcHandlers: IpcHandlersFor<IpcRequestSchemas> = {
  ...fileProcessingHandlers,
  ...knowledgeHandlers,
  ...selectionHandlers,
  ...windowHandlers
}
