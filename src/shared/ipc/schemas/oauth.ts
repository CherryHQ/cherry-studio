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
 * Two flow shapes share this surface: a loopback callback (Codex, Grok CLI,
 * via `sign_in`) and a deep-link callback (CherryIN, via `start_deep_link_flow`
 * whose outcome arrives out-of-band on the `oauth.deep_link_result` event).
 *
 * `sign_in`/`get_account` return the account superset (just the account id);
 * providers without an account concept resolve `{ accountId: null }`.
 *
 * `check_external_login` covers the other login shape — providers whose
 * credential lives in an external CLI's store (`authMethods` includes
 * `'external-cli'`, e.g. Claude Code) rather than an app-held token. It is a
 * read-only presence probe; no credential is read or returned.
 */

/** The account a provider associates with the session (Codex's ChatGPT id), or null. */
const oauthAccountSchema = z.object({ accountId: z.string().nullable() })

/** Every route targets one provider, named by its runtime id. */
const providerInput = z.object({ providerId: z.string() })

export const oauthRequestSchemas = {
  'oauth.sign_in': defineRoute({ input: providerInput, output: oauthAccountSchema }),
  'oauth.has_token': defineRoute({ input: providerInput, output: z.boolean() }),
  'oauth.get_account': defineRoute({ input: providerInput, output: oauthAccountSchema }),
  'oauth.logout': defineRoute({ input: providerInput, output: z.void() }),
  'oauth.check_external_login': defineRoute({ input: providerInput, output: z.boolean() }),
  // Deep-link flow start: returns the auth URL the renderer opens; the outcome
  // arrives out-of-band on `oauth.deep_link_result`, keyed by `state`. The
  // provider's allowed-host validation lives in its definition's `createClient`,
  // which the runtime invokes before returning the URL.
  'oauth.start_deep_link_flow': defineRoute({
    input: z.object({ providerId: z.string(), oauthServer: z.string(), apiHost: z.string().optional() }),
    output: z.object({ authUrl: z.string(), state: z.string() })
  })
}

/**
 * Main → initiator-window push: the deep-link OAuth outcome, keyed by `state`.
 * Pushed point-to-point (`IpcApiService.send`) to the window that started the
 * flow, never broadcast — the API keys must not leak to other windows. No token
 * crosses this boundary; the success event carries only provisioned API keys.
 */
export type OAuthEventSchemas = {
  'oauth.deep_link_result': { state: string; apiKeys: string } | { state: string; error: string }
}
