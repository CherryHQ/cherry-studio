import { application } from '@application'
import { OAuthSignInCancelledError } from '@main/services/oauth/errors'
import { authorizeTokenDanceApiKey } from '@main/services/tokenDanceOAuth'
import { isClaudeCodeProviderId } from '@shared/data/presets/claudeCode'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { oauthErrorCodes } from '@shared/ipc/errors/oauth'
import type { oauthRequestSchemas } from '@shared/ipc/schemas/oauth'
import type { IpcHandlersFor } from '@shared/ipc/types'

const runtime = () => application.get('OAuthRuntimeService')

async function mapSignInCancellation<T>(request: Promise<T>): Promise<T> {
  try {
    return await request
  } catch (error) {
    if (error instanceof OAuthSignInCancelledError) {
      throw new IpcError(oauthErrorCodes.SIGN_IN_CANCELLED, error.message)
    }
    throw error
  }
}

export const oauthHandlers: IpcHandlersFor<typeof oauthRequestSchemas> = {
  'oauth.sign_in': ({ providerId, requestId }) => mapSignInCancellation(runtime().signIn(providerId, requestId)),
  'oauth.sign_in.attach': ({ providerId, requestId }) =>
    mapSignInCancellation(runtime().joinActiveSignIn(providerId, requestId)),
  'oauth.cancel_sign_in': ({ providerId, requestId }) => runtime().cancelSignIn(providerId, requestId),
  'oauth.has_token': ({ providerId }) => runtime().hasToken(providerId),
  'oauth.get_account': ({ providerId }) => runtime().getAccount(providerId),
  'oauth.logout': ({ providerId }) => runtime().logout(providerId),
  'oauth.tokendance.authorize_api_key': () => authorizeTokenDanceApiKey(),
  // External-CLI login probe. `claude-code` is the only provider whose
  // `authMethods` includes `'external-cli'` today; reject anything else rather
  // than silently returning the Claude probe for an unrelated providerId. A
  // second external-cli provider adds a dispatch branch here.
  'oauth.check_external_login': ({ providerId }) => {
    if (!isClaudeCodeProviderId(providerId)) {
      throw new Error(`Unsupported external-cli provider: ${providerId}`)
    }
    return application.get('CodeCliService').checkClaudeLogin()
  },
  // `ctx.senderId` is the deep-link flow's initiator: the result is later pushed
  // point-to-point to exactly this window (carrying API keys), so a source-trust
  // caller with no window (`senderId === null`) is rejected inside the runtime.
  // Per-provider host validation lives in the provider definition's createClient.
  'oauth.start_deep_link_flow': ({ providerId, oauthServer, apiHost }, ctx) =>
    runtime().startDeepLinkFlow(ctx.senderId, providerId, { oauthServer, apiHost: apiHost ?? oauthServer })
}
