import { UniqueModelIdSchema } from '@shared/data/types/model'
import * as z from 'zod'

import { defineRoute } from '../define'

export const cherryCloudStatusSchema = z.strictObject({
  phase: z.enum(['signed-out', 'authorizing', 'signed-in']),
  displayName: z.string().nullable()
})

export type CherryCloudStatus = z.infer<typeof cherryCloudStatusSchema>

const cherryCloudModelSyncResultSchema = z.strictObject({
  entitledModelIds: z.array(UniqueModelIdSchema),
  quotaExhaustedModelIds: z.array(UniqueModelIdSchema)
})

export type CherryCloudModelSyncResult = z.infer<typeof cherryCloudModelSyncResultSchema>

export const cherryCloudRequestSchemas = {
  'cherry_cloud.status.get': defineRoute({ input: z.void(), output: cherryCloudStatusSchema }),
  'cherry_cloud.login.start': defineRoute({ input: z.void(), output: cherryCloudStatusSchema }),
  'cherry_cloud.login.cancel': defineRoute({ input: z.void(), output: cherryCloudStatusSchema }),
  'cherry_cloud.session.revoke': defineRoute({ input: z.void(), output: cherryCloudStatusSchema }),
  'cherry_cloud.models.sync': defineRoute({
    input: z.void(),
    output: cherryCloudModelSyncResultSchema
  })
}

export type CherryCloudEventSchemas = {
  'cherry_cloud.status_changed': CherryCloudStatus
}
