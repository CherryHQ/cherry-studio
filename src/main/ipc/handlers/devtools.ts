import { application } from '@application'
import type { devtoolsRequestSchemas } from '@shared/ipc/schemas/devtools'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const devtoolsHandlers: IpcHandlersFor<typeof devtoolsRequestSchemas> = {
  'devtools.toggle': async (_input, { senderId }) => {
    if (!senderId) {
      return
    }

    const window = application.get('WindowManager').getWindow(senderId)
    if (window && !window.isDestroyed()) {
      window.webContents.toggleDevTools()
    }
  }
}
