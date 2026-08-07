import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * CherryIN IPC schemas — the CherryIN-only balance/logout operations.
 *
 * The OAuth flow itself is provider-generic and lives on the `oauth.*` surface
 * (`oauth.start_deep_link_flow` + the `oauth.deep_link_result` event); only the
 * account balance/profile the loopback providers have no concept of stays here.
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
  'cherryin.get_balance': defineRoute({ input: apiHostInput, output: cherryInBalanceSchema }),
  'cherryin.logout': defineRoute({ input: apiHostInput, output: z.void() })
}
