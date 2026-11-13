import { application } from '@application'
import {
  CherryCloudLoginUnavailableError,
  CherryCloudPortalOpenError,
  CherryCloudUpgradeRequiredError
} from '@main/services/cherryCloud/CherryCloudService'
import { trackCherryCloudAnalyticsEvent } from '@main/services/cherryCloud/subscriptionAnalytics'
import { cherryCloudErrorCodes } from '@shared/ipc/errors/cherryCloud'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { cherryCloudRequestSchemas } from '@shared/ipc/schemas/cherryCloud'
import type { IpcHandlersFor } from '@shared/ipc/types'

async function runCloudCommand<T>(command: () => Promise<T>): Promise<T> {
  try {
    return await command()
  } catch (error) {
    if (error instanceof CherryCloudUpgradeRequiredError) {
      throw new IpcError(cherryCloudErrorCodes.UPGRADE_REQUIRED, error.message)
    }
    if (error instanceof CherryCloudLoginUnavailableError) {
      throw new IpcError(cherryCloudErrorCodes.LOGIN_SERVICE_UNAVAILABLE, error.message)
    }
    if (error instanceof CherryCloudPortalOpenError) {
      throw new IpcError(cherryCloudErrorCodes.PORTAL_OPEN_FAILED, error.message)
    }
    throw error
  }
}

export const cherryCloudHandlers: IpcHandlersFor<typeof cherryCloudRequestSchemas> = {
  'cherry_cloud.status.get': async () => application.get('CherryCloudService').getStatus(),
  'cherry_cloud.account_origin.get': async () => application.get('CherryCloudService').getAccountOrigin(),
  'cherry_cloud.login.start': async () => runCloudCommand(() => application.get('CherryCloudService').startLogin()),
  'cherry_cloud.subscription.start': async (input, ctx) =>
    runCloudCommand(() => application.get('CherryCloudService').startSubscription(input, ctx.senderId)),
  'cherry_cloud.login.cancel': async () => application.get('CherryCloudService').cancelLogin(),
  'cherry_cloud.session.revoke': async () => application.get('CherryCloudService').revokeCurrentSession(),
  'cherry_cloud.models.sync': async () => application.get('CherryCloudService').syncEntitledModelsIfStale(),
  'cherry_cloud.account.get': async () => {
    const service = application.get('CherryCloudService')
    await service.getStatus()
    return service.getAccountReceipt()
  },
  'cherry_cloud.account.refresh': async (input) => application.get('CherryCloudService').refreshAccount(input),
  'cherry_cloud.account_portal.open': async (input, ctx) =>
    application.get('CherryCloudService').openAccountPortal(input, ctx.senderId),
  'cherry_cloud.public_plans.get': async () => application.get('CherryCloudService').getPublicPlans(),
  'cherry_cloud.analytics.track': async ({ payload, scopeId }) => trackCherryCloudAnalyticsEvent(payload, scopeId),
  'cherry_cloud.notifications.active.get': async () =>
    application.getOptional('CherryCloudNotificationService')?.isActive() ?? false
}
