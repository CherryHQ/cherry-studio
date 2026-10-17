import { generateText, tool } from 'ai'
import * as z from 'zod'

import { agentModel } from './environment'

export async function checkAgent() {
  const result = await generateText({
    model: agentModel(),
    prompt: 'Call the ready tool with ready=true.',
    tools: {
      ready: tool({
        description: 'Confirm tool calling is available',
        inputSchema: z.object({ ready: z.literal(true) })
      })
    },
    toolChoice: { type: 'tool', toolName: 'ready' },
    abortSignal: AbortSignal.timeout(30_000),
    maxRetries: 0
  })
  if (
    result.toolCalls[0]?.toolName !== 'ready' ||
    z.object({ ready: z.literal(true) }).safeParse(result.toolCalls[0].input).success !== true
  )
    throw new Error('Model did not produce the required tool call')
  process.stdout.write('Agent API tool calling: passed\n')
  return { modelCalls: 1, modelTokens: result.totalUsage.totalTokens ?? 0 }
}
