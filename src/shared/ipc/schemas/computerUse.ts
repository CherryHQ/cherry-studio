import * as z from 'zod'

import { defineRoute } from '../define'

const permissionStatusSchema = z.object({
  permissions: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      status: z.enum(['granted', 'denied', 'notDetermined', 'unknown', 'unavailable']),
      interaction: z.enum(['none', 'systemPrompt', 'systemSettings'])
    })
  )
})

export const computerUseRequestSchemas = {
  'computer_use.get_permission_status': defineRoute({
    input: z.void(),
    output: permissionStatusSchema
  }),
  'computer_use.request_permissions': defineRoute({
    input: z
      .object({
        ids: z.tuple([z.enum(['accessibility', 'screenRecording'])]).rest(z.enum(['accessibility', 'screenRecording']))
      })
      .strict(),
    output: permissionStatusSchema
  })
}
