import { application } from '@application'
import type { oauthRequestSchemas } from '@shared/ipc/schemas/oauth'
import type { IpcHandlersFor } from '@shared/ipc/types'

const runtime = () => application.get('OAuthRuntimeService')

export const oauthHandlers: IpcHandlersFor<typeof oauthRequestSchemas> = {
  'oauth.sign_in': ({ providerId }) => runtime().signIn(providerId),
  'oauth.has_token': ({ providerId }) => runtime().hasToken(providerId),
  'oauth.get_account': ({ providerId }) => runtime().getAccount(providerId),
  'oauth.logout': ({ providerId }) => runtime().logout(providerId)
}
