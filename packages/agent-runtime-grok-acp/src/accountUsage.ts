import * as z from 'zod'

import type { SubscriptionUsageWindow } from '@cherrystudio/agent-runtime'
import {
  acpSubscriptionUsageFailure,
  readCachedAcpAccount,
  type AcpAccountReader,
  type AcpSubscriptionUsageReader
} from '@cherrystudio/agent-runtime-acp/v1'

export const readGrokAccount: AcpAccountReader = async (agent, response, { env }) => {
  if (env.XAI_API_KEY || env.GROK_API_KEY || env.XAI_BASE_URL || env.GROK_BASE_URL) return { status: 'unknown' }
  const methods = response.authMethods ?? []
  if (methods.some(({ id }) => id === 'cached_token')) return readCachedAcpAccount(agent, response, 'cached_token')
  return { status: methods.some(({ id }) => id === 'grok.com') ? 'signed-out' : 'unknown' }
}

const amount = z.object({ val: z.number() }).nullish()
const billing = z.object({
  config: z
    .object({
      creditUsagePercent: z.number().nonnegative().nullish(),
      used: amount,
      monthlyLimit: amount,
      onDemandUsed: amount,
      onDemandCap: amount,
      currentPeriod: z.object({ type: z.string().nullish(), end: z.string().nullish() }).nullish(),
      billingPeriodEnd: z.string().nullish()
    })
    .nullish()
})

export const readGrokSubscriptionUsage: AcpSubscriptionUsageReader = async (agent, initialized, target) => {
  if (target.env.XAI_API_KEY || target.env.GROK_API_KEY || target.env.XAI_BASE_URL || target.env.GROK_BASE_URL)
    return { status: 'unsupported' }
  try {
    if (initialized.authMethods?.some(({ id }) => id === 'cached_token'))
      await agent.request('authenticate', { methodId: 'cached_token' })
    const reply = billing.safeParse(await agent.request('_x.ai/billing', {}))
    if (!reply.success) return { status: 'unavailable' }
    const config = reply.data.config
    if (!config) return { status: 'unsupported' }
    const legacyLimit = config.monthlyLimit?.val
    const legacyUsed = config.used?.val
    const usedRatio =
      config.creditUsagePercent != null
        ? config.creditUsagePercent / 100
        : legacyLimit !== undefined && legacyLimit > 0 && legacyUsed !== undefined
          ? legacyUsed / legacyLimit
          : undefined
    const parsedEnd = Date.parse(config.currentPeriod?.end ?? config.billingPeriodEnd ?? '')
    const resetsAt = Number.isFinite(parsedEnd) ? parsedEnd : undefined
    const durationMinutes = config.currentPeriod?.type === 'USAGE_PERIOD_TYPE_WEEKLY' ? 7 * 1440 : undefined
    const windows: SubscriptionUsageWindow[] = []
    if (usedRatio !== undefined && usedRatio >= 0)
      windows.push({
        id: 'included',
        label: 'Grok',
        groupLabel: durationMinutes ? 'Grok' : undefined,
        usedRatio,
        durationMinutes,
        resetsAt
      })
    const cap = config.onDemandCap?.val
    const used = config.onDemandUsed?.val
    if (cap !== undefined && cap > 0 && used !== undefined && used >= 0)
      windows.push({ id: 'on-demand', label: 'Grok Pay-as-you-go', usedRatio: used / cap, resetsAt })
    return windows.length ? { status: 'available', readAt: Date.now(), windows } : { status: 'unavailable' }
  } catch (error) {
    return acpSubscriptionUsageFailure(error)
  }
}
