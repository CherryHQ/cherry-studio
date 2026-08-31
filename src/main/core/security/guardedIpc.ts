import { loggerService } from '@logger'
import { IpcError, IpcErrorCode } from '@shared/ipc/errors/IpcError'
import type { IpcMainInvokeEvent } from 'electron'
import { ipcMain } from 'electron'

import { validateSender } from './validateSender'

/**
 * Throw {@link IpcErrorCode.FORBIDDEN_SENDER} unless `event` comes from the app's own
 * top-level renderer frame. Extracted from {@link handleGuarded} so the decision is
 * unit-testable without Electron IPC registration.
 */
export function assertTrustedSender(event: IpcMainInvokeEvent, channel: string, appRootDir?: string): void {
  if (validateSender(event, appRootDir)) return
  // Lazy: this module sits below core/logger in the import graph, so the logger
  // context must not be created at module-eval time.
  loggerService.withContext('GuardedIpc').warn('Rejected legacy IPC request from untrusted sender', {
    channel,
    senderType: event.sender.getType(),
    senderUrl: event.senderFrame?.url
  })
  throw new IpcError(IpcErrorCode.FORBIDDEN_SENDER, `Rejected IPC request from untrusted sender: ${channel}`)
}

/**
 * `ipcMain.handle` wrapper that funnels every legacy (pre-IpcApi) channel through the
 * same source-trust gate as IpcApi/DataApi/Preference/Cache — all frames can send IPC
 * while MiniApps load remote URLs, so callers are verified before handlers run.
 */
export function handleGuarded(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: any[]) => any,
  appRootDir?: string
): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedSender(event, channel, appRootDir)
    return handler(event, ...args)
  })
}
