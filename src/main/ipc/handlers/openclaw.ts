import { application } from '@application'
import type { openclawRequestSchemas } from '@shared/ipc/schemas/openclaw'
import type { IpcHandlersFor } from '@shared/ipc/types'

type GatewayStatusResult = { success: boolean; message?: string }

/** Run a gateway operation, turning a thrown error into a failed OperationResult. */
async function asOperationResult(fn: () => Promise<GatewayStatusResult>): Promise<GatewayStatusResult> {
  try {
    return await fn()
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export const openclawHandlers: IpcHandlersFor<typeof openclawRequestSchemas> = {
  'openclaw.start_gateway': (input) => asOperationResult(() => application.get('OpenClawService').startGateway(input)),
  'openclaw.stop_gateway': () => asOperationResult(() => application.get('OpenClawService').stopGateway()),
  'openclaw.get_status': async () => {
    return application.get('OpenClawService').getStatus()
  },
  'openclaw.check_health': async () => {
    return application.get('OpenClawService').checkHealth()
  },
  'openclaw.get_dashboard_url': async () => {
    return application.get('OpenClawService').getDashboardUrl()
  },
  'openclaw.sync_config': (input) => asOperationResult(() => application.get('OpenClawService').syncConfig(input)),
  'openclaw.get_channels': async () => {
    return application.get('OpenClawService').getChannelStatus()
  },
  'openclaw.check_update': async () => {
    return application.get('OpenClawService').checkUpdate()
  },
  'openclaw.perform_update': () => asOperationResult(() => application.get('OpenClawService').performUpdate())
}
