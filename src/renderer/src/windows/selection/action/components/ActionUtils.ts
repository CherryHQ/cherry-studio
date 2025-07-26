import { loggerService } from '@logger'
import { fetchChatCompletion } from '@renderer/services/ApiService'
import { getAssistantMessage, getUserMessage } from '@renderer/services/MessagesService'
import store from '@renderer/store'
import { updateOneBlock, upsertManyBlocks, upsertOneBlock } from '@renderer/store/messageBlock'
import { newMessagesActions } from '@renderer/store/newMessage'
import { cancelThrottledBlockUpdate, throttledBlockUpdate } from '@renderer/store/thunk/messageThunk'
import { Assistant, Topic } from '@renderer/types'
import { Chunk, ChunkType } from '@renderer/types/chunk'
import { AssistantMessageStatus, MessageBlockStatus } from '@renderer/types/newMessage'
import { formatErrorMessage, isAbortError } from '@renderer/utils/error'
import { createErrorBlock, createMainTextBlock, createThinkingBlock } from '@renderer/utils/messageUtils/create'

const logger = loggerService.withContext('ActionUtils')

export const processMessages = async (
  assistant: Assistant,
  topic: Topic,
  promptContent: string,
  setAskId: (id: string) => void,
  onStream: () => void,
  onFinish: (content: string) => void,
  onError: (error: Error) => void
) => {
  if (!assistant || !topic) return

  try {
    const { message: userMessage, blocks: userBlocks } = getUserMessage({
      assistant,
      topic,
      content: promptContent
    })

    setAskId(userMessage.id)

    store.dispatch(newMessagesActions.addMessage({ topicId: topic.id, message: userMessage }))
    store.dispatch(upsertManyBlocks(userBlocks))

    let textBlockId: string | null = null
    let thinkingBlockId: string | null = null
    let textBlockContent: string = ''

    const assistantMessage = getAssistantMessage({
      assistant,
      topic
    })
    store.dispatch(
      newMessagesActions.addMessage({
        topicId: topic.id,
        message: assistantMessage
      })
    )

    await fetchChatCompletion({
      messages: [userMessage],
      assistant: { ...assistant, settings: { streamOutput: true } },
      onChunkReceived: (chunk: Chunk) => {
        switch (chunk.type) {
          case ChunkType.THINKING_START:
            {
              if (thinkingBlockId) {
                store.dispatch(
                  updateOneBlock({ id: thinkingBlockId, changes: { status: MessageBlockStatus.STREAMING } })
                )
              } else {
                const block = createThinkingBlock(assistantMessage.id, '', {
                  status: MessageBlockStatus.STREAMING
                })
                thinkingBlockId = block.id
                store.dispatch(
                  newMessagesActions.updateMessage({
                    topicId: topic.id,
                    messageId: assistantMessage.id,
                    updates: { blockInstruction: { id: block.id } }
                  })
                )
                store.dispatch(upsertOneBlock(block))
              }
            }
            break
          case ChunkType.THINKING_DELTA:
            {
              if (thinkingBlockId) {
                throttledBlockUpdate(thinkingBlockId, {
                  content: chunk.text,
                  thinking_millsec: chunk.thinking_millsec
                })
              }
              onStream()
            }
            break
          case ChunkType.THINKING_COMPLETE:
            {
              if (thinkingBlockId) {
                cancelThrottledBlockUpdate(thinkingBlockId)
                store.dispatch(
                  updateOneBlock({
                    id: thinkingBlockId,
                    changes: {
                      content: chunk.text,
                      status: MessageBlockStatus.SUCCESS,
                      thinking_millsec: chunk.thinking_millsec
                    }
                  })
                )
                thinkingBlockId = null
              }
            }
            break
          case ChunkType.TEXT_START:
            {
              if (textBlockId) {
                store.dispatch(updateOneBlock({ id: textBlockId, changes: { status: MessageBlockStatus.STREAMING } }))
              } else {
                const block = createMainTextBlock(assistantMessage.id, '', {
                  status: MessageBlockStatus.STREAMING
                })
                textBlockId = block.id
                store.dispatch(
                  newMessagesActions.updateMessage({
                    topicId: topic.id,
                    messageId: assistantMessage.id,
                    updates: { blockInstruction: { id: block.id } }
                  })
                )
                store.dispatch(upsertOneBlock(block))
              }
            }
            break
          case ChunkType.TEXT_DELTA:
            {
              if (textBlockId) {
                throttledBlockUpdate(textBlockId, { content: chunk.text })
              }
              onStream()
              textBlockContent = chunk.text
            }
            break
          case ChunkType.TEXT_COMPLETE:
            {
              if (textBlockId) {
                cancelThrottledBlockUpdate(textBlockId)
                store.dispatch(
                  updateOneBlock({
                    id: textBlockId,
                    changes: { content: chunk.text, status: MessageBlockStatus.SUCCESS }
                  })
                )
                onFinish(chunk.text)
                textBlockContent = chunk.text
                textBlockId = null
              }
            }
            break
          case ChunkType.BLOCK_COMPLETE:
            {
              store.dispatch(
                newMessagesActions.updateMessage({
                  topicId: topic.id,
                  messageId: assistantMessage.id,
                  updates: { status: AssistantMessageStatus.SUCCESS }
                })
              )
            }
            break
          case ChunkType.ERROR:
            {
              const blockId = textBlockId || thinkingBlockId
              if (blockId) {
                store.dispatch(
                  updateOneBlock({
                    id: blockId,
                    changes: {
                      status: isAbortError(chunk.error) ? MessageBlockStatus.PAUSED : MessageBlockStatus.ERROR
                    }
                  })
                )
              }
              const isErrorTypeAbort = isAbortError(chunk.error)
              let pauseErrorLanguagePlaceholder = ''
              if (isErrorTypeAbort) {
                pauseErrorLanguagePlaceholder = 'pause_placeholder'
              }
              const serializableError = {
                name: chunk.error.name,
                message: pauseErrorLanguagePlaceholder || chunk.error.message || formatErrorMessage(chunk.error),
                originalMessage: chunk.error.message,
                stack: chunk.error.stack,
                status: chunk.error.status || chunk.error.code,
                requestId: chunk.error.request_id
              }
              const errorBlock = createErrorBlock(assistantMessage.id, serializableError, {
                status: isErrorTypeAbort ? MessageBlockStatus.PAUSED : MessageBlockStatus.ERROR
              })
              store.dispatch(
                newMessagesActions.updateMessage({
                  topicId: topic.id,
                  messageId: assistantMessage.id,
                  updates: { blockInstruction: { id: errorBlock.id } }
                })
              )
              store.dispatch(upsertOneBlock(errorBlock))
              store.dispatch(
                newMessagesActions.updateMessage({
                  topicId: topic.id,
                  messageId: assistantMessage.id,
                  updates: {
                    status: isAbortError(chunk.error) ? AssistantMessageStatus.PAUSED : AssistantMessageStatus.ERROR
                  }
                })
              )
              onFinish(textBlockContent)
            }
            break
        }
      }
    })
  } catch (err) {
    if (isAbortError(err)) return
    onError(err instanceof Error ? err : new Error('An error occurred'))
    logger.error('Error fetching result:', err as Error)
  }
}
