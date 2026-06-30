import { application } from '@application'
import type { cherryinRequestSchemas } from '@shared/ipc/schemas/cherryin'
import type { IpcHandlersFor } from '@shared/ipc/types'

const service = () => application.get('CherryInOauthService')

export const cherryinHandlers: IpcHandlersFor<typeof cherryinRequestSchemas> = {
  'cherryin.get_balance': ({ apiHost }) => service().getBalance(apiHost),
  'cherryin.logout': ({ apiHost }) => service().logout(apiHost)
}
