import * as z from 'zod'

import { defineRoute } from '../define'

const externalOpenTargetSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  iconDataUrl: z.string().min(1).optional(),
  kind: z.enum(['system_default', 'application', 'file_manager', 'terminal'])
})

export const externalAppRequestSchemas = {
  'external_app.target.list': defineRoute({
    input: z.strictObject({ targetPath: z.string().min(1), pathKind: z.enum(['file', 'directory']) }),
    output: z.strictObject({
      pathKind: z.enum(['file', 'directory']),
      recommendedTargetId: z.string().min(1),
      targets: z.array(externalOpenTargetSchema)
    })
  }),
  'external_app.target.open': defineRoute({
    input: z.strictObject({
      targetPath: z.string().min(1),
      pathKind: z.enum(['file', 'directory']),
      targetId: z.string().min(1)
    }),
    output: z.void()
  })
}
