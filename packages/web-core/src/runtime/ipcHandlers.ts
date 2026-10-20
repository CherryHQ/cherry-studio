import { aiHandlers } from '@main/ipc/handlers/ai'
import { ipcRequestSchemas, type IpcRequestSchemas } from '@shared/ipc/schemas/ipcSchemas'
import type { IpcHandlersFor } from '@shared/ipc/types'

import { unsupported } from '../disabled/unsupported'

/** IpcApi routes the Web edition serves; the desktop handler table reaches every desktop feature. */
const servedHandlers: Partial<IpcHandlersFor<IpcRequestSchemas>> = {
  'ai.stream.open': aiHandlers['ai.stream.open'],
  'ai.stream.attach': aiHandlers['ai.stream.attach'],
  'ai.stream.detach': aiHandlers['ai.stream.detach'],
  'ai.stream.abort': aiHandlers['ai.stream.abort']
}

/** Browser `ipc/handlers/ipcHandlers`: every other route rejects with `WebUnsupportedError`. */
export const ipcHandlers = Object.fromEntries(
  Object.keys(ipcRequestSchemas).map((route) => [
    route,
    servedHandlers[route as keyof IpcRequestSchemas] ?? unsupported(`IpcApi route ${route}`)
  ])
) as IpcHandlersFor<IpcRequestSchemas>
