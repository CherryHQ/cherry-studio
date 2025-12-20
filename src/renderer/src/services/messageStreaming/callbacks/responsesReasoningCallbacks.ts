import { loggerService } from '@logger'
import type { AppDispatch, RootState } from '@renderer/store'
import { newMessagesActions } from '@renderer/store/newMessage'
import type { Message } from '@renderer/types'

const logger = loggerService.withContext('ResponsesReasoningCallbacks')

interface ResponsesReasoningCallbacksDependencies {
  dispatch: AppDispatch
  getState: () => RootState
  topicId: string
  assistantMsgId: string
  saveUpdatesToDB: (
    messageId: string,
    topicId: string,
    messageUpdates: Partial<Message>,
    blocksToUpdate: any[]
  ) => Promise<void>
}

type ResponsesReasoningRawPayload = {
  type: 'responses_reasoning'
  itemId: string
  encryptedContent: string
}

function isResponsesReasoningRawPayload(value: unknown): value is ResponsesReasoningRawPayload {
  if (typeof value !== 'object' || value === null) return false
  const payload = value as Partial<ResponsesReasoningRawPayload>
  if (payload.type !== 'responses_reasoning') return false
  if (typeof payload.itemId !== 'string' || payload.itemId.length === 0) return false
  if (typeof payload.encryptedContent !== 'string' || payload.encryptedContent.length === 0) return false
  return true
}

export const createResponsesReasoningCallbacks = (deps: ResponsesReasoningCallbacksDependencies) => {
  const { dispatch, getState, topicId, assistantMsgId, saveUpdatesToDB } = deps

  const persistResponsesReasoning = async (payload: ResponsesReasoningRawPayload) => {
    const state = getState()
    const assistantMessage = state.messages.entities[assistantMsgId]
    if (!assistantMessage) {
      logger.warn('[persistResponsesReasoning] Assistant message not found, skipping.', { assistantMsgId, topicId })
      return
    }

    const updates: Partial<Message> = {
      responsesReasoningItemId: payload.itemId,
      responsesReasoningEncryptedContent: payload.encryptedContent
    }

    dispatch(
      newMessagesActions.updateMessage({
        topicId,
        messageId: assistantMsgId,
        updates
      })
    )

    try {
      await saveUpdatesToDB(assistantMsgId, topicId, updates, [])
    } catch (error) {
      logger.error('[persistResponsesReasoning] Failed to persist responses reasoning fields to DB.', error as Error, {
        assistantMsgId,
        topicId
      })
    }
  }

  const onRawData = (content: unknown, metadata?: Record<string, any>) => {
    if (!isResponsesReasoningRawPayload(content)) return

    logger.debug('[onRawData] Persisting responses reasoning encrypted content.', {
      assistantMsgId,
      topicId,
      itemId: content.itemId,
      metadata
    })

    void persistResponsesReasoning(content)
  }

  return {
    onRawData
  }
}
