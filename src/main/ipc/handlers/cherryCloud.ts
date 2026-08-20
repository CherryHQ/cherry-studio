import { application } from '@application'
import type { cherryCloudRequestSchemas } from '@shared/ipc/schemas/cherryCloud'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const cherryCloudHandlers: IpcHandlersFor<typeof cherryCloudRequestSchemas> = {
  'cherry_cloud.status.get': async () => application.get('CherryCloudService').getStatus(),
  'cherry_cloud.login.start': async () => application.get('CherryCloudService').startLogin()
}
