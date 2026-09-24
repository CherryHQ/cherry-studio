import { cherryInOAuthService } from '@main/services/oauth/CherryInOAuthService'
import { OAuthServiceError } from '@main/services/oauth/errors'
import type { cherryinRequestSchemas } from '@shared/ipc/schemas/cherryin'
import type { IpcHandlersFor } from '@shared/ipc/types'
import { SystemProviderIds } from '@shared/utils/systemProviderId'

import { runOAuthSignIn } from './oauthSignIn'

export const cherryinHandlers: IpcHandlersFor<typeof cherryinRequestSchemas> = {
  'cherryin.sign_in': async ({ requestId, oauthServer, apiHost }, ctx) => {
    const { apiKeys } = await runOAuthSignIn(ctx.senderId, SystemProviderIds.cherryin, requestId, {
      oauthServer,
      apiHost
    })
    if (!apiKeys) throw new OAuthServiceError('No API keys received')
    return { apiKeys }
  },
  'cherryin.get_balance': ({ apiHost }) => cherryInOAuthService.getBalance(apiHost),
  'cherryin.logout': ({ apiHost }) => cherryInOAuthService.logout(apiHost)
}
