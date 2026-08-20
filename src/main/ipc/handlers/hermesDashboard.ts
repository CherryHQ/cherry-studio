import { application } from '@application'
import type { hermesDashboardRequestSchemas } from '@shared/ipc/schemas/hermesDashboard'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const hermesDashboardHandlers: IpcHandlersFor<typeof hermesDashboardRequestSchemas> = {
  'hermes_dashboard.start': async () => {
    try {
      return await application.get('HermesDashboardService').start()
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Failed to start Hermes Dashboard' }
    }
  },
  'hermes_dashboard.stop': async () => {
    try {
      await application.get('HermesDashboardService').stop()
      return { success: true }
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Failed to stop Hermes Dashboard' }
    }
  },
  'hermes_dashboard.get_status': async () => application.get('HermesDashboardService').getStatus()
}
