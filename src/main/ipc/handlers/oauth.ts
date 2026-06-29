import { application } from '@application'
import type { oauthRequestSchemas } from '@shared/ipc/schemas/oauth'
import type { IpcHandlersFor } from '@shared/ipc/types'

const runtime = () => application.get('OAuthRuntimeService')

export const oauthHandlers: IpcHandlersFor<typeof oauthRequestSchemas> = {
  'oauth.sign_in': ({ providerId }) => runtime().signIn(providerId),
  'oauth.has_token': ({ providerId }) => runtime().hasToken(providerId),
  'oauth.get_account': ({ providerId }) => runtime().getAccount(providerId),
  'oauth.logout': ({ providerId }) => runtime().logout(providerId),
  // External-CLI login probe. `claude-code` is the only `credentialSource:
  // 'external-cli'` provider today, so the probe maps directly to the Claude
  // Code CLI login check; the `providerId` keeps the route shape uniform with
  // the rest of the domain for when another external-cli provider lands.
  'oauth.check_external_login': () => application.get('CodeCliService').checkClaudeLogin()
}
