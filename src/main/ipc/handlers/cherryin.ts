import { cherryInOAuthService } from '@main/services/oauth/CherryInOAuthService'
import type { cherryinRequestSchemas } from '@shared/ipc/schemas/cherryin'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const cherryinHandlers: IpcHandlersFor<typeof cherryinRequestSchemas> = {
  'cherryin.get_balance': ({ apiHost }) => cherryInOAuthService.getBalance(apiHost),
  'cherryin.logout': ({ apiHost }) => cherryInOAuthService.logout(apiHost)
}
