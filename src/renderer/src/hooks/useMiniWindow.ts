import { fetchChatCompletion } from '@renderer/services/ApiService'
import { getDefaultTopic } from '@renderer/services/AssistantService'
import { getAssistantMessage, getUserMessage } from '@renderer/services/MessagesService'
import store from '@renderer/store'
import { updateOneBlock, upsertManyBlocks, upsertOneBlock } from '@renderer/store/messageBlock'
import { newMessagesActions, selectMessagesForTopic } from '@renderer/store/newMessage'
import { cancelThrottledBlockUpdate, throttledBlockUpdate } from '@renderer/store/thunk/messageThunk'
import { Assistant, Topic } from '@renderer/types'
import { Chunk, ChunkType } from '@renderer/types/chunk'
import { AssistantMessageStatus, MessageBlockStatus } from '@renderer/types/newMessage'
import { abortCompletion } from '@renderer/utils/abortController'
import { isAbortError } from '@renderer/utils/error'
import { createMainTextBlock, createThinkingBlock } from '@renderer/utils/messageUtils/create'
import { RefObject, useCallback, useState } from 'react'

export interface SendMessageOptions {
  currentAssistant: Assistant
  currentTopic: RefObject<Topic>
  currentAskId: RefObject<string>
}

export const useSendMessage = (options: SendMessageOptions) => {
  const { currentAssistant, currentTopic, currentAskId } = options

  // Indicator for loading(thinking/streaming)
  const [isLoading, setIsLoading] = useState(false)
  // Indicator for whether the first message is outputted
  const [isOutputted, setIsOutputted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sendMessage = useCallback(
    async (userContent: string, prompt?: string) => {
      try {
        const topicId = currentTopic.current.id

        const { message: userMessage, blocks } = getUserMessage({
          content: [prompt, userContent].filter(Boolean).join('\n\n'),
          assistant: currentAssistant,
          topic: currentTopic.current
        })

        store.dispatch(newMessagesActions.addMessage({ topicId, message: userMessage }))
        store.dispatch(upsertManyBlocks(blocks))

        const assistantMessage = getAssistantMessage({
          assistant: currentAssistant,
          topic: currentTopic.current
        })
        assistantMessage.askId = userMessage.id
        currentAskId.current = userMessage.id

        store.dispatch(newMessagesActions.addMessage({ topicId, message: assistantMessage }))

        const allMessagesForTopic = selectMessagesForTopic(store.getState(), topicId)
        const userMessageIndex = allMessagesForTopic.findIndex((m) => m?.id === userMessage.id)

        const messagesForContext = allMessagesForTopic
          .slice(0, userMessageIndex + 1)
          .filter((m) => m && !m.status?.includes('ing'))

        let blockId: string | null = null
        let thinkingBlockId: string | null = null

        setIsLoading(true)
        setIsOutputted(false)
        setError(null)

        await fetchChatCompletion({
          messages: messagesForContext,
          assistant: { ...currentAssistant, settings: { streamOutput: true } },
          onChunkReceived: (chunk: Chunk) => {
            switch (chunk.type) {
              case ChunkType.THINKING_START:
                {
                  setIsOutputted(true)
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
                        topicId,
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
                  setIsOutputted(true)
                  if (thinkingBlockId) {
                    throttledBlockUpdate(thinkingBlockId, {
                      content: chunk.text,
                      thinking_millsec: chunk.thinking_millsec
                    })
                  }
                }
                break
              case ChunkType.THINKING_COMPLETE:
                {
                  if (thinkingBlockId) {
                    cancelThrottledBlockUpdate(thinkingBlockId)
                    store.dispatch(
                      updateOneBlock({
                        id: thinkingBlockId,
                        changes: { status: MessageBlockStatus.SUCCESS, thinking_millsec: chunk.thinking_millsec }
                      })
                    )
                  }
                }
                break
              case ChunkType.TEXT_START:
                {
                  setIsOutputted(true)
                  if (blockId) {
                    store.dispatch(updateOneBlock({ id: blockId, changes: { status: MessageBlockStatus.STREAMING } }))
                  } else {
                    const block = createMainTextBlock(assistantMessage.id, '', {
                      status: MessageBlockStatus.STREAMING
                    })
                    blockId = block.id
                    store.dispatch(
                      newMessagesActions.updateMessage({
                        topicId,
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
                  setIsOutputted(true)
                  if (blockId) {
                    throttledBlockUpdate(blockId, { content: chunk.text })
                  }
                }
                break
              case ChunkType.TEXT_COMPLETE:
                {
                  if (blockId) {
                    cancelThrottledBlockUpdate(blockId)
                    store.dispatch(
                      updateOneBlock({
                        id: blockId,
                        changes: { content: chunk.text, status: MessageBlockStatus.SUCCESS }
                      })
                    )
                  }
                }
                break
              case ChunkType.ERROR: {
                //stop the thinking timer
                const isAborted = isAbortError(chunk.error)
                const possibleBlockId = thinkingBlockId || blockId
                if (possibleBlockId) {
                  store.dispatch(
                    updateOneBlock({
                      id: possibleBlockId,
                      changes: {
                        status: isAborted ? MessageBlockStatus.PAUSED : MessageBlockStatus.ERROR
                      }
                    })
                  )
                  store.dispatch(
                    newMessagesActions.updateMessage({
                      topicId,
                      messageId: assistantMessage.id,
                      updates: {
                        status: isAborted ? AssistantMessageStatus.PAUSED : AssistantMessageStatus.SUCCESS
                      }
                    })
                  )
                }
                if (!isAborted) {
                  throw new Error(chunk.error.message)
                }
              }
              //fall through
              case ChunkType.BLOCK_COMPLETE:
                setIsLoading(false)
                setIsOutputted(true)
                currentAskId.current = ''
                store.dispatch(
                  newMessagesActions.updateMessage({
                    topicId,
                    messageId: assistantMessage.id,
                    updates: { status: AssistantMessageStatus.SUCCESS }
                  })
                )
                break
            }
          }
        })
      } catch (err) {
        if (isAbortError(err)) return

        setIsLoading(false)
        setError(err instanceof Error ? err.message : 'An error occurred')

        console.error('Error fetching result:', err)
      } finally {
        setIsLoading(false)
        setIsOutputted(true)
        currentAskId.current = ''
      }
    },
    [currentAssistant, currentTopic, currentAskId]
  )

  const pause = useCallback(() => {
    if (!currentAskId.current) return

    abortCompletion(currentAskId.current)
    setIsLoading(false)
    setIsOutputted(true)
    currentAskId.current = ''
  }, [currentAskId])

  const reset = useCallback(() => {
    // Clear the topic messages to reduce memory usage
    if (currentTopic.current) {
      store.dispatch(newMessagesActions.clearTopicMessages(currentTopic.current.id))
    }

    // Reset the topic
    currentTopic.current = getDefaultTopic(currentAssistant.id)

    setError(null)
  }, [currentAssistant, currentTopic])

  return {
    isLoading,
    isOutputted,
    error,
    setError,
    sendMessage,
    pause,
    reset
  }
}
