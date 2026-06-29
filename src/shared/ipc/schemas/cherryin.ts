import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * CherryIN IPC schemas — the deep-link OAuth flow plus the CherryIN-only
 * balance/logout operations.
 *
 * Unlike the provider-generic `oauth.*` routes (Codex / Grok loopback), CherryIN
 * drives a *deep-link* flow: `start_oauth_flow` returns an auth URL the renderer
 * opens, and the outcome arrives out-of-band via the `cherryin.oauth_result`
 * event keyed by `state`. It also exposes account balance/profile the loopback
 * providers have no concept of.
 *
 * No token ever crosses this boundary: the OAuth access token stays in main, and
 * the success event carries only the user's provisioned API keys (by design).
 */

/** The CherryIN account profile, or null when the profile endpoint has nothing. */
const cherryInProfileSchema = z.object({
  displayName: z.string().nullable(),
  username: z.string().nullable(),
  email: z.string().nullable(),
  group: z.string().nullable()
})

/** Balance plus optional profile/usage, returned to the settings panel. */
const cherryInBalanceSchema = z.object({
  balance: z.number(),
  profile: cherryInProfileSchema.nullable(),
  monthlyUsageTokens: z.number().nullable(),
  monthlySpend: z.number().nullable()
})

export type CherryInProfile = z.infer<typeof cherryInProfileSchema>
export type CherryInBalance = z.infer<typeof cherryInBalanceSchema>

const apiHostInput = z.object({ apiHost: z.string() })

export const cherryinRequestSchemas = {
  'cherryin.start_oauth_flow': defineRoute({
    input: z.object({ oauthServer: z.string(), apiHost: z.string().optional() }),
    output: z.object({ authUrl: z.string(), state: z.string() })
  }),
  'cherryin.get_balance': defineRoute({ input: apiHostInput, output: cherryInBalanceSchema }),
  'cherryin.logout': defineRoute({ input: apiHostInput, output: z.void() })
}

/**
 * Main → initiator-window push: the deep-link OAuth outcome, keyed by `state`.
 * Pushed point-to-point (`IpcApiService.send`) to the window that started the
 * flow, never broadcast — the API keys must not leak to other windows.
 */
export type CherryinEventSchemas = {
  'cherryin.oauth_result': { state: string; apiKeys: string } | { state: string; error: string }
}
