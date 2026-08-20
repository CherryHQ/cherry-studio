import { application } from '@application'
import { CherryCloudLoginUnavailableError } from '@main/services/cherryCloud/CherryCloudService'
import { cherryCloudErrorCodes } from '@shared/ipc/errors/cherryCloud'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { cherryCloudRequestSchemas } from '@shared/ipc/schemas/cherryCloud'
import type { IpcHandlersFor } from '@shared/ipc/types'

async function startLogin() {
  try {
    return await application.get('CherryCloudService').startLogin()
  } catch (error) {
    if (error instanceof CherryCloudLoginUnavailableError) {
      throw new IpcError(cherryCloudErrorCodes.LOGIN_SERVICE_UNAVAILABLE, error.message)
    }
    throw error
  }
}

export const cherryCloudHandlers: IpcHandlersFor<typeof cherryCloudRequestSchemas> = {
  'cherry_cloud.status.get': async () => application.get('CherryCloudService').getStatus(),
  'cherry_cloud.login.start': startLogin
}
