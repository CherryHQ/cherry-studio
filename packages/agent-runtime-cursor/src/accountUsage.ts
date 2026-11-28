import { readFile } from 'node:fs/promises'

import * as z from 'zod'

import type { SubscriptionUsageResult } from '@cherrystudio/agent-runtime'

const backend = 'https://api2.cursor.sh'
const cursorBackend = () => (process.env.CURSOR_BACKEND_URL || backend).replace(/\/+$/, '')
const sdkLogin = z.object({
  version: z.literal(1),
  backendUrl: z.string().min(1),
  apiKey: z.string().min(1),
  createdAtMs: z.number(),
  apiKeyExpiresAtMs: z.number().optional()
})
const exchangeResult = z.object({ accessToken: z.string().min(1) })
const percent = z.number().nonnegative().nullish()
const periodUsage = z.object({
  billingCycleEnd: z.union([z.number(), z.string()]).nullish(),
  planUsage: z
    .object({
      totalPercentUsed: percent,
      autoPercentUsed: percent,
      apiPercentUsed: percent
    })
    .nullish()
})
const epochMillis = z.union([z.string(), z.number()]).nullish()
const planInfo = z.object({
  isMerged: z.boolean().optional(),
  planInfo: z
    .object({
      includedUsagePeriod: z.union([z.string(), z.number()]).optional(),
      includedUsageResetsAt: epochMillis
    })
    .optional()
})

export async function readCursorSdkLoginKey(path: string, signal: AbortSignal): Promise<string | undefined> {
  let file: string
  try {
    file = await readFile(path, { encoding: 'utf8', signal })
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
  try {
    const login = sdkLogin.safeParse(JSON.parse(file))
    if (
      login.success &&
      login.data.backendUrl.replace(/\/+$/, '') === cursorBackend() &&
      (login.data.apiKeyExpiresAtMs ?? Infinity) > Date.now()
    )
      return login.data.apiKey
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
  }
}

export async function readCursorSubscriptionUsage(
  readKey: () => Promise<string | undefined>,
  signal: AbortSignal
): Promise<SubscriptionUsageResult> {
  if (cursorBackend() !== backend) return { status: 'unsupported' }

  const request = (path: string, token: string) =>
    fetch(backend + path, {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'X-Cursor-Client-Type': 'sdk'
      },
      body: '{}',
      signal
    })

  try {
    const key = await readKey()
    if (!key) return { status: 'signed-out' }
    const exchange = await request('/auth/exchange_user_api_key', key)
    if (exchange.status === 401) return { status: 'signed-out' }
    if (exchange.status === 403) return { status: 'unsupported' }
    if (!exchange.ok) return { status: 'unavailable' }
    const { accessToken } = exchangeResult.parse(await exchange.json())
    const [usage, info] = await Promise.all([
      request('/aiserver.v1.DashboardService/GetCurrentPeriodUsage', accessToken),
      request('/aiserver.v1.DashboardService/GetPlanInfo', accessToken)
        .then(async (response) => (response.ok ? planInfo.safeParse(await response.json()).data : undefined))
        .catch(() => undefined)
    ])
    if ([403, 404, 501].includes(usage.status)) return { status: 'unsupported' }
    if (!usage.ok) return { status: 'unavailable' }
    const { planUsage, billingCycleEnd } = periodUsage.parse(await usage.json())
    if ((await readKey()) !== key) return { status: 'unavailable' }
    signal.throwIfAborted()

    const reset = Number(info?.planInfo?.includedUsageResetsAt ?? billingCycleEnd)
    const resetsAt = reset > 0 && Number.isFinite(new Date(reset).valueOf()) ? reset : undefined
    const period = info?.planInfo?.includedUsagePeriod
    const weekly = period === 2 || period === 'WEEKLY' || period === 'INCLUDED_USAGE_PERIOD_WEEKLY'
    const windows =
      info && !info.isMerged && !weekly
        ? [
            { id: 'cursor-models', label: 'Cursor Models', usedPercent: planUsage?.autoPercentUsed },
            { id: 'other-models', label: 'Other Models', usedPercent: planUsage?.apiPercentUsed }
          ].flatMap(({ id, label, usedPercent }) =>
            usedPercent == null ? [] : [{ id, label, usedRatio: usedPercent / 100, resetsAt }]
          )
        : []
    if (windows.length) return { status: 'available', readAt: Date.now(), windows }
    if (planUsage?.totalPercentUsed == null) return { status: 'unsupported' }
    return {
      status: 'available',
      readAt: Date.now(),
      windows: [
        {
          id: 'included',
          label: 'Cursor',
          groupLabel: weekly ? 'Cursor' : undefined,
          durationMinutes: weekly ? 7 * 24 * 60 : undefined,
          usedRatio: planUsage.totalPercentUsed / 100,
          resetsAt
        }
      ]
    }
  } catch {
    signal.throwIfAborted()
    return { status: 'unavailable' }
  }
}
