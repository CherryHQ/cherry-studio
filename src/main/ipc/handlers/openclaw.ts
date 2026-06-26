import { application } from '@application'
import type { openclawRequestSchemas } from '@shared/ipc/schemas/openclaw'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const openclawHandlers: IpcHandlersFor<typeof openclawRequestSchemas> = {
  'openclaw.start_gateway': async (_input, _ctx) => {
    try {
      const result = await application.get('OpenClawService').startGateway(_input)
      return result
    } catch (error: any) {
      return { success: false, message: error instanceof Error ? error.message : 'Unknown error' }
    }
  },
  'openclaw.stop_gateway': async () => {
    try {
      const result = await application.get('OpenClawService').stopGateway()
      return result
    } catch (error: any) {
      return { success: false, message: error instanceof Error ? error.message : 'Unknown error' }
    }
  },
  'openclaw.get_status': async () => {
    return application.get('OpenClawService').getStatus()
  },
  'openclaw.check_health': async () => {
    return application.get('OpenClawService').checkHealth()
  },
  'openclaw.get_dashboard_url': async () => {
    return application.get('OpenClawService').getDashboardUrl()
  },
  'openclaw.get_channels': async () => {
    return application.get('OpenClawService').getChannelStatus()
  },
  'openclaw.check_update': async () => {
    return application.get('OpenClawService').checkUpdate()
  },
  'openclaw.perform_update': async () => {
    try {
      const result = await application.get('OpenClawService').performUpdate()
      return result
    } catch (error: any) {
      return { success: false, message: error instanceof Error ? error.message : 'Unknown error' }
    }
  }
}
