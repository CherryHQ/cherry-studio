import { loggerService } from '@logger'
import { usePartsMap } from '@renderer/pages/home/Messages/Blocks/V2Contexts'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { useAppDispatch } from '@renderer/store'
import { cloneMessagesToNewTopicThunk, updateMessageAndBlocksThunk } from '@renderer/store/thunk/messageThunk'
import { type Assistant, type Model, objectKeys, type Topic, type TranslateLanguageCode } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import type { CherryMessagePart } from '@shared/data/types/message'
import { difference } from 'lodash'
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

const V2ChatOverridesContext = createContext<V2ChatOverrides | null>(null)

export const V2ChatOverridesProvider = V2ChatOverridesContext.Provider

const logger = loggerService.withContext('UseMessageOperations')

const DEFAULT_DISPLAY_COUNT = 10

/**
 * Hook providing message operations for a specific topic.
 */
export function useMessageOperations(topic: Topic) {
  const dispatch = useAppDispatch()
  const v2 = use(V2ChatOverridesContext)
  const partsMap = usePartsMap()

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

  /**
   * Update per-message UI state (foldSelected, multiModelMessageStyle, useful).
   * TODO: Migrate to Cache or DataApi — currently uses Redux thunk for compatibility
   * with v2 branch which also stores these in Redux.
   */
  const editMessage = useCallback(
    async (messageId: string, updates: Partial<Omit<Message, 'id' | 'topicId' | 'blocks'>>) => {
      if (!topic?.id) {
        logger.error('[editMessage] Topic prop is not valid.')
        return
      }
      const uiStates = ['multiModelMessageStyle', 'foldSelected'] as const satisfies (keyof Message)[]
      const extraUpdate = difference(objectKeys(updates), uiStates)
      const isUiUpdateOnly = extraUpdate.length === 0
      const messageUpdates: Partial<Message> & Pick<Message, 'id'> = {
        id: messageId,
        updatedAt: isUiUpdateOnly ? undefined : new Date().toISOString(),
        ...updates
      }

      await dispatch(updateMessageAndBlocksThunk(topic.id, messageUpdates, []))
    },
    [dispatch, topic.id]
  )

  const resendMessage = useCallback(
    async (message: Message, _assistant: Assistant) => {
      await v2?.resend(message.id)
    },
    [v2]
  )

  const clearTopicMessages = useCallback(async () => {
    await v2?.clearTopicMessages()
  }, [v2])

  const createNewContext = useCallback(async () => {
    void EventEmitter.emit(EVENT_NAMES.NEW_CONTEXT)
  }, [])

  const displayCount = DEFAULT_DISPLAY_COUNT

  const pauseMessages = useCallback(() => {
    v2?.pause()
  }, [v2])

  const resumeMessage = useCallback(
    async (message: Message, assistant: Assistant) => {
      return resendMessage(message, assistant)
    },
    [resendMessage]
  )

  const regenerateAssistantMessage = useCallback(
    async (message: Message, _assistant: Assistant) => {
      await v2?.regenerate(message.id)
    },
    [v2]
  )

  const appendAssistantResponse = useCallback(
    async (existingAssistantMessage: Message, newModel: Model, _assistant: Assistant) => {
      logger.warn('[appendAssistantResponse] Not yet supported in V2.', {
        topicId: topic.id,
        messageId: existingAssistantMessage.id,
        modelId: newModel.id
      })
    },
    [topic.id]
  )

  /**
   * Initiates translation and returns an updater function.
   * TODO: Move translation persistence to Main side (dedicated IPC endpoint).
   * Currently Renderer reads parts + patches via DataApi as a transitional approach.
   */
  const getTranslationUpdater = useCallback(
    async (
      messageId: string,
      targetLanguage: TranslateLanguageCode,
      sourceLanguage?: TranslateLanguageCode
    ): Promise<((accumulatedText: string, isComplete?: boolean) => void) | null> => {
      if (!topic.id || !v2) return null

      const currentParts = partsMap?.[messageId]
      if (!currentParts) {
        logger.error(`[getTranslationUpdater] cannot find parts for message: ${messageId}`)
        return null
      }

      const baseParts = currentParts.filter((p) => p.type !== 'data-translation')

      // Insert empty translation part to show loading UI
      const loadingPart = {
        type: 'data-translation' as const,
        data: { content: '', targetLanguage, ...(sourceLanguage && { sourceLanguage }) }
      }
      await v2.editMessage(messageId, [...baseParts, loadingPart as CherryMessagePart])

      return (accumulatedText: string, _isComplete: boolean = false) => {
        const translationPart = {
          type: 'data-translation' as const,
          data: {
            content: accumulatedText,
            targetLanguage,
            ...(sourceLanguage && { sourceLanguage })
          }
        }

        void v2.editMessage(messageId, [...baseParts, translationPart as CherryMessagePart])
      }
    },
    [partsMap, topic.id, v2]
  )

  /**
   * TODO: Migrate to DataApi — currently uses Redux thunk for compatibility with v2 branch.
   */
  const createTopicBranch = useCallback(
    (sourceTopicId: string, branchPointIndex: number, newTopic: Topic) => {
      logger.info(`Cloning messages from topic ${sourceTopicId} to new topic ${newTopic.id}`)
      return dispatch(cloneMessagesToNewTopicThunk(sourceTopicId, branchPointIndex, newTopic))
    },
    [dispatch]
  )

  const editMessageParts = useCallback(
    async (messageId: string, editedParts: CherryMessagePart[]) => {
      await v2?.editMessage(messageId, editedParts)
    },
    [v2]
  )

  const resendUserMessageWithEditParts = useCallback(
    async (message: Message, editedParts: CherryMessagePart[]) => {
      await v2?.editMessage(message.id, editedParts)
      await v2?.resend(message.id)
    },
    [v2]
  )

  return {
    displayCount,
    deleteMessage,
    deleteGroupMessages,
    editMessage,
    resendMessage,
    regenerateAssistantMessage,
    appendAssistantResponse,
    createNewContext,
    clearTopicMessages,
    pauseMessages,
    resumeMessage,
    getTranslationUpdater,
    createTopicBranch,
    editMessageParts,
    resendUserMessageWithEditParts
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
