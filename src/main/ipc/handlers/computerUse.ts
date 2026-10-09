import { application } from '@application'
import type { computerUseRequestSchemas } from '@shared/ipc/schemas/computerUse'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const computerUseHandlers: IpcHandlersFor<typeof computerUseRequestSchemas> = {
  'computer_use.get_permission_status': () => application.get('ComputerUseService').getPermissionStatus(),
  'computer_use.request_permissions': ({ ids }) => application.get('ComputerUseService').requestPermissions(ids)
}
