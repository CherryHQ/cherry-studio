import * as z from 'zod'

import type { RemoteFailure } from './errors'

export const protocolSupportSchema = z.strictObject({
  protocolVersions: z.array(z.number().int().positive()).min(1).max(16)
})
export type ProtocolSupport = z.infer<typeof protocolSupportSchema>
export type ProtocolOffer = ProtocolSupport
export type ProtocolSelection = { protocolVersion: number }

export function negotiateProtocol(
  local: ProtocolSupport,
  remote: ProtocolOffer
): { ok: true; selection: ProtocolSelection } | { ok: false; error: RemoteFailure } {
  const supported = protocolSupportSchema.parse(local).protocolVersions
  const offered = protocolSupportSchema.parse(remote).protocolVersions
  const common = supported.filter((version) => offered.includes(version))
  if (!common.length)
    return {
      ok: false,
      error: {
        reason: 'UPGRADE_REQUIRED',
        message: 'No common protocol version',
        details: { supportedProtocolVersions: supported }
      }
    }
  return { ok: true, selection: { protocolVersion: Math.max(...common) } }
}
