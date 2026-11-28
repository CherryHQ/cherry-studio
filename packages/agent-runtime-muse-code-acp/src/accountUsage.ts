import * as z from 'zod'

import type { SubscriptionUsageResult, SubscriptionUsageWindow } from '@cherrystudio/agent-runtime'
import { type LaunchSpec, runUsageCommand, type SpawnStdio } from '@cherrystudio/agent-runtime/stdio'

const windowSchema = z.object({
  usedPercent: z.number().min(0).max(100),
  resetsAtMs: z.number().int().positive().nullish()
})
const usageSchema = z.object({
  schemaVersion: z.literal(1),
  allowance: z
    .object({
      tier: z.string().nullish(),
      asOfMs: z.number().int().positive().nullish(),
      window: windowSchema.nullish(),
      weekly: windowSchema.nullish()
    })
    .nullish(),
  reason: z.string().nullish()
})

export async function readMuseSubscriptionUsage(
  launch: LaunchSpec,
  spawn: SpawnStdio,
  signal: AbortSignal
): Promise<SubscriptionUsageResult> {
  if (launch.env.META_API_KEY?.trim()) return { status: 'unsupported' }
  const version = await runUsageCommand({ ...launch, args: ['--version'] }, spawn, signal)
  const semver = /^Muse Code\s+(\d+)\.(\d+)\.(\d+)\b/im.exec(version.stdout)
  if (!version.ok || !semver) return { status: 'unavailable' }
  const [, major, minor, patch] = semver.map(Number)
  // Older versions can interpret an unknown subcommand as a prompt.
  if (major < 1 || (major === 1 && (minor < 4 || (minor === 4 && patch < 13)))) return { status: 'unsupported' }

  const reply = await runUsageCommand({ ...launch, args: ['usage', '--json'] }, spawn, signal)
  if (!reply.ok && /not logged in|please log in/i.test(reply.stderr + reply.stdout)) return { status: 'signed-out' }
  const parsed = usageSchema.safeParse(parseUsageJson(reply.stdout))
  if (!parsed.success) return { status: 'unavailable' }
  const { allowance, reason } = parsed.data
  if (reason === 'not-logged-in') return { status: 'signed-out' }
  if (reason === 'no-subscription') return { status: 'unsupported' }
  if (!reply.ok || !allowance) return { status: 'unavailable' }
  const windows: SubscriptionUsageWindow[] = []
  const groupLabel = allowance.tier?.trim() || 'Muse Code'
  for (const [id, value, durationMinutes] of [
    ['session', allowance.window, 300],
    ['weekly', allowance.weekly, 10080]
  ] as const) {
    if (value) {
      windows.push({
        id,
        label: id === 'weekly' ? 'Weekly' : 'Session',
        groupLabel,
        usedRatio: value.usedPercent / 100,
        durationMinutes,
        resetsAt: value.resetsAtMs ?? undefined
      })
    }
  }
  return windows.length
    ? { status: 'available', windows, readAt: allowance.asOfMs ?? Date.now() }
    : { status: 'unavailable' }
}

function parseUsageJson(output: string): unknown {
  try {
    return JSON.parse(output)
  } catch {
    return undefined
  }
}
