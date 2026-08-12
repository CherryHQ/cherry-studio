import { application } from '@application'
import { cherryInOAuthService } from '@main/services/oauth/CherryInOAuthService'
import type { cherryinRequestSchemas } from '@shared/ipc/schemas/cherryin'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const cherryinHandlers: IpcHandlersFor<typeof cherryinRequestSchemas> = {
  'cherryin.get_endpoint_selection': () => application.get('CherryInEndpointService').getSelection(),
  'cherryin.set_host_mode': ({ mode }) => application.get('CherryInEndpointService').setMode(mode),
  'cherryin.get_balance': ({ apiHost }) => cherryInOAuthService.getBalance(apiHost),
  'cherryin.logout': ({ apiHost }) => cherryInOAuthService.logout(apiHost)
}
