import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { type Topic } from '@renderer/types'
import type { CherryMessagePart } from '@shared/data/types/message'
import { createContext, use, useCallback } from 'react'

/** AI SDK useChat status — V2 single source of truth for request state. */
export type RequestStatus = 'submitted' | 'streaming' | 'ready' | 'error'

/**
 * V2 chat overrides injected via React Context.
 * Operations delegate to DataApi + useAiChat.
 */
export interface V2ChatOverrides {
  regenerate: (messageId?: string) => Promise<void>
  resend: (messageId?: string) => Promise<void>
  deleteMessage: (id: string) => Promise<void>
  deleteMessageGroup: (id: string) => Promise<void>
  pause: () => void
  clearTopicMessages: () => Promise<void>
  editMessage: (messageId: string, editedParts: CherryMessagePart[]) => Promise<void>
  requestStatus: RequestStatus
  refresh: () => Promise<unknown>
}

/**
 * Context that carries the write side of V2 chat state down the tree.
 * Exported so the per-message `useMessage` hook can read it directly
 * without going through this file's dynamic-id convenience wrappers.
 */
export const V2ChatOverridesContext = createContext<V2ChatOverrides | null>(null)

export const V2ChatOverridesProvider = V2ChatOverridesContext.Provider

const DEFAULT_DISPLAY_COUNT = 10

/**
 * Topic-level message operations (+ dynamic-id action wrappers for consumers
 * that can't bind a single message up-front).
 *
 * Per-message bound operations live in {@link useMessage}. Prefer that one
 * whenever the caller already has a stable `message.id` for the whole
 * render — it keeps the wiring colocated with the message in question.
 * The methods here remain for:
 *   - Topic-scoped actions (`clearTopicMessages`, `pauseMessages`,
 *     `createNewContext`, `deleteGroupMessages`, `displayCount`).
 *   - Dynamic-id actions (`deleteMessage`, `regenerateMessageById`) called
 *     by multi-select flows (`useChatContext`) and group iterations
 *     (`MessageGroupMenuBar`) where hook-per-id isn't viable.
 */
export function useMessageOperations(topic: Topic) {
  const v2 = use(V2ChatOverridesContext)

  const deleteMessage = useCallback(
    async (id: string, traceId?: string, modelName?: string) => {
      await v2?.deleteMessage(id)
      void window.api.trace.cleanHistory(topic.id, traceId || '', modelName)
    },
    [topic.id, v2]
  )

  const deleteGroupMessages = useCallback(
    async (askId: string) => {
      await v2?.deleteMessageGroup(askId)
    },
    [v2]
  )

  const regenerateMessageById = useCallback(
    async (messageId: string) => {
      await v2?.regenerate(messageId)
    },
    [v2]
  )

  const clearTopicMessages = useCallback(async () => {
    await v2?.clearTopicMessages()
  }, [v2])

  const createNewContext = useCallback(async () => {
    void EventEmitter.emit(EVENT_NAMES.NEW_CONTEXT)
  }, [])

  const pauseMessages = useCallback(() => {
    v2?.pause()
  }, [v2])

  return {
    displayCount: DEFAULT_DISPLAY_COUNT,
    deleteMessage,
    deleteGroupMessages,
    regenerateMessageById,
    clearTopicMessages,
    createNewContext,
    pauseMessages
  }
}

export const useTopicLoading = (): boolean => {
  const v2 = use(V2ChatOverridesContext)
  if (!v2) return false
  return v2.requestStatus === 'submitted' || v2.requestStatus === 'streaming'
}

export const useRequestStatus = (): RequestStatus | undefined => {
  const v2 = use(V2ChatOverridesContext)
  return v2?.requestStatus
}
