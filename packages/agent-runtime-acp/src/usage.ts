import type { PromptResponse } from '@agentclientprotocol/sdk'
import * as z from 'zod'

const tokens = z.number().int().nonnegative()
const usageSchema = z.object({
  inputTokens: tokens,
  outputTokens: tokens,
  totalTokens: tokens,
  cachedReadTokens: tokens.nullish(),
  cachedWriteTokens: tokens.nullish(),
  thoughtTokens: tokens.nullish()
})

export type AcpTurnUsage = z.infer<typeof usageSchema>

// Some v1 agents return top-level usage even though the stable SDK omits it from PromptResponse.
export function readPromptUsage(response: PromptResponse): AcpTurnUsage | undefined {
  return 'usage' in response ? usageSchema.safeParse(response.usage).data : undefined
}
