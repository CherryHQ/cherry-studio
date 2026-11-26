import { childTimelines } from '@main/ai/agentSession/childTimelines'
import type { AgentChildUpdate } from '@shared/ai/agentChildProjection'

export function childTimeline(owner: string, call: string) {
  const source = childTimelines.source(owner, call)
  if (!source.snapshot()) return undefined
  return {
    snapshot: () => source.snapshot()!,
    subscribe: (listener: (update: AgentChildUpdate) => void) =>
      source.subscribe((update) => {
        if (update.kind === 'child') listener(update)
      })
  }
}
