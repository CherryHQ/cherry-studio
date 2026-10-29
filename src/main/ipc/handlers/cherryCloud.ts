import { application } from '@application'
import {
  CherryCloudLoginUnavailableError,
  CherryCloudSignInFailureError,
  CherryCloudUpgradeRequiredError
} from '@main/services/cherryCloud/CherryCloudService'
import { cherryCloudErrorCodes } from '@shared/ipc/errors/cherryCloud'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { normalizeSignInFailure, type SignInPhase } from '@shared/ipc/errors/signIn'
import type { cherryCloudRequestSchemas } from '@shared/ipc/schemas/cherryCloud'
import type { IpcHandlersFor } from '@shared/ipc/types'

async function runLoginCommand<T>(command: () => Promise<T>, phase?: SignInPhase): Promise<T> {
  try {
    return await command()
  } catch (error) {
    const failure =
      error instanceof CherryCloudSignInFailureError
        ? (normalizeSignInFailure(error.failure) ?? { reason: 'unknown' })
        : normalizeSignInFailure({ reason: 'unknown', phase })!
    const code =
      error instanceof CherryCloudUpgradeRequiredError
        ? cherryCloudErrorCodes.UPGRADE_REQUIRED
        : error instanceof CherryCloudLoginUnavailableError
          ? cherryCloudErrorCodes.LOGIN_SERVICE_UNAVAILABLE
          : cherryCloudErrorCodes.SIGN_IN_FAILED
    throw new IpcError(code, 'Cherry Cloud sign-in failed', failure)
  }
}

export const cherryCloudHandlers: IpcHandlersFor<typeof cherryCloudRequestSchemas> = {
  'cherry_cloud.status.get': async () => application.get('CherryCloudService').getStatus(),
  'cherry_cloud.api_origin.get': async () => application.get('CherryCloudService').getApiOrigin(),
  'cherry_cloud.login.start': () =>
    runLoginCommand(() => application.get('CherryCloudService').startLogin(), 'authorization'),
  'cherry_cloud.login.cancel': () => runLoginCommand(() => application.get('CherryCloudService').cancelLogin()),
  'cherry_cloud.session.revoke': async () => application.get('CherryCloudService').revokeCurrentSession(),
  'cherry_cloud.models.sync': async () => application.get('CherryCloudService').syncEntitledModelsIfStale(),
  'cherry_cloud.account_plans.get': async () => application.get('CherryCloudService').getAccountPlans()
}
