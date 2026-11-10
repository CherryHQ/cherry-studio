import * as z from 'zod'

import { defineRoute } from '../define'

export const computerUseAppSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  identity: z.string().min(1).max(512).optional()
})
export type ComputerUseApp = z.infer<typeof computerUseAppSchema>
export const computerUseAppIconSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('available'),
    icon: z.object({ mimeType: z.literal('image/png'), dataBase64: z.base64().min(1).max(65536) })
  }),
  z.object({ status: z.literal('unavailable') })
])

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
  'computer_use.get_call_apps': defineRoute({
    input: z.strictObject({ cell: z.uuid() }),
    output: z.array(computerUseAppSchema)
  }),
  'computer_use.get_app_icon': defineRoute({
    input: z.strictObject({ identity: z.string().min(1).max(512) }),
    output: computerUseAppIconSchema
  }),
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
