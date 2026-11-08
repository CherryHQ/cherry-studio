import { useState } from 'react'

import type { ActiveExecution } from '@shared/ai/transport'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

export function useAgentSteerPresentation({
  topicId,
  messages,
  partsByMessageId,
  activeExecutions
}: {
  topicId: string
  messages: CherryUIMessage[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  activeExecutions: readonly ActiveExecution[]
}): Record<string, CherryMessagePart[]> {
  const [held, setHeld] = useState<{ topicId: string; parts: Record<string, CherryMessagePart[]> }>({
    topicId,
    parts: {}
  })
  const previous = held.topicId === topicId ? held.parts : {}
  let next = previous
  const activeIds = new Set(activeExecutions.map((execution) => execution.anchorMessageId))
  const precedingIds = new Set<string>()
  let hasLaterInput = false
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'user') hasLaterInput = true
    if (message.role !== 'assistant' || !hasLaterInput || !activeIds.has(message.id)) continue
    precedingIds.add(message.id)
    if (previous[message.id]) continue
    if (next === previous) next = { ...previous }
    next[message.id] = (partsByMessageId[message.id] ?? message.parts).map((part) =>
      part.type === 'text' || part.type === 'reasoning' ? { ...part, state: 'done' } : { ...part }
    )
  }
  for (const id of Object.keys(previous)) {
    if (precedingIds.has(id)) continue
    if (next === previous) next = { ...previous }
    delete next[id]
  }
  if (held.topicId !== topicId || next !== previous) setHeld({ topicId, parts: next })
  return next
}
