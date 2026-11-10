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

const computerUseControlSchema = z.object({
  ownerId: z.string(),
  label: z.string(),
  appId: z.string().optional(),
  appName: z.string().optional(),
  status: z.enum(['opening', 'active', 'stopping', 'stopped', 'unconfirmed'])
})

export type ComputerUseControl = z.infer<typeof computerUseControlSchema>
export type ControlStatus = ComputerUseControl['status']
export type ComputerUseEventSchemas = {
  'computer_use.controls_changed': ComputerUseControl[]
}

export const computerUseRequestSchemas = {
  'computer_use.get_controls': defineRoute({ input: z.void(), output: z.array(computerUseControlSchema) }),
  'computer_use.stop_app': defineRoute({
    input: z.strictObject({ ownerId: z.string().min(1), appId: z.string().min(1) }),
    output: z.void()
  }),
  'computer_use.stop_all': defineRoute({ input: z.void(), output: z.void() }),
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
