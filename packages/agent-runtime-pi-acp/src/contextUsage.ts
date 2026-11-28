import type { ClientConnection, PromptResponse } from '@agentclientprotocol/sdk'
import * as z from 'zod'

import type { OperationResult, ThreadContextUsage } from '@cherrystudio/agent-runtime'

const capability = z.object({ piAcp: z.object({ contextUsage: z.literal(1) }) })
const tokens = z.number().int().nonnegative()
const contextWindow = z.number().int().positive()
const promptMetadata = z.object({
  piAcp: z.object({ lastRequest: z.object({ model: z.string(), tokens, contextWindow }) })
})
const currentContext = z.object({ contextUsage: z.object({ tokens: tokens.nullable(), contextWindow }).nullable() })

export function bindPiContextUsage(
  metadata: unknown,
  agent: Pick<ClientConnection['agent'], 'request'>,
  sessionId: string,
  currentModel: () => string | undefined
) {
  if (!capability.safeParse(metadata).success) return undefined
  return {
    promptMeta: { piAcp: { reportLastRequest: true } },
    contextAfterPrompt(response: PromptResponse, revision: string): ThreadContextUsage | undefined {
      const parsed = promptMetadata.safeParse(response._meta)
      if (!parsed.success) return
      const reading = parsed.data.piAcp.lastRequest
      if (reading.model !== currentModel()) return
      return {
        model: reading.model,
        revision,
        contextWindow: reading.contextWindow,
        basis: 'last-request',
        used: { tokens: reading.tokens, precision: 'reported' }
      }
    },
    async inspectContextUsage(): Promise<OperationResult<ThreadContextUsage>> {
      const model = currentModel()
      const result = currentContext.parse(await agent.request('_pi/context_usage', { sessionId }))
      const reading = result.contextUsage
      if (!model || model !== currentModel() || !reading) {
        return {
          status: 'unknown',
          error: {
            operation: 'contextUsage',
            code: 'unavailable',
            message: 'Pi did not report current context usage for this model'
          }
        }
      }
      return {
        status: 'confirmed',
        value: {
          model,
          revision: model,
          contextWindow: reading.contextWindow,
          basis: 'current-context',
          ...(reading.tokens === null ? {} : { used: { tokens: reading.tokens, precision: 'estimated' } })
        }
      }
    }
  }
}
