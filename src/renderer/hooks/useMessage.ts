import { cacheService } from '@data/CacheService'
import { loggerService } from '@logger'
import { usePartsMap } from '@renderer/components/chat/messages/blocks/MessagePartsContext'
import { type Topic, type TranslateLangCode } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import type { CherryMessagePart, ModelSnapshot } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { useCallback } from 'react'

import { useChatWrite } from './ChatWriteContext'

const logger = loggerService.withContext('useMessage')

/**
 * Per-message bound operations.
 *
 * Consumers that already hold a stable `message.id` for the whole render
 * (MessageMenuBar, Message, etc.) should reach for this hook; topic-level
 * and dynamic-id callers (multi-select delete, group iteration) read
 * `useChatWrite()` directly.
 *
 * All write operations delegate into the chat write context (owned by
 * `ChatContent`), so they pick up the optimistic SWR cache overlay and
 * refresh-failure isolation that hook wires up.
 */
export function useMessage(messageId: string, topic: Topic) {
  const chatWrite = useChatWrite()
  const partsMap = usePartsMap()

  // `ChatContent.handleDeleteMessage` handles span-cache cleanup
  // internally; callers that have `traceId` / `modelName` on hand (e.g.
  // `MessageMenuBar` reading them off the assistant message) forward
  // them via the optional second argument.
  const remove = useCallback(
    async (traceId?: string, modelName?: string) => {
      await chatWrite?.deleteMessage(messageId, { traceId, modelName })
    },
    [chatWrite, messageId]
  )

  const regenerate = useCallback(async () => {
    await chatWrite?.regenerate(messageId)
  }, [chatWrite, messageId])

  /**
   * Regenerate this assistant turn using a different model, producing a new
   * sibling in the existing group for side-by-side comparison. Wired to the
   * `@` (mention model) button on assistant messages. Accepts an optional
   * `modelSnapshot` so the optimistic placeholder can render with the right
   * avatar + name before Main's persisted row lands.
   */
  const regenerateWithModel = useCallback(
    async (modelId: UniqueModelId, modelSnapshot?: ModelSnapshot) => {
      await chatWrite?.regenerate(messageId, { modelId, modelSnapshot })
    },
    [chatWrite, messageId]
  )

  const resend = useCallback(async () => {
    await chatWrite?.resend(messageId)
  }, [chatWrite, messageId])

  const editParts = useCallback(
    async (parts: CherryMessagePart[]) => {
      await chatWrite?.editMessage(messageId, parts)
    },
    [chatWrite, messageId]
  )

  const forkAndResend = useCallback(
    async (parts: CherryMessagePart[]) => {
      await chatWrite?.forkAndResend(messageId, parts)
    },
    [chatWrite, messageId]
  )

  /**
   * Start a new branch at this message: pin it as the topic's active node
   * (no `descend`) so the scroll view truncates here and the user's next
   * input forks the tree. Stays inside the current topic — no new topic
   * is created.
   */
  const startBranch = useCallback(async () => {
    await chatWrite?.setActiveNode(messageId)
  }, [chatWrite, messageId])

  /**
   * Initiates translation and returns an updater function.
   * TODO: Move translation persistence to Main side (dedicated IPC endpoint).
   * Currently Renderer reads parts + patches via DataApi as a transitional approach.
   */
  const getTranslationUpdater = useCallback(
    async (
      targetLanguage: TranslateLangCode,
      sourceLanguage?: TranslateLangCode
    ): Promise<((accumulatedText: string, isComplete?: boolean) => void) | null> => {
      if (!topic.id || !chatWrite) return null

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
      await chatWrite.editMessage(messageId, [...baseParts, loadingPart as CherryMessagePart])

      return (accumulatedText: string, _isComplete: boolean = false) => {
        const translationPart = {
          type: 'data-translation' as const,
          data: {
            content: accumulatedText,
            targetLanguage,
            ...(sourceLanguage && { sourceLanguage })
          }
        }

        void chatWrite.editMessage(messageId, [...baseParts, translationPart as CherryMessagePart])
      }
    },
    [chatWrite, messageId, partsMap, topic.id]
  )

  return {
    remove,
    regenerate,
    regenerateWithModel,
    resend,
    editParts,
    forkAndResend,
    startBranch,
    getTranslationUpdater
  }
}

/**
 * Update per-message UI state (`foldSelected`, `multiModelMessageStyle`,
 * `useful`). Stored in Cache — transient display preferences, not persisted
 * to DB.
 *
 * Not a hook: callers frequently update UI state for multiple messages in
 * one callback (e.g. `MessageGroup` switching foldSelected across siblings),
 * which a per-id hook binding can't express. The underlying cacheService is
 * a singleton so a plain function is all that's needed.
 */
export function updateMessageUiState(
  messageId: string,
  updates: Partial<Omit<Message, 'id' | 'topicId' | 'blocks'>>
): void {
  const cacheKey = `message.ui.${messageId}` as const
  const current = cacheService.get(cacheKey) || {}
  cacheService.set(cacheKey, { ...current, ...updates })
}
