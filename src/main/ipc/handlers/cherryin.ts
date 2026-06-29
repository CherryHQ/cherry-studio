import { application } from '@application'
import type { cherryinRequestSchemas } from '@shared/ipc/schemas/cherryin'
import type { IpcHandlersFor } from '@shared/ipc/types'

const service = () => application.get('CherryInOauthService')

export const cherryinHandlers: IpcHandlersFor<typeof cherryinRequestSchemas> = {
  // `senderId` is the deep-link flow's initiator: the OAuth result is later pushed
  // point-to-point to exactly this window (carrying API keys), so a source-trust
  // caller with no window (`senderId === null`) is rejected inside the service.
  'cherryin.start_oauth_flow': ({ oauthServer, apiHost }, ctx) =>
    service().startOAuthFlow(ctx.senderId, oauthServer, apiHost),
  'cherryin.get_balance': ({ apiHost }) => service().getBalance(apiHost),
  'cherryin.logout': ({ apiHost }) => service().logout(apiHost)
}
