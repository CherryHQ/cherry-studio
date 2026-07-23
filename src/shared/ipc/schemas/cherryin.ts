import { CHERRYIN_HOSTS } from '@shared/utils/cherryin'
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

const cherryInHostModeSchema = z.enum(['auto', 'china', 'global'])
const cherryInEndpointSelectionSchema = z.object({
  host: z.enum([CHERRYIN_HOSTS.china, CHERRYIN_HOSTS.global]),
  mode: cherryInHostModeSchema,
  source: z.enum(['fallback', 'manual', 'probe'])
})
const apiHostInput = z.object({ apiHost: z.string() })

export const cherryinRequestSchemas = {
  'cherryin.get_endpoint_selection': defineRoute({ input: z.void(), output: cherryInEndpointSelectionSchema }),
  'cherryin.set_host_mode': defineRoute({
    input: z.object({ mode: cherryInHostModeSchema }),
    output: cherryInEndpointSelectionSchema
  }),
  'cherryin.get_balance': defineRoute({ input: apiHostInput, output: cherryInBalanceSchema }),
  'cherryin.logout': defineRoute({ input: apiHostInput, output: z.void() })
}

export type CherryInEventSchemas = {
  'cherryin.endpoint_selected': z.infer<typeof cherryInEndpointSelectionSchema>
}
