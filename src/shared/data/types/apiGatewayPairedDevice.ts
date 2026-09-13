import * as z from 'zod'

export const ApiGatewayPairedDeviceSchema = z.strictObject({
  id: z.uuidv4(),
  name: z.string().trim().min(1).max(64),
  platform: z.string().trim().min(1).max(32),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})

/** Renderer-safe metadata for a device paired with the API Gateway. */
export type ApiGatewayPairedDevice = z.infer<typeof ApiGatewayPairedDeviceSchema>

export const ApiGatewayPairedDeviceMetadataSchema = ApiGatewayPairedDeviceSchema.pick({ name: true, platform: true })
export type ApiGatewayPairedDeviceMetadata = z.infer<typeof ApiGatewayPairedDeviceMetadataSchema>
