import { stripVTControlCharacters } from 'node:util'

import type { SubscriptionUsageResult } from '@cherrystudio/agent-runtime'
import { runUsageCommand, type LaunchSpec, type SpawnStdio } from '@cherrystudio/agent-runtime/stdio'

export async function readAmpSubscriptionUsage(
  launch: LaunchSpec,
  spawn: SpawnStdio,
  signal: AbortSignal
): Promise<SubscriptionUsageResult> {
  const output = await runUsageCommand(
    { ...launch, args: ['usage'], env: { ...launch.env, NO_COLOR: '1' } },
    spawn,
    signal
  )
  if (!output.ok)
    return /not logged in|not signed in|run amp login/i.test(output.stdout + output.stderr)
      ? { status: 'signed-out' }
      : { status: 'unavailable' }
  const text = stripVTControlCharacters(output.stdout)
  const windows = [...text.matchAll(/^([^:\r\n]+):\s+\$([\d.,]+)\/\$([\d.,]+) remaining\b/gm)].flatMap(
    ([, label, remaining, limit]) => {
      const dollars = Number(limit.replaceAll(',', ''))
      const left = Number(remaining.replaceAll(',', ''))
      return dollars > 0 && Number.isFinite(left) && left <= dollars
        ? [{ id: label.trim(), label: label.trim(), usedRatio: 1 - left / dollars }]
        : []
    }
  )
  const balances = [...text.matchAll(/^([^:\r\n]+):\s+\$([\d.,]+) remaining\b/gm)].flatMap(([, label, amount]) => {
    const balance = Number(amount.replaceAll(',', ''))
    return Number.isFinite(balance) ? [{ id: label.trim(), label: label.trim(), amount: balance, currency: 'USD' }] : []
  })
  return windows.length || balances.length
    ? { status: 'available', readAt: Date.now(), windows, balances }
    : { status: 'unavailable' }
}
