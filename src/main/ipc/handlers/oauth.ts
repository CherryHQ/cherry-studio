import { application } from '@application'
import { isClaudeCodeProviderId } from '@shared/data/presets/claudeCode'
import type { oauthRequestSchemas } from '@shared/ipc/schemas/oauth'
import type { IpcHandlersFor } from '@shared/ipc/types'

const runtime = () => application.get('OAuthRuntimeService')

export const oauthHandlers: IpcHandlersFor<typeof oauthRequestSchemas> = {
  'oauth.sign_in': ({ providerId }) => runtime().signIn(providerId),
  'oauth.has_token': ({ providerId }) => runtime().hasToken(providerId),
  'oauth.get_account': ({ providerId }) => runtime().getAccount(providerId),
  'oauth.logout': ({ providerId }) => runtime().logout(providerId),
  // External-CLI login probe. `claude-code` is the only provider whose
  // `authMethods` includes `'external-cli'` today; reject anything else rather
  // than silently returning the Claude probe for an unrelated providerId. A
  // second external-cli provider adds a dispatch branch here.
  'oauth.check_external_login': ({ providerId }) => {
    if (!isClaudeCodeProviderId(providerId)) {
      throw new Error(`Unsupported external-cli provider: ${providerId}`)
    }
    return application.get('CodeCliService').checkClaudeLogin()
  }
}
