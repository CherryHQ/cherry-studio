import * as z from 'zod'

import type { SubscriptionUsageResult } from '@cherrystudio/agent-runtime'
import { runUsageCommand, type LaunchSpec, type SpawnStdio } from '@cherrystudio/agent-runtime/stdio'

const usageReply = z.object({
  status: z.literal('SUCCESS'),
  num_turns: z.literal(0).optional(),
  command: z.object({
    name: z.literal('usage'),
    data: z.object({
      groups: z.array(
        z.object({
          name: z.string(),
          buckets: z.array(
            z.object({
              id: z.string().optional(),
              name: z.string(),
              window: z.string().optional(),
              remaining_fraction: z.number().min(0).max(1),
              reset_time: z.string().nullish()
            })
          )
        })
      )
    })
  })
})

export async function readAntigravitySubscriptionUsage(
  launch: LaunchSpec,
  spawn: SpawnStdio,
  signal: AbortSignal
): Promise<SubscriptionUsageResult> {
  const env = launch.env
  if (
    env.GEMINI_API_KEY ||
    env.GOOGLE_API_KEY ||
    env.GOOGLE_APPLICATION_CREDENTIALS ||
    env.GOOGLE_CLOUD_PROJECT ||
    env.GEMINI_HOME
  )
    return { status: 'unsupported' }

  const version = await runUsageCommand({ ...launch, args: ['--version'] }, spawn, signal)
  const match = /(?:^|\s)v?(\d+)\.(\d+)\.(\d+)(?:\s|$)/.exec(version.stdout + ' ' + version.stderr)
  if (
    !version.ok ||
    !match ||
    Number(match[1]) < 1 ||
    (Number(match[1]) === 1 && Number(match[2]) === 0) ||
    (Number(match[1]) === 1 && Number(match[2]) === 1 && Number(match[3]) < 11)
  )
    return { status: 'unsupported' }

  const models = await runUsageCommand({ ...launch, args: ['models'] }, spawn, signal)
  if (!models.ok) {
    return /please sign in|authentication required/i.test(models.stdout + models.stderr)
      ? { status: 'signed-out' }
      : { status: 'unavailable' }
  }
  const output = await runUsageCommand(
    { ...launch, args: ['--settings', '{"disableSlashCommands":false}', '-p', '/usage', '--output-format', 'json'] },
    spawn,
    signal
  )
  if (!output.ok) return { status: 'unavailable' }
  const parsed = usageReply.safeParse(JSON.parse(output.stdout))
  if (!parsed.success) return { status: 'unavailable' }
  const windows = parsed.data.command.data.groups.flatMap((group, groupIndex) =>
    group.buckets.map((bucket, index) => {
      const end = Date.parse(bucket.reset_time ?? '')
      return {
        id: groupIndex + ':' + (bucket.id ?? index),
        label: bucket.name.replace(/\s+remaining$/i, ''),
        groupLabel: group.name,
        usedRatio: 1 - bucket.remaining_fraction,
        durationMinutes: bucket.window === '5h' ? 300 : bucket.window === 'weekly' ? 7 * 1440 : undefined,
        resetsAt: end > 0 ? end : undefined
      }
    })
  )
  return windows.length ? { status: 'available', readAt: Date.now(), windows } : { status: 'unavailable' }
}
