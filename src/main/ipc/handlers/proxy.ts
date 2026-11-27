import { application } from '@application'
import type { proxyRequestSchemas } from '@shared/ipc/schemas/proxy'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const proxyHandlers: IpcHandlersFor<typeof proxyRequestSchemas> = {
  'proxy.test_connection': async (request) => application.get('ProxyService').testConnection(request)
}
