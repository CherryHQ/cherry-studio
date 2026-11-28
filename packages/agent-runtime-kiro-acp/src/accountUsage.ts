import * as z from 'zod'

import type { SubscriptionUsageResult } from '@cherrystudio/agent-runtime'

export interface KiroQuotaIdentity {
  accessToken: string
  profileArn: string
}

const usageSchema = z.object({
  nextDateReset: z.number().positive().nullish(),
  usageBreakdownList: z.array(
    z.object({
      resourceType: z.string(),
      usageLimitWithPrecision: z.number().nullish(),
      currentUsageWithPrecision: z.number().nullish(),
      currentOveragesWithPrecision: z.number().nullish(),
      nextDateReset: z.number().positive().nullish(),
      bonuses: z.array(z.unknown()).nullish()
    })
  )
})

export async function readKiroSubscriptionUsage(
  readIdentity: () => KiroQuotaIdentity | undefined,
  signal: AbortSignal
): Promise<SubscriptionUsageResult> {
  signal.throwIfAborted()
  const identity = readIdentity()
  if (!identity) return { status: 'unsupported' }
  const { accessToken, profileArn } = identity
  const region = /^arn:aws:codewhisperer:(us-east-1|eu-central-1):[^:]*:profile\/[\w-]+$/.exec(profileArn)?.[1]
  if (!region) return { status: 'unsupported' }
  const endpoint =
    region === 'us-east-1' ? 'https://codewhisperer.us-east-1.amazonaws.com/' : 'https://q.eu-central-1.amazonaws.com/'
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-amz-json-1.0',
      'X-Amz-Target': 'AmazonCodeWhispererService.GetUsageLimits'
    },
    body: JSON.stringify({ profileArn }),
    redirect: 'error',
    signal
  })
  if (!response.ok) return { status: 'unavailable' }
  const parsed = usageSchema.safeParse(await response.json())
  const current = readIdentity()
  if (current?.accessToken !== accessToken || current.profileArn !== profileArn) return { status: 'unavailable' }
  if (!parsed.success) return { status: 'unavailable' }
  const usage = parsed.data.usageBreakdownList.find(({ resourceType }) => resourceType === 'CREDIT')
  const limit = usage?.usageLimitWithPrecision
  const used = usage?.currentUsageWithPrecision
  if (!limit || limit < 0 || used == null || used < 0 || usage?.bonuses?.length) return { status: 'unavailable' }
  const overages = usage?.currentOveragesWithPrecision ?? 0
  if (overages < 0 || overages > used) return { status: 'unavailable' }
  const reset = usage?.nextDateReset ?? parsed.data.nextDateReset
  return {
    status: 'available',
    readAt: Date.now(),
    windows: [
      {
        id: 'credits',
        label: 'Credits',
        groupLabel: 'Kiro',
        usedRatio: Math.min((used - overages) / limit, 1),
        resetsAt: reset == null ? undefined : reset * 1000
      }
    ]
  }
}
