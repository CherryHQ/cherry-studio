import * as z from 'zod'

import type { AcpHarnessAdapter } from '@cherrystudio/agent-runtime-acp/v1'

const XaiSessionUpdateSchema = z.object({
  sessionId: z.string(),
  update: z
    .object({
      sessionUpdate: z.string(),
      usage: z
        .object({
          inputTokens: z.number(),
          outputTokens: z.number(),
          totalTokens: z.number(),
          cachedReadTokens: z.number().nullish(),
          cachedWriteTokens: z.number().nullish(),
          cacheCreationTokens: z.number().nullish(),
          thoughtTokens: z.number().nullish(),
          reasoningTokens: z.number().nullish()
        })
        .optional()
    })
    .passthrough()
})
export const grokAcpAdapter: Required<Pick<AcpHarnessAdapter, 'register'>> = {
  register(host) {
    host.onNotification('_x.ai/session/update', XaiSessionUpdateSchema, (params) => {
      if (!host.isActiveSession(params.sessionId)) return
      if (params.update.sessionUpdate !== 'turn_completed' || !params.update.usage) return
      const usage = params.update.usage
      const cachedWriteTokens = usage.cachedWriteTokens ?? usage.cacheCreationTokens
      const thoughtTokens = usage.thoughtTokens ?? usage.reasoningTokens
      host.usage({
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        ...(usage.cachedReadTokens != null ? { cachedReadTokens: usage.cachedReadTokens } : {}),
        ...(cachedWriteTokens != null ? { cachedWriteTokens } : {}),
        ...(thoughtTokens != null ? { thoughtTokens } : {})
      })
    })
  }
}
