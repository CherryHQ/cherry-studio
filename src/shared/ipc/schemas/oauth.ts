import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * OAuth IPC schemas — sign-in / token-state / logout for the login-based
 * providers, driven by the main process through the shared `OAuthRuntimeService`
 * + its provider definitions (`providers/<id>.ts`).
 *
 * Provider-generic, not per-provider: a fixed set of operations carries the
 * target `providerId` as input, and the handler drives every provider through
 * the runtime. Adding a provider needs no new route and no new service — only a
 * provider definition entry — so the IPC surface stays flat as the set grows.
 *
 * Codex, Grok CLI and CherryIN use an HTTP loopback callback through `sign_in`.
 *
 * `sign_in` may also return provisioned API keys; OAuth tokens stay in main.
 * `get_account` returns only the account id;
 * providers without an account concept resolve `{ accountId: null }`.
 *
 * `check_external_login` covers the other login shape — providers whose
 * credential lives in an external CLI's store (`authMethods` includes
 * `'external-cli'`, e.g. Claude Code) rather than an app-held token. It is a
 * read-only presence probe; no credential is read or returned.
 */

/** The account a provider associates with the session (Codex's ChatGPT id), or null. */
const oauthAccountSchema = z.object({ accountId: z.string().nullable() })

const oauthSignInResultSchema = oauthAccountSchema.extend({ apiKeys: z.string().optional() })

const signInAttachResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('not-found') }),
  z.object({ status: z.literal('completed'), account: oauthAccountSchema })
])

/** Every route targets one provider, named by its runtime id. */
const providerInput = z.object({ providerId: z.string() })
const signInObservationInput = providerInput.extend({ requestId: z.string().min(1) })

export const oauthRequestSchemas = {
  'oauth.sign_in': defineRoute({
    input: signInObservationInput.extend({ oauthServer: z.string().optional(), apiHost: z.string().optional() }),
    output: oauthSignInResultSchema
  }),
  'oauth.sign_in.attach': defineRoute({ input: signInObservationInput, output: signInAttachResultSchema }),
  'oauth.cancel_sign_in': defineRoute({ input: signInObservationInput, output: z.void() }),
  'oauth.has_token': defineRoute({ input: providerInput, output: z.boolean() }),
  'oauth.get_account': defineRoute({ input: providerInput, output: oauthAccountSchema }),
  'oauth.logout': defineRoute({ input: providerInput, output: z.void() }),
  'oauth.tokendance.authorize_api_key': defineRoute({ input: z.void(), output: z.string().min(1) }),
  'oauth.check_external_login': defineRoute({ input: providerInput, output: z.boolean() })
}
