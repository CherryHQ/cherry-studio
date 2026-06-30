import { cherryInOauthService } from '@main/services/oauth/CherryInOauthService'
import type { cherryinRequestSchemas } from '@shared/ipc/schemas/cherryin'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const cherryinHandlers: IpcHandlersFor<typeof cherryinRequestSchemas> = {
  'cherryin.get_balance': ({ apiHost }) => cherryInOauthService.getBalance(apiHost),
  'cherryin.logout': ({ apiHost }) => cherryInOauthService.logout(apiHost)
}
