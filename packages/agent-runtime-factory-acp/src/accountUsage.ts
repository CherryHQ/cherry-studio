import * as z from 'zod'

import type { SubscriptionUsageResult } from '@cherrystudio/agent-runtime'
import { acpConfigRecord } from '@cherrystudio/agent-runtime-acp/profile'
import type { AcpAccountReader } from '@cherrystudio/agent-runtime-acp/v1'
import type { LaunchSpec, SpawnStdio } from '@cherrystudio/agent-runtime/stdio'

const accountStatus = z.object({
  state: z.enum(['authenticated', 'unauthenticated']),
  accounts: z
    .array(z.object({ active: z.boolean(), label: z.string().optional(), email: z.string().nullish() }))
    .optional()
})

export const readFactoryAccount: AcpAccountReader = async (agent, response, { env }) => {
  if (env.FACTORY_API_KEY) return { status: 'unknown' }
  const auth = acpConfigRecord(acpConfigRecord(response.agentCapabilities)?.auth)
  if (!auth || auth.status === undefined || auth.status === false) return { status: 'unsupported' }
  const result = accountStatus.safeParse(await agent.request('auth/status', {}))
  if (!result.success) return { status: 'unknown' }
  if (result.data.state === 'unauthenticated') return { status: 'signed-out' }
  const account = result.data.accounts?.find(({ active }) => active)
  if (account?.label === 'Factory API key') return { status: 'unknown' }
  const email = account?.email?.trim()
  return { status: 'signed-in', ...(email && { account: { email } }) }
}

const bucket = z.object({
  usedPercent: z.number().nonnegative().nullish(),
  windowEnd: z.string().nullish(),
  unlimited: z.boolean().optional()
})
const group = z.object({ fiveHour: bucket.nullish(), weekly: bucket.nullish(), monthly: bucket.nullish() })
const quota = z.object({
  hasActiveSubscription: z.boolean().optional(),
  limits: z.object({ standard: group.nullish(), core: group.nullish() }).nullish()
})

export async function readFactorySubscriptionUsage(
  launch: LaunchSpec,
  _spawn: SpawnStdio,
  signal: AbortSignal
): Promise<SubscriptionUsageResult> {
  const token = launch.env.FACTORY_API_KEY?.trim()
  if (!token) return { status: 'unsupported' }
  const origin = new URL(launch.env.FACTORY_API_BASE_URL ?? 'https://api.factory.ai').origin
  if (!['https://api.factory.ai', 'https://api.eu.factory.ai'].includes(origin)) return { status: 'unsupported' }
  const response = await fetch(new URL('/api/billing/limits', origin), {
    signal,
    redirect: 'error',
    headers: { Authorization: 'Bearer ' + token, 'X-Factory-Client': 'cli', Accept: 'application/json' }
  })
  if (response.status === 401 || response.status === 403) return { status: 'signed-out' }
  if (response.status === 404) return { status: 'unsupported' }
  if (!response.ok) return { status: 'unavailable' }
  const data = quota.parse(await response.json())
  const now = Date.now()
  const windows = (['standard', 'core'] as const).flatMap((id) =>
    (['fiveHour', 'weekly', 'monthly'] as const).flatMap((period) => {
      const limit = data.limits?.[id]?.[period]
      if (limit?.usedPercent == null || limit.unlimited) return []
      const resetsAt = Date.parse(limit.windowEnd ?? '')
      return [
        {
          id: id + ':' + period,
          label: id === 'core' ? 'Droid Core' : 'Droid',
          durationMinutes: period === 'fiveHour' ? 300 : period === 'weekly' ? 7 * 1440 : undefined,
          usedRatio: (Number.isFinite(resetsAt) && resetsAt <= now ? 0 : limit.usedPercent) / 100,
          resetsAt: Number.isFinite(resetsAt) && resetsAt > now ? resetsAt : undefined
        }
      ]
    })
  )
  return windows.length
    ? { status: 'available', readAt: now, windows }
    : { status: data.hasActiveSubscription === false ? 'unsupported' : 'unavailable' }
}
