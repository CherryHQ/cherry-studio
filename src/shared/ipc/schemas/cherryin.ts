import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * CherryIN IPC schemas — provider-specific sign-in, balance and logout operations.
 *
 * The OAuth engine is shared with Codex and Grok, while the renderer-facing
 * contract stays here because CherryIN supplies hosts and receives API keys.
 */

/** The CherryIN account profile, or null when the profile endpoint has nothing. */
const cherryInProfileSchema = z.object({
  displayName: z.string().nullable(),
  username: z.string().nullable(),
  email: z.string().nullable(),
  group: z.string().nullable()
})

/** Balance plus optional profile, returned to the settings panel. */
const cherryInBalanceSchema = z.object({
  balance: z.number(),
  profile: cherryInProfileSchema.nullable()
})

export type CherryInProfile = z.infer<typeof cherryInProfileSchema>
export type CherryInBalance = z.infer<typeof cherryInBalanceSchema>

const apiHostInput = z.object({ apiHost: z.string() })

export const cherryinRequestSchemas = {
  'cherryin.sign_in': defineRoute({
    input: z.object({ requestId: z.string().min(1), oauthServer: z.string(), apiHost: z.string().optional() }),
    output: z.object({ apiKeys: z.string().min(1) })
  }),
  'cherryin.get_balance': defineRoute({ input: apiHostInput, output: cherryInBalanceSchema }),
  'cherryin.logout': defineRoute({ input: apiHostInput, output: z.void() })
}
