import { application } from '@application'
import type { computerUseRequestSchemas } from '@shared/ipc/schemas/computerUse'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const computerUseHandlers: IpcHandlersFor<typeof computerUseRequestSchemas> = {
  'computer_use.get_controls': async () => application.get('ComputerUseService').getControls(),
  'computer_use.stop_app': async ({ ownerId, appId }) => {
    await application.get('ComputerUseService').stopApp(ownerId, appId)
  },
  'computer_use.stop_all': async () => {
    await application.get('ComputerUseService').stopAll()
  },
  'computer_use.get_permission_status': () => application.get('ComputerUseService').getPermissionStatus(),
  'computer_use.request_permissions': ({ ids }) => application.get('ComputerUseService').requestPermissions(ids)
}
