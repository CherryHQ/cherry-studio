import { application } from '@application'
import type { oauthRequestSchemas } from '@shared/ipc/schemas/oauth'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * OAuth handlers — thin adapters delegating to each provider's lifecycle service.
 * The void-returning sign-in/logout handlers swallow the service return so the
 * handler type matches the route's `z.void()` output.
 */
export const oauthHandlers: IpcHandlersFor<typeof oauthRequestSchemas> = {
  'oauth.codex_sign_in': () => application.get('CodexOauthService').signIn(),
  'oauth.codex_has_token': () => application.get('CodexOauthService').hasToken(),
  'oauth.codex_get_account': () => application.get('CodexOauthService').getAccount(),
  'oauth.codex_logout': () => application.get('CodexOauthService').logout(),
  'oauth.grok_sign_in': async () => {
    await application.get('GrokCliOauthService').signIn()
  },
  'oauth.grok_has_token': () => application.get('GrokCliOauthService').hasToken(),
  'oauth.grok_logout': () => application.get('GrokCliOauthService').logout()
}
