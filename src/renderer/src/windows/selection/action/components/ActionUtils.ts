import { fetchChatCompletion } from '@renderer/services/ApiService'
import { getAssistantMessage, getUserMessage } from '@renderer/services/MessagesService'
import store from '@renderer/store'
import { updateOneBlock, upsertManyBlocks, upsertOneBlock } from '@renderer/store/messageBlock'
import { newMessagesActions } from '@renderer/store/newMessage'
import { Assistant, Topic } from '@renderer/types'
import { Chunk, ChunkType } from '@renderer/types/chunk'
import { AssistantMessageStatus, MessageBlockStatus } from '@renderer/types/newMessage'
import { isAbortError } from '@renderer/utils/error'
import { createMainTextBlock, createThinkingBlock } from '@renderer/utils/messageUtils/create'

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
    let textBlockContent: string = ''

    let thinkingBlockId: string | null = null
    let thinkingBlockContent: string = ''

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
          case ChunkType.THINKING_DELTA:
            {
              thinkingBlockContent += chunk.text
              if (!thinkingBlockId) {
                const block = createThinkingBlock(assistantMessage.id, chunk.text, {
                  status: MessageBlockStatus.STREAMING,
                  thinking_millsec: chunk.thinking_millsec
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
              } else {
                store.dispatch(
                  updateOneBlock({
                    id: thinkingBlockId,
                    changes: { content: thinkingBlockContent, thinking_millsec: chunk.thinking_millsec }
                  })
                )
              }
              onStream()
            }
            break
          case ChunkType.THINKING_COMPLETE:
            {
              if (thinkingBlockId) {
                store.dispatch(
                  updateOneBlock({
                    id: thinkingBlockId,
                    changes: { status: MessageBlockStatus.SUCCESS, thinking_millsec: chunk.thinking_millsec }
                  })
                )
              }
            }
            break
          case ChunkType.TEXT_DELTA:
            {
              textBlockContent += chunk.text
              if (!textBlockId) {
                const block = createMainTextBlock(assistantMessage.id, chunk.text, {
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
              } else {
                store.dispatch(updateOneBlock({ id: textBlockId, changes: { content: textBlockContent } }))
              }

              onStream()
            }
            break
          case ChunkType.TEXT_COMPLETE:
            {
              textBlockId &&
                store.dispatch(
                  updateOneBlock({
                    id: textBlockId,
                    changes: { status: MessageBlockStatus.SUCCESS }
                  })
                )
              store.dispatch(
                newMessagesActions.updateMessage({
                  topicId: topic.id,
                  messageId: assistantMessage.id,
                  updates: { status: AssistantMessageStatus.SUCCESS }
                })
              )
              textBlockContent = chunk.text
            }
            break
          case ChunkType.BLOCK_COMPLETE:
          case ChunkType.ERROR:
            onFinish(textBlockContent)
            break
        }
      }
    })
  } catch (err) {
    if (isAbortError(err)) return
    onError(err instanceof Error ? err : new Error('An error occurred'))
    console.error('Error fetching result:', err)
  }
}
