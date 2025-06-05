import { fetchChatCompletion } from '@renderer/services/ApiService'
import { getAssistantMessage, getUserMessage } from '@renderer/services/MessagesService'
import store from '@renderer/store'
import { updateOneBlock, upsertManyBlocks, upsertOneBlock } from '@renderer/store/messageBlock'
import { newMessagesActions } from '@renderer/store/newMessage'
import { Assistant, Topic } from '@renderer/types'
import { Chunk, ChunkType } from '@renderer/types/chunk'
import { AssistantMessageStatus, MessageBlockStatus } from '@renderer/types/newMessage'
import { isAbortError } from '@renderer/utils/error'
import { createMainTextBlock } from '@renderer/utils/messageUtils/create'

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

    let blockId: string | null = null
    let blockContent: string = ''

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
      assistant,
      onChunkReceived: (chunk: Chunk) => {
        switch (chunk.type) {
          case ChunkType.THINKING_DELTA:
          case ChunkType.THINKING_COMPLETE:
            //TODO
            break
          case ChunkType.TEXT_DELTA:
            {
              blockContent += chunk.text
              if (!blockId) {
                const block = createMainTextBlock(assistantMessage.id, chunk.text, {
                  status: MessageBlockStatus.STREAMING
                })
                blockId = block.id
                store.dispatch(
                  newMessagesActions.updateMessage({
                    topicId: topic.id,
                    messageId: assistantMessage.id,
                    updates: { blockInstruction: { id: block.id } }
                  })
                )
                store.dispatch(upsertOneBlock(block))
              } else {
                store.dispatch(updateOneBlock({ id: blockId, changes: { content: blockContent } }))
              }

              onStream()
            }
            break
          case ChunkType.TEXT_COMPLETE:
            {
              blockId &&
                store.dispatch(
                  updateOneBlock({
                    id: blockId,
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
              blockContent = chunk.text
            }
            break
          case ChunkType.BLOCK_COMPLETE:
          case ChunkType.ERROR:
            onFinish(blockContent)
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
