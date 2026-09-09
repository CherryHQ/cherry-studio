import * as z from 'zod'

export const ApiGatewayPairedDeviceSchema = z.strictObject({
  id: z.uuidv4(),
  name: z.string().min(1),
  platform: z.string().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})

/** Renderer-safe metadata for a device paired with the API Gateway. */
export type ApiGatewayPairedDevice = z.infer<typeof ApiGatewayPairedDeviceSchema>
