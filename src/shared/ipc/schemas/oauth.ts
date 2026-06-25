import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * OAuth IPC schemas — sign-in / token-state / logout for the login-based CLI
 * providers (Codex, Grok CLI) whose flows the main process drives through a
 * loopback callback.
 *
 * Provider-generic, not per-provider: a fixed set of operations carries the
 * target `providerId` as input, and the handler dispatches to that provider's
 * `*OauthService`. Adding a provider needs no new route — only a handler-side
 * dispatch entry — so the IPC surface stays flat as the provider set grows.
 *
 * `sign_in`/`get_account` return the account superset (just the account id);
 * providers without an account concept resolve `{ accountId: null }`.
 */

/** The account a provider associates with the session (Codex's ChatGPT id), or null. */
const oauthAccountSchema = z.object({ accountId: z.string().nullable() })

/** Every route targets one provider, named by its runtime id. */
const providerInput = z.object({ providerId: z.string() })

export const oauthRequestSchemas = {
  'oauth.sign_in': defineRoute({ input: providerInput, output: oauthAccountSchema }),
  'oauth.has_token': defineRoute({ input: providerInput, output: z.boolean() }),
  'oauth.get_account': defineRoute({ input: providerInput, output: oauthAccountSchema }),
  'oauth.logout': defineRoute({ input: providerInput, output: z.void() })
}
