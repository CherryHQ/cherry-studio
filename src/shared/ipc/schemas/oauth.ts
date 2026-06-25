import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * OAuth IPC schemas — sign-in / token-state / logout for the login-based CLI
 * providers (Codex, Grok CLI) whose flows the main process drives through a
 * loopback callback.
 *
 * One domain per provider family rather than per provider: the routes are thin
 * adapters over each provider's `*OauthService`, so `z.infer` of the input/output
 * schemas is the single source of truth for both the handler signatures and the
 * renderer facade — schema↔service drift becomes a compile error.
 */

/** Codex sign-in / get-account result: the ChatGPT account id, or null when absent. */
const codexAccountSchema = z.object({ accountId: z.string().nullable() })

export const oauthRequestSchemas = {
  'oauth.codex_sign_in': defineRoute({ input: z.void(), output: codexAccountSchema }),
  'oauth.codex_has_token': defineRoute({ input: z.void(), output: z.boolean() }),
  'oauth.codex_get_account': defineRoute({ input: z.void(), output: codexAccountSchema }),
  'oauth.codex_logout': defineRoute({ input: z.void(), output: z.void() }),
  'oauth.grok_sign_in': defineRoute({ input: z.void(), output: z.void() }),
  'oauth.grok_has_token': defineRoute({ input: z.void(), output: z.boolean() }),
  'oauth.grok_logout': defineRoute({ input: z.void(), output: z.void() })
}
