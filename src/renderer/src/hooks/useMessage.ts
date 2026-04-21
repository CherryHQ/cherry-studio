import { cacheService } from '@data/CacheService'
import { loggerService } from '@logger'
import { usePartsMap } from '@renderer/pages/home/Messages/Blocks/V2Contexts'
import { type Topic, type TranslateLanguageCode } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import type { CherryMessagePart } from '@shared/data/types/message'
import { use, useCallback } from 'react'

import { V2ChatOverridesContext } from './useMessageOperations'

const logger = loggerService.withContext('useMessage')

/**
 * Per-message bound operations.
 *
 * Consumers that already hold a stable `message.id` for the whole render
 * (MessageMenubar, Message, etc.) should reach for this hook; the
 * topic-level `useMessageOperations` stays for callers whose target id is
 * dynamic at call time (multi-select delete, group iteration).
 *
 * All write operations delegate into the V2 chat overrides context (owned
 * by `V2ChatContent`), so they pick up the optimistic SWR cache overlay
 * and refresh-failure isolation that hook wires up.
 */
export function useMessage(messageId: string, topic: Topic) {
  const v2 = use(V2ChatOverridesContext)
  const partsMap = usePartsMap()

  const remove = useCallback(
    async (traceId?: string, modelName?: string) => {
      await v2?.deleteMessage(messageId)
      void window.api.trace.cleanHistory(topic.id, traceId || '', modelName)
    },
    [messageId, topic.id, v2]
  )

  const regenerate = useCallback(async () => {
    await v2?.regenerate(messageId)
  }, [messageId, v2])

  const resend = useCallback(async () => {
    await v2?.resend(messageId)
  }, [messageId, v2])

  const editParts = useCallback(
    async (parts: CherryMessagePart[]) => {
      await v2?.editMessage(messageId, parts)
    },
    [messageId, v2]
  )

  const resendWithEdit = useCallback(
    async (parts: CherryMessagePart[]) => {
      await v2?.editMessage(messageId, parts)
      await v2?.resend(messageId)
    },
    [messageId, v2]
  )

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

  return { remove, regenerate, resend, editParts, resendWithEdit, getTranslationUpdater }
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
