import { PkceOAuthClient } from '@main/utils/oauth/PkceOAuthClient'
import { SystemProviderIds } from '@shared/utils/systemProviderId'
import { net } from 'electron'

import { ApiKeysResponseSchema, CHERRYIN_CONFIG, validateCherryInApiHost } from '../../CherryInOAuthConfig'
import { OAuthServiceError } from '../../errors'
import type { OAuthRuntimeProviderContext, OAuthRuntimeProviderDefinition } from '../types'

function resolveCherryInContext(context?: OAuthRuntimeProviderContext): { oauthServer: string; apiHost: string } {
  const oauthServer = context?.oauthServer ?? CHERRYIN_CONFIG.ALLOWED_HOSTS[0]
  validateCherryInApiHost(oauthServer)

  const apiHost = context?.apiHost ?? oauthServer
  validateCherryInApiHost(apiHost)
  return { oauthServer, apiHost }
}

async function fetchCherryInApiKeys(accessToken: string, apiHost: string): Promise<string> {
  const response = await net.fetch(`${apiHost}/api/v1/oauth/tokens`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` }
  })

  if (!response.ok) {
    throw new OAuthServiceError(`Failed to fetch API keys: ${response.status}`)
  }

  const keysArray = ApiKeysResponseSchema.parse(await response.json())
  const apiKeys = keysArray.filter(Boolean).join(',')
  if (!apiKeys) {
    throw new OAuthServiceError('No API keys received')
  }
  return apiKeys
}

export const cherryInOAuthProvider = {
  providerId: SystemProviderIds.cherryin,
  clientId: CHERRYIN_CONFIG.CLIENT_ID,
  transport: { type: 'deep-link', config: { redirectUri: CHERRYIN_CONFIG.REDIRECT_URI } },
  createClient: (context?: OAuthRuntimeProviderContext) => {
    const { oauthServer, apiHost } = resolveCherryInContext(context)
    const tokenHost = context?.oauthServer ?? apiHost
    return new PkceOAuthClient({
      clientId: CHERRYIN_CONFIG.CLIENT_ID,
      authorizeUrl: `${oauthServer}/oauth2/auth`,
      tokenUrl: `${tokenHost}/oauth2/token`,
      redirectUri: CHERRYIN_CONFIG.REDIRECT_URI,
      scope: CHERRYIN_CONFIG.SCOPES
    })
  },
  beforePersistTokens: async (tokenData, context) => {
    const { apiHost } = resolveCherryInContext(context)
    return { apiKeys: await fetchCherryInApiKeys(tokenData.access_token, apiHost) }
  }
} satisfies OAuthRuntimeProviderDefinition
