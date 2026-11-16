import { application } from '@application'
import type { analyticsRequestSchemas } from '@shared/ipc/schemas/analytics'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const analyticsHandlers: IpcHandlersFor<typeof analyticsRequestSchemas> = {
  'analytics.track': async (event) => application.get('AnalyticsService').trackProductEvent(event)
}
