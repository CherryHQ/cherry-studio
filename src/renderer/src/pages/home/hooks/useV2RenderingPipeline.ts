/**
 * V2 chat rendering pipeline.
 *
 * Projects DB-backed `uiMessages` into renderer `Message[]` and layers
 * per-execution streaming parts on top of the static `partsMap`. Lives
 * apart from `V2ChatContent.tsx` because these memos have nothing to do
 * with mutations / send flow — keeping them separate means each file
 * reads as "one concern".
 *
 * Ownership:
 *   - `uiMessages` — input (DB truth from `useTopicMessagesV2`)
 *   - `activeExecutionIds` — input (SharedCache from `useChatWithHistory`)
 *   - `executionMessagesById` — local state populated by mounted
 *     `ExecutionStreamCollector` components via the returned handlers
 *   - `projectedMessages` / `mergedPartsMap` — outputs consumed by
 *     `Messages` / `PartsProvider`
 */
import { useExecutionMessages } from '@renderer/hooks/useExecutionMessages'
import type { Assistant, Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import type { CherryMessagePart, CherryUIMessage, ModelSnapshot } from '@shared/data/types/message'
import { useMemo } from 'react'

import { uiToMessage } from '../uiToMessage'

export interface V2RenderingPipeline {
  projectedMessages: Message[]
  mergedPartsMap: Record<string, CherryMessagePart[]>
  handleExecutionMessagesChange: (executionId: string, messages: CherryUIMessage[]) => void
  handleExecutionDispose: (executionId: string) => void
}

export function useV2RenderingPipeline(
  uiMessages: CherryUIMessage[],
  activeExecutionIds: readonly string[],
  assistant: Assistant,
  topic: Topic
): V2RenderingPipeline {
  const fallbackSnapshot = useMemo<ModelSnapshot | undefined>(
    () =>
      assistant.model
        ? {
            id: assistant.model.id,
            name: assistant.model.name,
            provider: assistant.model.provider,
            ...(assistant.model.group && { group: assistant.model.group })
          }
        : undefined,
    [assistant.model]
  )

  const lastUserIdInBase = useMemo(() => {
    for (let i = uiMessages.length - 1; i >= 0; i--) {
      if (uiMessages[i].role === 'user') return uiMessages[i].id
    }
    return undefined
  }, [uiMessages])

  const projectedMessages = useMemo<Message[]>(
    () =>
      uiMessages.map((m) =>
        uiToMessage(m, {
          assistantId: assistant.id,
          topicId: topic.id,
          askIdFallback: lastUserIdInBase,
          modelFallback: fallbackSnapshot
        })
      ),
    [uiMessages, assistant.id, topic.id, lastUserIdInBase, fallbackSnapshot]
  )

  const basePartsMap = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const map: Record<string, CherryMessagePart[]> = {}
    for (const m of uiMessages) map[m.id] = (m.parts ?? []) as CherryMessagePart[]
    return map
  }, [uiMessages])

  // Per-execution streaming overlay. Each mounted `ExecutionStreamCollector`
  // pushes its `messages` here; ids match DB placeholder ids directly
  // (Main tags every chunk with the execution's modelId), so `mergedPartsMap`
  // overlays by id.
  const { executionMessagesById, handleExecutionMessagesChange, handleExecutionDispose } =
    useExecutionMessages(activeExecutionIds)

  const mergedPartsMap = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const next = { ...basePartsMap }
    for (const execMessages of Object.values(executionMessagesById)) {
      for (const uiMessage of execMessages) {
        if (uiMessage.role === 'assistant' && uiMessage.parts?.length) {
          next[uiMessage.id] = uiMessage.parts as CherryMessagePart[]
        }
      }
    }
    return next
  }, [basePartsMap, executionMessagesById])

  return {
    projectedMessages,
    mergedPartsMap,
    handleExecutionMessagesChange,
    handleExecutionDispose
  }
}
