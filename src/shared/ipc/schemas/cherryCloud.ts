import { UniqueModelIdSchema } from '@shared/data/types/model'
import * as z from 'zod'

import { defineRoute } from '../define'

export const cherryCloudStatusSchema = z.strictObject({
  phase: z.enum(['signed-out', 'authorizing', 'signed-in']),
  displayName: z.string().nullable()
})

export type CherryCloudStatus = z.infer<typeof cherryCloudStatusSchema>

export const cherryCloudRequestSchemas = {
  'cherry_cloud.status.get': defineRoute({ input: z.void(), output: cherryCloudStatusSchema }),
  'cherry_cloud.login.start': defineRoute({ input: z.void(), output: cherryCloudStatusSchema }),
  'cherry_cloud.login.cancel': defineRoute({ input: z.void(), output: cherryCloudStatusSchema }),
  'cherry_cloud.session.revoke': defineRoute({ input: z.void(), output: cherryCloudStatusSchema }),
  'cherry_cloud.models.sync': defineRoute({
    input: z.void(),
    output: z.strictObject({
      modelCount: z.number().int().nonnegative(),
      quotaExhaustedModelIds: z.array(UniqueModelIdSchema)
    })
  })
}

export type CherryCloudEventSchemas = {
  'cherry_cloud.status_changed': CherryCloudStatus
}
