import * as z from 'zod'

import { acpSubscriptionUsageFailure, type AcpSubscriptionUsageReader } from '@cherrystudio/agent-runtime-acp/v1'

const capability = z.object({ version: z.literal(1), method: z.literal('_glm/usage') })
const usage = z.object({
  version: z.literal(1),
  checkedAt: z.string(),
  windows: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      usedPercent: z.number().nonnegative(),
      windowDurationMins: z.number().positive().optional(),
      resetsAt: z.string().optional()
    })
  ),
  unavailable: z.object({ reason: z.string() }).optional()
})

export const readGlmSubscriptionUsage: AcpSubscriptionUsageReader = async (agent, initialized) => {
  if (!capability.safeParse(initialized.agentCapabilities?._meta?.['glm-acp-agent/usage']).success)
    return { status: 'unsupported' }
  try {
    const report = usage.parse(await agent.request('_glm/usage', {}))
    if (report.unavailable) {
      const { reason } = report.unavailable
      if (reason === 'missingCredentials' || reason === 'authenticationFailed') return { status: 'signed-out' }
      if (reason === 'unsupportedEndpoint') return { status: 'unsupported' }
      return { status: 'unavailable' }
    }
    const readAt = Date.parse(report.checkedAt)
    if (!report.windows.length || !Number.isFinite(readAt)) return { status: 'unavailable' }
    return {
      status: 'available',
      readAt,
      windows: report.windows.map(({ id, label, usedPercent, windowDurationMins, resetsAt }) => {
        const end = Date.parse(resetsAt ?? '')
        return {
          id,
          label,
          usedRatio: usedPercent / 100,
          durationMinutes: windowDurationMins,
          resetsAt: Number.isFinite(end) ? end : undefined
        }
      })
    }
  } catch (error) {
    return acpSubscriptionUsageFailure(error)
  }
}
