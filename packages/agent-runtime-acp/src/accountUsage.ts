import { RequestError, type InitializeResponse } from '@agentclientprotocol/sdk'
import * as z from 'zod'

import type { RuntimeAccountResult, SubscriptionUsageResult } from '@cherrystudio/agent-runtime'

import type { AcpAccountReader, AcpSubscriptionUsageReader } from './harness'

/** For runtimes where the advertised authenticate method only checks stored credentials. */
export async function readCachedAcpAccount(
  agent: Parameters<AcpAccountReader>[0],
  initialized: InitializeResponse,
  methodId: string
): Promise<RuntimeAccountResult> {
  if (!initialized.authMethods?.some(({ id }) => id === methodId)) return { status: 'unsupported' }
  try {
    await agent.request('authenticate', { methodId })
    return { status: 'signed-in' }
  } catch (error) {
    if (error instanceof RequestError && error.code === -32000) return { status: 'signed-out' }
    return { status: 'unknown' }
  }
}

export function acpSubscriptionUsageFailure(error: unknown): SubscriptionUsageResult {
  if (error instanceof RequestError) {
    if (error.code === -32000) return { status: 'signed-out' }
    if (error.code === -32601) return { status: 'unsupported' }
  }
  return { status: 'unavailable' }
}

const rateLimitCapability = z.object({
  lody: z.object({ rateLimits: z.object({ version: z.literal(1), query: z.literal(true) }) })
})

const rateLimitResponse = z.object({
  rateLimits: z.array(
    z.object({
      limitId: z.string(),
      planName: z.string().nullish(),
      scope: z.object({ providerId: z.string().optional(), modelId: z.string().optional() }).nullish(),
      windows: z.array(
        z.object({
          label: z.string().nullish(),
          usedPercent: z.number().min(0).max(100),
          windowDurationSeconds: z.number().positive().nullish(),
          resetsAtEpochSeconds: z.number().nonnegative().nullish()
        })
      )
    })
  ),
  fetchedAtEpochSeconds: z.number().nonnegative().optional()
})

export function advertisesAcpSubscriptionUsage(initialized: InitializeResponse): boolean {
  return rateLimitCapability.safeParse(initialized.agentCapabilities?._meta).success
}

export const readNegotiatedAcpUsage: AcpSubscriptionUsageReader = async (agent, initialized) => {
  if (!advertisesAcpSubscriptionUsage(initialized)) return { status: 'unsupported' }
  try {
    const result = rateLimitResponse.safeParse(await agent.request('_lody/rate_limits/get', {}))
    if (!result.success) return { status: 'unavailable' }
    const windows = result.data.rateLimits.flatMap((limit) =>
      limit.windows.map((window, index) => ({
        id: limit.limitId + ':' + index,
        label: [limit.planName ?? limit.scope?.providerId ?? limit.limitId, limit.scope?.modelId, window.label]
          .filter(Boolean)
          .join(' · '),
        usedRatio: window.usedPercent / 100,
        ...(window.windowDurationSeconds != null && { durationMinutes: window.windowDurationSeconds / 60 }),
        ...(window.resetsAtEpochSeconds != null && { resetsAt: window.resetsAtEpochSeconds * 1000 })
      }))
    )
    const fetchedAt = result.data.fetchedAtEpochSeconds
    return windows.length
      ? { status: 'available', readAt: fetchedAt === undefined ? Date.now() : fetchedAt * 1000, windows }
      : { status: 'unavailable' }
  } catch (error) {
    return acpSubscriptionUsageFailure(error)
  }
}
