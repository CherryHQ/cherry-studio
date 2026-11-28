import * as z from 'zod'

import type { SubscriptionUsageResult } from '@cherrystudio/agent-runtime'
import { runUsageCommand, type LaunchSpec, type SpawnStdio } from '@cherrystudio/agent-runtime/stdio'

const credentials = z.array(
  z.object({
    integrationID: z.string(),
    active: z.boolean(),
    value: z.object({ type: z.string(), key: z.string().min(1).optional() })
  })
)
const meter = z.object({ percent: z.number().min(0).max(100), resetsAt: z.string() })
const usage = z.object({ usage: z.object({ rolling: meter, weekly: meter, monthly: meter }) })

export async function readOpenCodeGoSubscriptionUsage(
  launch: LaunchSpec & { readonly model?: string },
  spawn: SpawnStdio,
  signal: AbortSignal
): Promise<SubscriptionUsageResult> {
  if (!launch.model?.startsWith('opencode-go/')) return { status: 'unsupported' }
  const listed = await runUsageCommand(
    { ...launch, args: ['--standalone', 'auth', 'list', '--format', 'json'] },
    spawn,
    signal
  )
  if (!listed.ok) return { status: 'unsupported' }
  const integrations = z.array(z.object({ id: z.string() })).parse(JSON.parse(listed.stdout))
  const id =
    integrations.find(({ id }) => id === 'opencode-go')?.id ?? integrations.find(({ id }) => id === 'opencode')?.id
  if (!id) return { status: 'signed-out' }
  const exported = await runUsageCommand({ ...launch, args: ['--standalone', 'auth', 'export', id] }, spawn, signal)
  if (!exported.ok) return { status: 'unsupported' }
  const account = credentials
    .parse(JSON.parse(exported.stdout))
    .find((entry) => entry.active && entry.integrationID === id)
  const key = account?.value.type === 'key' ? account.value.key : undefined
  if (!key || (launch.env.OPENCODE_API_KEY && launch.env.OPENCODE_API_KEY !== key)) return { status: 'unsupported' }

  const response = await fetch('https://opencode.ai/inference/go/v1/usage', {
    signal,
    redirect: 'error',
    headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' }
  })
  if (response.status === 401) return { status: 'signed-out' }
  if (response.status === 403 || response.status === 404) return { status: 'unsupported' }
  if (!response.ok) return { status: 'unavailable' }
  const data = usage.parse(await response.json()).usage
  return {
    status: 'available',
    readAt: Date.now(),
    windows: Object.entries(data).map(([id, window]) => {
      const end = Date.parse(window.resetsAt)
      return {
        id,
        label: 'OpenCode Go',
        usedRatio: window.percent / 100,
        durationMinutes: id === 'rolling' ? 300 : id === 'weekly' ? 7 * 1440 : undefined,
        resetsAt: Number.isFinite(end) ? end : undefined
      }
    })
  }
}
