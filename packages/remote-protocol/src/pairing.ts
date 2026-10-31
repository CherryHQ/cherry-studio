import * as z from 'zod'

import { directEndpointSchema } from './discovery'

const pairingProofShape = {
  t: z.literal('cherry-studio-pair'),
  name: z.string().min(1).max(128),
  desktopIdentity: z.string().min(1).max(256),
  invitationId: z.string().min(1).max(256),
  invitationSecret: z.string().min(1).max(256),
  protocolVersions: z.array(z.number().int().positive()).min(1).max(16)
}

export const pairingQrSchema = z.discriminatedUnion('v', [
  z.object({
    ...pairingProofShape,
    v: z.literal(2),
    ips: z
      .array(z.union([z.ipv4(), z.ipv6().regex(/^[0-9a-f:.]+$/i)]))
      .min(1)
      .max(32),
    port: z.number().int().min(1).max(65535)
  }),
  z.object({
    ...pairingProofShape,
    v: z.literal(3),
    endpoints: z.array(directEndpointSchema).min(1).max(32)
  })
])

export type PairingQr = z.infer<typeof pairingQrSchema>
