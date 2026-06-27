import type { IpcRequestSchemas } from '@shared/ipc/schemas'
import type { IpcHandlersFor } from '@shared/ipc/types'

import { aiHandlers } from './ai'
import { appHandlers } from './app'
import { binaryHandlers } from './binary'
import { fileHandlers } from './file'
import { fileProcessingHandlers } from './fileProcessing'
import { knowledgeHandlers } from './knowledge'
import { selectionHandlers } from './selection'
import { webSearchHandlers } from './webSearch'
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
  ...aiHandlers,
  ...appHandlers,
  ...binaryHandlers,
  ...fileHandlers,
  ...fileProcessingHandlers,
  ...knowledgeHandlers,
  ...selectionHandlers,
  ...webSearchHandlers,
  ...windowHandlers
}
