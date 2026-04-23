import { cacheService } from '@data/CacheService'
import { loggerService } from '@logger'
import { usePartsMap } from '@renderer/pages/home/Messages/Blocks/V2Contexts'
import { type Topic, type TranslateLanguageCode } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { useCallback } from 'react'

import { useV2Chat } from './V2ChatContext'

const logger = loggerService.withContext('useMessage')

/**
 * Per-message bound operations.
 *
 * Consumers that already hold a stable `message.id` for the whole render
 * (MessageMenubar, Message, etc.) should reach for this hook; topic-level
 * and dynamic-id callers (multi-select delete, group iteration) read
 * `useV2Chat()` directly.
 *
 * All write operations delegate into the V2 chat overrides context (owned
 * by `V2ChatContent`), so they pick up the optimistic SWR cache overlay
 * and refresh-failure isolation that hook wires up.
 */
export function useMessage(messageId: string, topic: Topic) {
  const v2 = useV2Chat()
  const partsMap = usePartsMap()

  // `V2ChatContent.handleDeleteMessage` handles span-cache cleanup
  // internally; callers that have `traceId` / `modelName` on hand (e.g.
  // `MessageMenubar` reading them off the assistant message) forward
  // them via the optional second argument.
  const remove = useCallback(
    async (traceId?: string, modelName?: string) => {
      await v2?.deleteMessage(messageId, { traceId, modelName })
    },
    [messageId, v2]
  )

  const regenerate = useCallback(async () => {
    await v2?.regenerate(messageId)
  }, [messageId, v2])

  /**
   * Regenerate this assistant turn using a different model, producing a new
   * sibling in the existing group for side-by-side comparison. Wired to the
   * `@` (mention model) button on assistant messages.
   */
  const regenerateWithModel = useCallback(
    async (modelId: UniqueModelId) => {
      await v2?.regenerate(messageId, { modelId })
    },
    [messageId, v2]
  )

  const resend = useCallback(async () => {
    await v2?.resend(messageId)
  }, [messageId, v2])

  const editParts = useCallback(
    async (parts: CherryMessagePart[]) => {
      await v2?.editMessage(messageId, parts)
    },
    [messageId, v2]
  )

  const forkAndResend = useCallback(
    async (parts: CherryMessagePart[]) => {
      await v2?.forkAndResend(messageId, parts)
    },
    [messageId, v2]
  )

  const createBranchTopic = useCallback(async () => {
    await v2?.createBranchTopic(messageId)
  }, [messageId, v2])

  /**
   * Initiates translation and returns an updater function.
   * TODO: Move translation persistence to Main side (dedicated IPC endpoint).
   * Currently Renderer reads parts + patches via DataApi as a transitional approach.
   */
  const getTranslationUpdater = useCallback(
    async (
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
    [messageId, partsMap, topic.id, v2]
  )

  return {
    remove,
    regenerate,
    regenerateWithModel,
    resend,
    editParts,
    forkAndResend,
    createBranchTopic,
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
