import { isToolUIPart } from 'ai'
import { useMemo, useState } from 'react'

import type { ActiveExecution } from '@shared/ai/transport'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

interface SteerBoundary {
  userId: string
  parts: CherryMessagePart[]
}

function isUnfinishedTool(part: CherryMessagePart): boolean {
  return (
    isToolUIPart(part) &&
    ((part.state === 'output-available' && part.preliminary === true) ||
      !['output-available', 'output-error', 'output-denied'].includes(part.state))
  )
}

function splitParts(parts: CherryMessagePart[], boundary: CherryMessagePart[]) {
  const before: CherryMessagePart[] = []
  const after: CherryMessagePart[] = []
  parts.forEach((part, index) => {
    const previous = boundary[index]
    if (part.type === 'data-compaction-anchor') {
      before.push(part)
    } else if (!previous || isUnfinishedTool(previous)) {
      after.push(part)
    } else if (
      (part.type === 'text' && previous.type === 'text') ||
      (part.type === 'reasoning' && previous.type === 'reasoning')
    ) {
      before.push({ ...previous, state: 'done' })
      const text = part.text.slice(previous.text.length)
      if (text) after.push({ ...part, text })
    } else {
      before.push(previous)
    }
  })
  return { before, after }
}

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
}) {
  const [held, setHeld] = useState<{ topicId: string; boundaries: Record<string, SteerBoundary> }>({
    topicId,
    boundaries: {}
  })
  const previous = held.topicId === topicId ? held.boundaries : {}
  let next = previous
  const activeIds = useMemo(
    () =>
      new Set(activeExecutions.flatMap((execution) => (execution.anchorMessageId ? [execution.anchorMessageId] : []))),
    [activeExecutions]
  )
  const precedingIds = new Set<string>()
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message.role !== 'assistant') continue
    const following = messages.slice(index + 1)
    const user = following.find((row) => row.role === 'user')
    if (!user || (!activeIds.has(message.id) && !previous[message.id])) continue
    precedingIds.add(message.id)
    // Acknowledgment replaces the optimistic user id, without changing the split point.
    if (previous[message.id]?.userId === user.id) continue
    if (next === previous) next = { ...previous }
    next[message.id] = {
      userId: user.id,
      parts: previous[message.id]?.parts ?? (partsByMessageId[message.id] ?? message.parts).map((part) => ({ ...part }))
    }
  }
  for (const id of Object.keys(previous)) {
    if (precedingIds.has(id)) continue
    if (next === previous) next = { ...previous }
    delete next[id]
  }
  if (held.topicId !== topicId || next !== previous) setHeld({ topicId, boundaries: next })

  return useMemo(() => {
    if (Object.keys(next).length === 0) {
      return {
        messages,
        partsByMessageId,
        heldPartsByMessageId: {},
        sourceMessageIds: {},
        projectedMessageIds: [],
        liveMessageIds: [...activeIds]
      }
    }
    const projectedMessages = [...messages]
    const projectedParts = { ...partsByMessageId }
    const heldPartsByMessageId: Record<string, CherryMessagePart[]> = {}
    const sourceMessageIds: Record<string, string> = {}
    const liveMessageIds = new Set(activeIds)
    const projectedMessageIds = new Set<string>()
    for (const [sourceId, boundary] of Object.entries(next)) {
      const sourceIndex = projectedMessages.findIndex((message) => message.id === sourceId)
      const source = projectedMessages[sourceIndex]
      const userIndex = projectedMessages.findIndex((message) => message.id === boundary.userId)
      if (!source || userIndex < 0) continue
      const { before, after } = splitParts(projectedParts[sourceId] ?? source.parts, boundary.parts)
      projectedMessageIds.add(sourceId)
      heldPartsByMessageId[sourceId] = before
      projectedParts[sourceId] = before
      projectedMessages[sourceIndex] = { ...source, parts: before, metadata: { ...source.metadata, status: 'success' } }
      liveMessageIds.delete(sourceId)

      const successor = projectedMessages[userIndex + 1]
      if (successor?.role === 'assistant') {
        projectedMessageIds.add(successor.id)
        projectedParts[successor.id] = [...after, ...(projectedParts[successor.id] ?? successor.parts)]
      } else if (after.length > 0 || activeIds.has(sourceId) || source.metadata?.status === 'paused') {
        const id = `steer-continuation:${sourceId}:${boundary.userId}`
        projectedMessages.splice(userIndex + 1, 0, {
          ...source,
          id,
          parts: after,
          metadata: {
            ...source.metadata,
            parentId: boundary.userId,
            status: activeIds.has(sourceId) ? 'pending' : source.metadata?.status,
            stats: undefined,
            totalTokens: undefined
          }
        })
        projectedParts[id] = after
        sourceMessageIds[id] = sourceId
        projectedMessageIds.add(id)
        if (activeIds.has(sourceId)) liveMessageIds.add(id)
      }
    }
    return {
      messages: projectedMessages,
      partsByMessageId: projectedParts,
      heldPartsByMessageId,
      sourceMessageIds,
      projectedMessageIds: [...projectedMessageIds],
      liveMessageIds: [...liveMessageIds]
    }
  }, [activeIds, messages, next, partsByMessageId])
}
