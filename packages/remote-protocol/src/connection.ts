import * as z from 'zod'

import { remoteCapabilitiesSchema } from './authorization'
import { remoteFailureSchema } from './errors'
import { protocolSupportSchema } from './negotiation'
import { opaqueId, timestamp, unicodeText } from './values'

export const remoteLimits = Object.freeze({
  recordBytes: 65_536,
  eventBatchBytes: 16_384,
  contentBytes: 24_576,
  pageItems: 100,
  inFlightRequests: 16,
  batchEntries: 16,
  unackedBytes: 262_144,
  queuedBytes: 1_048_576,
  subscriptions: 8,
  replayBytes: 8_388_608,
  replayMs: 300_000,
  globalReplayBytes: 67_108_864,
  checkpointMs: 300_000,
  globalCheckpointBytes: 33_554_432,
  heartbeatMs: 20_000,
  idleMs: 60_000,
  invitationMs: 120_000,
  tokenMs: 600_000,
  refreshGraceMs: 30_000
})

const empty = z.strictObject({})
const method = <P extends z.ZodType, R extends z.ZodType>(params: P, result: R) => ({
  params,
  result,
  errors: remoteFailureSchema
})

export function connectionMethods<A extends z.ZodType>(authorization: A) {
  const token = z.looseObject({ authorization, accessToken: opaqueId, expiresAt: timestamp })
  return {
    'connection.hello': method(
      protocolSupportSchema,
      z.looseObject({
        protocolVersion: z.number().int().positive(),
        agentFailureVersion: z.number().int().positive().optional(),
        limits: z.record(z.string(), z.number().int().positive()),
        heartbeatMs: z.number().int().positive()
      })
    ),
    'connection.authenticate': method(
      z.strictObject({ deviceId: opaqueId, accessToken: opaqueId.optional() }),
      token.extend({ deviceId: opaqueId })
    ),
    'connection.refresh': method(empty, token),
    'connection.ping': method(
      z.strictObject({ nonce: opaqueId }),
      z.looseObject({ nonce: opaqueId, serverTime: timestamp })
    )
  }
}

export function pairingMethods<A extends z.ZodType>(authorization: A) {
  return {
    'pairing.claim': method(
      z.strictObject({
        invitationId: opaqueId,
        invitationSecret: opaqueId,
        deviceName: unicodeText.trim().min(1).max(64),
        platform: z.enum(['ios', 'android', 'desktop']),
        capabilities: remoteCapabilitiesSchema
      }),
      z.looseObject({ claimId: opaqueId, verificationCode: z.string().regex(/^[0-9]{6}$/), expiresAt: timestamp })
    ),
    'pairing.get': method(
      z.strictObject({ claimId: opaqueId }),
      z.union([
        z.looseObject({ status: z.enum(['pending', 'rejected', 'expired']) }),
        z.looseObject({
          status: z.literal('approved'),
          deviceId: opaqueId,
          authorization,
          accessToken: opaqueId,
          expiresAt: timestamp
        })
      ])
    )
  }
}

export const connectionNotificationSchema = z.strictObject({
  jsonrpc: z.literal('2.0'),
  method: z.literal('connection.closed'),
  params: remoteFailureSchema
})
