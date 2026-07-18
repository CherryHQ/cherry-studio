import { DevResetCoordinator } from '@main/services/DevResetCoordinator'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { type devRequestSchemas, DevResetErrorCode } from '@shared/ipc/schemas/dev'
import type { IpcHandlersFor } from '@shared/ipc/types'
import { app } from 'electron'

/**
 * Dev-only handlers. Packaged builds are refused here — renderer DEV visibility
 * is not a security boundary.
 */
export const devHandlers: IpcHandlersFor<typeof devRequestSchemas> = {
  'dev.reset_app_data': async () => {
    if (app.isPackaged) {
      throw new IpcError(DevResetErrorCode.DEV_ONLY, 'dev.reset_app_data is only available in development builds')
    }
    return DevResetCoordinator.reset()
  }
}
