import { application } from '@application'
import { OPENAI_CODEX_PROVIDER_ID } from '@shared/data/presets/codex'
import { GROK_CLI_PROVIDER_ID } from '@shared/data/presets/grokCli'
import type { oauthRequestSchemas } from '@shared/ipc/schemas/oauth'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * OAuth handlers — thin, provider-generic adapters. The routes carry a
 * `providerId`; this table is the single source of truth mapping it to the
 * lifecycle service that drives that provider's loopback flow. Adding a provider
 * is one entry here (plus the service itself) — no new routes or schemas.
 */
const OAUTH_SERVICES = {
  [OPENAI_CODEX_PROVIDER_ID]: 'CodexOauthService',
  [GROK_CLI_PROVIDER_ID]: 'GrokCliOauthService'
} as const

const resolve = (providerId: string) => {
  const serviceName = OAUTH_SERVICES[providerId as keyof typeof OAUTH_SERVICES]
  if (!serviceName) {
    throw new Error(`No OAuth service registered for provider: ${providerId}`)
  }
  return application.get(serviceName)
}

export const oauthHandlers: IpcHandlersFor<typeof oauthRequestSchemas> = {
  'oauth.sign_in': ({ providerId }) => resolve(providerId).signIn(),
  'oauth.has_token': ({ providerId }) => resolve(providerId).hasToken(),
  'oauth.get_account': ({ providerId }) => resolve(providerId).getAccount(),
  'oauth.logout': ({ providerId }) => resolve(providerId).logout()
}
