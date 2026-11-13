import type { Usage } from '@earendil-works/pi-ai'

import type { MessageStats } from '@shared/data/types/message'

export class PiTurnUsage {
  private inputTokens = 0
  private outputTokens = 0
  private totalTokens = 0
  private reasoningTokens: number | undefined

  reset(): void {
    this.inputTokens = 0
    this.outputTokens = 0
    this.totalTokens = 0
    this.reasoningTokens = undefined
  }

  record(usage: Usage): { totalTokens: number; stats: MessageStats } {
    this.inputTokens += usage.input + usage.cacheRead + usage.cacheWrite
    this.outputTokens += usage.output
    this.totalTokens += usage.totalTokens
    if (usage.reasoning !== undefined) this.reasoningTokens = (this.reasoningTokens ?? 0) + usage.reasoning
    return {
      totalTokens: this.totalTokens,
      stats: {
        inputTokens: this.inputTokens,
        outputTokens: this.outputTokens,
        totalTokens: this.totalTokens,
        ...(this.reasoningTokens === undefined ? {} : { outputTokenDetails: { reasoningTokens: this.reasoningTokens } })
      }
    }
  }
}
