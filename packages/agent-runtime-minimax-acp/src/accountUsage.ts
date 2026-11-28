import * as z from 'zod'

import type { SubscriptionUsageResult, SubscriptionUsageWindow } from '@cherrystudio/agent-runtime'

const apiSettings = z.object({ apiKey: z.string().trim().min(1), baseURL: z.string().trim().optional() })
const configSchema = z.object({
  minimaxModelSource: z.string().optional(),
  minimax_api: apiSettings.optional(),
  provider: z.object({ minimax_api: z.object({ options: apiSettings }).optional() }).optional()
})
const remainingPercent = z.number().min(0).max(100).nullish()
const bucketSchema = z.object({
  model_name: z.string(),
  current_interval_remaining_percent: remainingPercent,
  current_weekly_remaining_percent: remainingPercent,
  current_interval_status: z.number().optional(),
  current_weekly_status: z.number().optional(),
  end_time: z.number().nonnegative().nullish(),
  weekly_end_time: z.number().nonnegative().nullish(),
  remains_time: z.number().nonnegative().nullish(),
  weekly_remains_time: z.number().nonnegative().nullish()
})
const quotaSchema = z.object({
  base_resp: z.object({ status_code: z.number() }).optional(),
  model_remains: z.array(bucketSchema).optional()
})

function identity(config: unknown, provider: string, region?: string) {
  const parsed = configSchema.safeParse(config)
  if (!parsed.success) return
  if (provider === 'minimax' && parsed.data.minimaxModelSource !== 'minimax_api_key') return
  const options = parsed.data.minimax_api ?? parsed.data.provider?.minimax_api?.options
  if (!options) return
  const base = options.baseURL?.replace(/\/+$/, '')
  const site = !base
    ? region === 'cn'
      ? 'www.minimaxi.com'
      : 'www.minimax.io'
    : base === 'https://api.minimaxi.com/anthropic'
      ? 'www.minimaxi.com'
      : base === 'https://api.minimax.io/anthropic'
        ? 'www.minimax.io'
        : undefined
  if (site) return { apiKey: options.apiKey, site }
}

export async function readMiniMaxSubscriptionUsage(
  model: string | undefined,
  region: string | undefined,
  readConfig: () => Promise<unknown>,
  signal: AbortSignal
): Promise<SubscriptionUsageResult> {
  signal.throwIfAborted()
  const modelId = /^(?:m:(minimax(?:_api)?):([^:]+):v:.*|(minimax(?:_api)?)\/([^/]+))$/.exec(model ?? '')
  if (!modelId) return { status: 'unsupported' }
  const provider = modelId[1] ?? modelId[3]
  const credentials = identity(await readConfig(), provider, region)
  if (!credentials) return { status: 'unsupported' }
  const response = await fetch(`https://${credentials.site}/v1/token_plan/remains`, {
    headers: { Authorization: `Bearer ${credentials.apiKey}`, 'Content-Type': 'application/json' },
    redirect: 'error',
    signal
  })
  if (response.status === 401 || response.status === 403) return { status: 'unsupported' }
  if (!response.ok) return { status: 'unavailable' }
  const parsed = quotaSchema.safeParse(await response.json())
  const current = identity(await readConfig(), provider, region)
  if (current?.apiKey !== credentials.apiKey || current.site !== credentials.site) return { status: 'unavailable' }
  if (!parsed.success || (parsed.data.base_resp && parsed.data.base_resp.status_code !== 0))
    return { status: 'unavailable' }
  const buckets = parsed.data.model_remains
  const name = decodeURIComponent(modelId[2] ?? modelId[4]).toLowerCase()
  const bucket =
    buckets?.find(({ model_name }) => model_name.toLowerCase() === name) ??
    buckets?.find(({ model_name }) => model_name.toLowerCase() === 'general')
  if (!bucket) return { status: 'unsupported' }
  const windows: SubscriptionUsageWindow[] = []
  const readAt = Date.now()
  for (const [id, remaining, status, end, remains, durationMinutes] of [
    [
      'interval',
      bucket.current_interval_remaining_percent,
      bucket.current_interval_status,
      bucket.end_time,
      bucket.remains_time,
      300
    ],
    [
      'weekly',
      bucket.current_weekly_remaining_percent,
      bucket.current_weekly_status,
      bucket.weekly_end_time,
      bucket.weekly_remains_time,
      10080
    ]
  ] as const) {
    if (remaining == null || status === 3) continue
    windows.push({
      id,
      label: id === 'weekly' ? 'Weekly' : 'Session',
      groupLabel: 'MiniMax Token Plan',
      usedRatio: 1 - remaining / 100,
      durationMinutes,
      resetsAt: end ? (end < 1e12 ? end * 1000 : end) : remains != null ? readAt + remains : undefined
    })
  }
  return windows.length ? { status: 'available', windows, readAt } : { status: 'unsupported' }
}
