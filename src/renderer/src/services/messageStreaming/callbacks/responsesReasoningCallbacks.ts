import { loggerService } from '@logger'
import type { AppDispatch, RootState } from '@renderer/store'
import { newMessagesActions } from '@renderer/store/newMessage'
import type { Message } from '@renderer/types'
import type { ResponsesReasoningRawPayload } from '@renderer/utils/responsesReasoning'
import { parseResponsesReasoningRawPayload } from '@renderer/utils/responsesReasoning'
import type { ProviderMetadata } from 'ai'

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

export const createResponsesReasoningCallbacks = (deps: ResponsesReasoningCallbacksDependencies) => {
  const { dispatch, getState, topicId, assistantMsgId, saveUpdatesToDB } = deps

  const persistResponsesReasoning = async (payload: ResponsesReasoningRawPayload) => {
    const state = getState()
    const assistantMessage = state.messages.entities[assistantMsgId]
    if (!assistantMessage) {
      logger.warn('[persistResponsesReasoning] Assistant message not found, skipping.', { assistantMsgId, topicId })
      return
    }

    const previousProviderMetadata = assistantMessage.providerMetadata ?? {}
    const previousOpenaiProviderMetadata = previousProviderMetadata.openai ?? {}

    const nextProviderMetadata: ProviderMetadata = {
      ...previousProviderMetadata,
      openai: {
        ...previousOpenaiProviderMetadata,
        itemId: payload.itemId,
        reasoningEncryptedContent: payload.encryptedContent
      }
    }

    const updates: Partial<Message> = {
      providerMetadata: nextProviderMetadata
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
    const payload = parseResponsesReasoningRawPayload(content)
    if (!payload) return

    logger.debug('[onRawData] Persisting responses reasoning encrypted content.', {
      assistantMsgId,
      topicId,
      itemId: payload.itemId,
      metadata
    })

    void persistResponsesReasoning(payload)
  }

  return {
    onRawData
  }
}
