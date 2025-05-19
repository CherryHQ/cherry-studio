import db from '@renderer/databases'
import { autoRenameTopic } from '@renderer/hooks/useTopic'
import { fetchChatCompletion } from '@renderer/services/ApiService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { createStreamProcessor, type StreamProcessorCallbacks } from '@renderer/services/StreamProcessingService'
import { estimateMessagesUsage } from '@renderer/services/TokenService'
import store from '@renderer/store'
import type { Assistant, ExternalToolResult, FileType, MCPToolResponse, Model, Topic } from '@renderer/types'
import { WebSearchSource } from '@renderer/types'
import type {
  CitationMessageBlock,
  FileMessageBlock,
  ImageMessageBlock,
  Message,
  MessageBlock,
  PlaceholderMessageBlock,
  ToolMessageBlock
} from '@renderer/types/newMessage'
import { AssistantMessageStatus, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { Response } from '@renderer/types/newMessage'
import { isAbortError } from '@renderer/utils/error'
import { extractUrlsFromMarkdown } from '@renderer/utils/linkConverter'
import {
  createAssistantMessage,
  createBaseMessageBlock,
  createCitationBlock,
  createErrorBlock,
  createImageBlock,
  createMainTextBlock,
  createThinkingBlock,
  createToolBlock,
  createTranslationBlock,
  resetAssistantMessage
} from '@renderer/utils/messageUtils/create'
import { getTopicQueue, waitForTopicQueue } from '@renderer/utils/queue'
import { throttle } from 'lodash'
import { v4 as uuidv4 } from 'uuid'

import type { AppDispatch, RootState } from '../index'
import { removeManyBlocks, updateOneBlock, upsertManyBlocks, upsertOneBlock } from '../messageBlock'
import { newMessagesActions, selectMessagesForTopic } from '../newMessage'

const handleChangeLoadingOfTopic = async (topicId: string) => {
  await waitForTopicQueue(topicId)
  store.dispatch(newMessagesActions.setTopicLoading({ topicId, loading: false }))
}
// TODO: 后续可以将db操作移到Listener Middleware中
export const saveMessageAndBlocksToDB = async (message: Message, blocks: MessageBlock[]) => {
  try {
    if (blocks.length > 0) {
      await db.message_blocks.bulkPut(blocks)
    }
    const topic = await db.topics.get(message.topicId)
    if (topic) {
      const messageIndex = topic.messages.findIndex((m) => m.id === message.id)
      const updatedMessages = [...topic.messages]

      if (messageIndex !== -1) {
        updatedMessages[messageIndex] = message
      } else {
        updatedMessages.push(message)
      }
      await db.topics.update(message.topicId, { messages: updatedMessages })
    } else {
      console.error(`[saveMessageAndBlocksToDB] Topic ${message.topicId} not found.`)
    }
  } catch (error) {
    console.error(`[saveMessageAndBlocksToDB] Failed to save message ${message.id}:`, error)
  }
}

const updateExistingMessageAndBlocksInDB = async (
  updatedMessage: Partial<Message> & Pick<Message, 'id' | 'topicId'>,
  updatedBlocks: MessageBlock[]
) => {
  try {
    // Always update blocks if provided
    if (updatedBlocks.length > 0) {
      await db.message_blocks.bulkPut(updatedBlocks)
    }

    // Check if there are message properties to update beyond id and topicId
    const messageKeysToUpdate = Object.keys(updatedMessage).filter((key) => key !== 'id' && key !== 'topicId')

    // Only proceed with topic update if there are actual message changes
    if (messageKeysToUpdate.length > 0) {
      const topic = await db.topics.get(updatedMessage.topicId)
      if (topic) {
        const messageIndex = topic.messages.findIndex((m) => m.id === updatedMessage.id)
        if (messageIndex !== -1) {
          const newMessages = [...topic.messages]
          // Apply the updates passed in updatedMessage
          Object.assign(newMessages[messageIndex], updatedMessage)
          // Logger.log('updateExistingMessageAndBlocksInDB', updatedMessage)
          await db.topics.update(updatedMessage.topicId, { messages: newMessages })
        } else {
          console.error(`[updateExistingMsg] Message ${updatedMessage.id} not found in topic ${updatedMessage.topicId}`)
        }
      } else {
        console.error(`[updateExistingMsg] Topic ${updatedMessage.topicId} not found.`)
      }
    }
    // If messageKeysToUpdate.length === 0, we skip topic fetch/update entirely
  } catch (error) {
    console.error(`[updateExistingMsg] Failed to update message ${updatedMessage.id}:`, error)
  }
}

// 更新单个块的逻辑，用于更新消息中的单个块
const throttledBlockUpdate = throttle(async (id, blockUpdate) => {
  // const state = store.getState()
  // const block = state.messageBlocks.entities[id]
  // throttle是异步函数,可能会在complete事件触发后才执行
  // if (
  //   blockUpdate.status === MessageBlockStatus.STREAMING &&
  //   (block?.status === MessageBlockStatus.SUCCESS || block?.status === MessageBlockStatus.ERROR)
  // )
  //   return

  store.dispatch(updateOneBlock({ id, changes: blockUpdate }))
  await db.message_blocks.update(id, blockUpdate)
}, 150)

const cancelThrottledBlockUpdate = throttledBlockUpdate.cancel

// // 修改: 节流更新单个块的内容/状态到数据库 (仅用于 Text/Thinking Chunks)
// export const throttledBlockDbUpdate = throttle(
//   async (blockId: string, blockChanges: Partial<MessageBlock>) => {
//     // Check if blockId is valid before attempting update
//     if (!blockId) {
//       console.warn('[DB Throttle Block Update] Attempted to update with null/undefined blockId. Skipping.')
//       return
//     }
//     const state = store.getState()
//     const block = state.messageBlocks.entities[blockId]
//     // throttle是异步函数,可能会在complete事件触发后才执行
//     if (
//       blockChanges.status === MessageBlockStatus.STREAMING &&
//       (block?.status === MessageBlockStatus.SUCCESS || block?.status === MessageBlockStatus.ERROR)
//     )
//       return
//     try {
//     } catch (error) {
//       console.error(`[DB Throttle Block Update] Failed for block ${blockId}:`, error)
//     }
//   },
//   300, // 可以调整节流间隔
//   { leading: false, trailing: true }
// )

// 新增: 通用的、非节流的函数，用于保存消息和块的更新到数据库
const saveUpdatesToDB = async (
  messageId: string,
  topicId: string,
  messageUpdates: Partial<Message>, // 需要更新的消息字段
  blocksToUpdate: MessageBlock[] // 需要更新/创建的块
) => {
  try {
    const messageDataToSave: Partial<Message> & Pick<Message, 'id' | 'topicId'> = {
      id: messageId,
      topicId,
      ...messageUpdates
    }
    await updateExistingMessageAndBlocksInDB(messageDataToSave, blocksToUpdate)
  } catch (error) {
    console.error(`[DB Save Updates] Failed for message ${messageId}:`, error)
  }
}

// 新增: 辅助函数，用于获取并保存单个更新后的 Block 到数据库
const saveUpdatedBlockToDB = async (
  blockId: string | null,
  messageId: string,
  topicId: string,
  getState: () => RootState
) => {
  if (!blockId) {
    console.warn('[DB Save Single Block] Received null/undefined blockId. Skipping save.')
    return
  }
  const state = getState()
  const blockToSave = state.messageBlocks.entities[blockId]
  if (blockToSave) {
    await saveUpdatesToDB(messageId, topicId, {}, [blockToSave]) // Pass messageId, topicId, empty message updates, and the block
  } else {
    console.warn(`[DB Save Single Block] Block ${blockId} not found in state. Cannot save.`)
  }
}

// --- Helper Function for Multi-Model Dispatch ---
// 多模型创建和发送请求的逻辑，用于用户消息多模型发送和重发
const dispatchMultiModelResponses = async (
  dispatch: AppDispatch,
  getState: () => RootState,
  topicId: string,
  triggeringMessage: Message, // userMessage or messageToResend
  assistant: Assistant,
  mentionedModels: Model[]
) => {
  const assistantMessageStubs: Message[] = []
  const tasksToQueue: { assistantConfig: Assistant; messageStub: Message }[] = []

  for (const mentionedModel of mentionedModels) {
    const assistantForThisMention = { ...assistant, model: mentionedModel }
    const assistantMessage = createAssistantMessage(assistant.id, topicId, {
      askId: triggeringMessage.id,
      model: mentionedModel,
      modelId: mentionedModel.id
    })
    dispatch(newMessagesActions.addMessage({ topicId, message: assistantMessage }))
    assistantMessageStubs.push(assistantMessage)
    tasksToQueue.push({ assistantConfig: assistantForThisMention, messageStub: assistantMessage })
  }

  const topicFromDB = await db.topics.get(topicId)
  if (topicFromDB) {
    const currentTopicMessageIds = getState().messages.messageIdsByTopic[topicId] || []
    const currentEntities = getState().messages.entities
    const messagesToSaveInDB = currentTopicMessageIds.map((id) => currentEntities[id]).filter((m): m is Message => !!m)
    await db.topics.update(topicId, { messages: messagesToSaveInDB })
  } else {
    console.error(`[dispatchMultiModelResponses] Topic ${topicId} not found in DB during multi-model save.`)
    throw new Error(`Topic ${topicId} not found in DB.`)
  }

  const queue = getTopicQueue(topicId)
  for (const task of tasksToQueue) {
    queue.add(async () => {
      await fetchAndProcessAssistantResponseImpl(dispatch, getState, topicId, task.assistantConfig, task.messageStub)
    })
  }
}

// --- End Helper Function ---

// Internal function extracted from sendMessage to handle fetching and processing assistant response
const fetchAndProcessAssistantResponseImpl = async (
  dispatch: AppDispatch,
  getState: () => RootState,
  topicId: string,
  assistant: Assistant,
  assistantMessage: Message // Pass the prepared assistant message (new or reset)
) => {
  const assistantMsgId = assistantMessage.id
  let callbacks: StreamProcessorCallbacks = {}
  try {
    dispatch(newMessagesActions.setTopicLoading({ topicId, loading: true }))

    let accumulatedContent = ''
    let accumulatedThinking = ''
    let lastBlockId: string | null = null
    let lastBlockType: MessageBlockType | null = null
    let citationBlockId: string | null = null
    let mainTextBlockId: string | null = null
    const toolCallIdToBlockIdMap = new Map<string, string>()

    const handleBlockTransition = async (newBlock: MessageBlock, newBlockType: MessageBlockType) => {
      lastBlockId = newBlock.id
      lastBlockType = newBlockType
      if (newBlockType !== MessageBlockType.MAIN_TEXT) {
        accumulatedContent = ''
      }
      if (newBlockType !== MessageBlockType.THINKING) {
        accumulatedThinking = ''
      }
      dispatch(
        newMessagesActions.updateMessage({
          topicId,
          messageId: assistantMsgId,
          updates: { blockInstruction: { id: newBlock.id } }
        })
      )
      dispatch(upsertOneBlock(newBlock))
      dispatch(
        newMessagesActions.upsertBlockReference({
          messageId: assistantMsgId,
          blockId: newBlock.id,
          status: newBlock.status
        })
      )

      const currentState = getState()
      const updatedMessage = currentState.messages.entities[assistantMsgId]
      if (updatedMessage) {
        await saveUpdatesToDB(assistantMsgId, topicId, { blocks: updatedMessage.blocks }, [newBlock])
      } else {
        console.error(`[handleBlockTransition] Failed to get updated message ${assistantMsgId} from state for DB save.`)
      }
    }

    const allMessagesForTopic = selectMessagesForTopic(getState(), topicId)

    let messagesForContext: Message[] = []
    const userMessageId = assistantMessage.askId
    const userMessageIndex = allMessagesForTopic.findIndex((m) => m?.id === userMessageId)

    if (userMessageIndex === -1) {
      console.error(
        `[fetchAndProcessAssistantResponseImpl] Triggering user message ${userMessageId} (askId of ${assistantMsgId}) not found. Falling back.`
      )
      const assistantMessageIndexFallback = allMessagesForTopic.findIndex((m) => m?.id === assistantMsgId)
      messagesForContext = (
        assistantMessageIndexFallback !== -1
          ? allMessagesForTopic.slice(0, assistantMessageIndexFallback)
          : allMessagesForTopic
      ).filter((m) => m && !m.status?.includes('ing'))
    } else {
      const contextSlice = allMessagesForTopic.slice(0, userMessageIndex + 1)
      messagesForContext = contextSlice.filter((m) => m && !m.status?.includes('ing'))
    }

    callbacks = {
      onLLMResponseCreated: () => {
        const baseBlock = createBaseMessageBlock(assistantMsgId, MessageBlockType.UNKNOWN, {
          status: MessageBlockStatus.PROCESSING
        })
        handleBlockTransition(baseBlock as PlaceholderMessageBlock, MessageBlockType.UNKNOWN)
      },
      onTextChunk: (text) => {
        accumulatedContent += text
        if (lastBlockId) {
          if (lastBlockType === MessageBlockType.UNKNOWN) {
            const initialChanges: Partial<MessageBlock> = {
              type: MessageBlockType.MAIN_TEXT,
              content: accumulatedContent,
              status: MessageBlockStatus.STREAMING,
              citationReferences: citationBlockId ? [{ citationBlockId }] : []
            }
            mainTextBlockId = lastBlockId
            lastBlockType = MessageBlockType.MAIN_TEXT
            dispatch(updateOneBlock({ id: lastBlockId, changes: initialChanges }))
            saveUpdatedBlockToDB(lastBlockId, assistantMsgId, topicId, getState)
          } else if (lastBlockType === MessageBlockType.MAIN_TEXT) {
            const blockChanges: Partial<MessageBlock> = {
              content: accumulatedContent,
              status: MessageBlockStatus.STREAMING
            }
            throttledBlockUpdate(lastBlockId, blockChanges)
            // throttledBlockDbUpdate(lastBlockId, blockChanges)
          } else {
            const newBlock = createMainTextBlock(assistantMsgId, accumulatedContent, {
              status: MessageBlockStatus.STREAMING,
              citationReferences: citationBlockId ? [{ citationBlockId }] : []
            })
            handleBlockTransition(newBlock, MessageBlockType.MAIN_TEXT)
            mainTextBlockId = newBlock.id
          }
        }
      },
      onTextComplete: async (finalText) => {
        cancelThrottledBlockUpdate()
        if (lastBlockType === MessageBlockType.MAIN_TEXT && lastBlockId) {
          const changes = {
            content: finalText,
            status: MessageBlockStatus.SUCCESS
          }
          dispatch(updateOneBlock({ id: lastBlockId, changes }))
          saveUpdatedBlockToDB(lastBlockId, assistantMsgId, topicId, getState)

          if (assistant.enableWebSearch && assistant.model?.provider === 'openrouter') {
            const extractedUrls = extractUrlsFromMarkdown(finalText)
            if (extractedUrls.length > 0) {
              const citationBlock = createCitationBlock(
                assistantMsgId,
                { response: { source: WebSearchSource.OPENROUTER, results: extractedUrls } },
                { status: MessageBlockStatus.SUCCESS }
              )
              await handleBlockTransition(citationBlock, MessageBlockType.CITATION)
              // saveUpdatedBlockToDB(citationBlock.id, assistantMsgId, topicId, getState)
            }
          }
        } else {
          console.warn(
            `[onTextComplete] Received text.complete but last block was not MAIN_TEXT (was ${lastBlockType}) or lastBlockId is null.`
          )
        }
      },
      onThinkingChunk: (text, thinking_millsec) => {
        accumulatedThinking += text
        if (lastBlockId) {
          if (lastBlockType === MessageBlockType.UNKNOWN) {
            // First chunk for this block: Update type and status immediately
            lastBlockType = MessageBlockType.THINKING
            const initialChanges: Partial<MessageBlock> = {
              type: MessageBlockType.THINKING,
              content: accumulatedThinking,
              status: MessageBlockStatus.STREAMING
            }
            dispatch(updateOneBlock({ id: lastBlockId, changes: initialChanges }))
            saveUpdatedBlockToDB(lastBlockId, assistantMsgId, topicId, getState)
          } else if (lastBlockType === MessageBlockType.THINKING) {
            const blockChanges: Partial<MessageBlock> = {
              content: accumulatedThinking,
              status: MessageBlockStatus.STREAMING,
              thinking_millsec: thinking_millsec
            }
            throttledBlockUpdate(lastBlockId, blockChanges)
            // throttledBlockDbUpdate(lastBlockId, blockChanges)
          } else {
            const newBlock = createThinkingBlock(assistantMsgId, accumulatedThinking, {
              status: MessageBlockStatus.STREAMING,
              thinking_millsec: 0
            })
            handleBlockTransition(newBlock, MessageBlockType.THINKING)
          }
        }
      },
      onThinkingComplete: (finalText, final_thinking_millsec) => {
        cancelThrottledBlockUpdate()

        if (lastBlockType === MessageBlockType.THINKING && lastBlockId) {
          const changes = {
            type: MessageBlockType.THINKING,
            content: finalText,
            status: MessageBlockStatus.SUCCESS,
            thinking_millsec: final_thinking_millsec
          }
          dispatch(updateOneBlock({ id: lastBlockId, changes }))
          saveUpdatedBlockToDB(lastBlockId, assistantMsgId, topicId, getState)
        } else {
          console.warn(
            `[onThinkingComplete] Received thinking.complete but last block was not THINKING (was ${lastBlockType}) or lastBlockId is null.`
          )
        }
      },
      onToolCallInProgress: (toolResponse: MCPToolResponse) => {
        if (lastBlockType === MessageBlockType.UNKNOWN && lastBlockId) {
          lastBlockType = MessageBlockType.TOOL
          const changes = {
            type: MessageBlockType.TOOL,
            status: MessageBlockStatus.PROCESSING,
            metadata: { rawMcpToolResponse: toolResponse }
          }
          dispatch(updateOneBlock({ id: lastBlockId, changes }))
          saveUpdatedBlockToDB(lastBlockId, assistantMsgId, topicId, getState)
          toolCallIdToBlockIdMap.set(toolResponse.id, lastBlockId)
        } else if (toolResponse.status === 'invoking') {
          const toolBlock = createToolBlock(assistantMsgId, toolResponse.id, {
            toolName: toolResponse.tool.name,
            status: MessageBlockStatus.PROCESSING,
            metadata: { rawMcpToolResponse: toolResponse }
          })
          handleBlockTransition(toolBlock, MessageBlockType.TOOL)
          toolCallIdToBlockIdMap.set(toolResponse.id, toolBlock.id)
        } else {
          console.warn(
            `[onToolCallInProgress] Received unhandled tool status: ${toolResponse.status} for ID: ${toolResponse.id}`
          )
        }
      },
      onToolCallComplete: (toolResponse: MCPToolResponse) => {
        cancelThrottledBlockUpdate()
        const existingBlockId = toolCallIdToBlockIdMap.get(toolResponse.id)
        if (toolResponse.status === 'done' || toolResponse.status === 'error') {
          if (!existingBlockId) {
            console.error(
              `[onToolCallComplete] No existing block found for completed/error tool call ID: ${toolResponse.id}. Cannot update.`
            )
            return
          }
          const finalStatus = toolResponse.status === 'done' ? MessageBlockStatus.SUCCESS : MessageBlockStatus.ERROR
          const changes: Partial<ToolMessageBlock> = {
            content: toolResponse.response,
            status: finalStatus,
            metadata: { rawMcpToolResponse: toolResponse }
          }
          if (finalStatus === MessageBlockStatus.ERROR) {
            changes.error = { message: `Tool execution failed/error`, details: toolResponse.response }
          }
          dispatch(updateOneBlock({ id: existingBlockId, changes }))
          saveUpdatedBlockToDB(existingBlockId, assistantMsgId, topicId, getState)
        } else {
          console.warn(
            `[onToolCallComplete] Received unhandled tool status: ${toolResponse.status} for ID: ${toolResponse.id}`
          )
        }
      },
      onExternalToolInProgress: () => {
        const citationBlock = createCitationBlock(assistantMsgId, {}, { status: MessageBlockStatus.PROCESSING })
        citationBlockId = citationBlock.id
        handleBlockTransition(citationBlock, MessageBlockType.CITATION)
        // saveUpdatedBlockToDB(citationBlock.id, assistantMsgId, topicId, getState)
      },
      onExternalToolComplete: (externalToolResult: ExternalToolResult) => {
        if (citationBlockId) {
          const changes: Partial<CitationMessageBlock> = {
            response: externalToolResult.webSearch,
            knowledge: externalToolResult.knowledge,
            status: MessageBlockStatus.SUCCESS
          }
          dispatch(updateOneBlock({ id: citationBlockId, changes }))
          saveUpdatedBlockToDB(citationBlockId, assistantMsgId, topicId, getState)
        } else {
          console.error('[onExternalToolComplete] citationBlockId is null. Cannot update.')
        }
      },
      onLLMWebSearchInProgress: () => {
        const citationBlock = createCitationBlock(assistantMsgId, {}, { status: MessageBlockStatus.PROCESSING })
        citationBlockId = citationBlock.id
        handleBlockTransition(citationBlock, MessageBlockType.CITATION)
        // saveUpdatedBlockToDB(citationBlock.id, assistantMsgId, topicId, getState)
      },
      onLLMWebSearchComplete: async (llmWebSearchResult) => {
        if (citationBlockId) {
          const changes: Partial<CitationMessageBlock> = {
            response: llmWebSearchResult,
            status: MessageBlockStatus.SUCCESS
          }
          dispatch(updateOneBlock({ id: citationBlockId, changes }))
          saveUpdatedBlockToDB(citationBlockId, assistantMsgId, topicId, getState)
        } else {
          const citationBlock = createCitationBlock(
            assistantMsgId,
            { response: llmWebSearchResult },
            { status: MessageBlockStatus.SUCCESS }
          )
          citationBlockId = citationBlock.id
          handleBlockTransition(citationBlock, MessageBlockType.CITATION)
        }
        if (mainTextBlockId) {
          const state = getState()
          const existingMainTextBlock = state.messageBlocks.entities[mainTextBlockId]
          if (existingMainTextBlock && existingMainTextBlock.type === MessageBlockType.MAIN_TEXT) {
            const currentRefs = existingMainTextBlock.citationReferences || []
            if (!currentRefs.some((ref) => ref.citationBlockId === citationBlockId)) {
              const mainTextChanges = {
                citationReferences: [
                  ...currentRefs,
                  { citationBlockId, citationBlockSource: llmWebSearchResult.source }
                ]
              }
              dispatch(updateOneBlock({ id: mainTextBlockId, changes: mainTextChanges }))
              saveUpdatedBlockToDB(mainTextBlockId, assistantMsgId, topicId, getState)
            }
          }
        }
      },
      onImageCreated: () => {
        if (lastBlockId) {
          if (lastBlockType === MessageBlockType.UNKNOWN) {
            const initialChanges: Partial<MessageBlock> = {
              type: MessageBlockType.IMAGE,
              status: MessageBlockStatus.STREAMING
            }
            lastBlockType = MessageBlockType.IMAGE
            dispatch(updateOneBlock({ id: lastBlockId, changes: initialChanges }))
            saveUpdatedBlockToDB(lastBlockId, assistantMsgId, topicId, getState)
          } else {
            const imageBlock = createImageBlock(assistantMsgId, {
              status: MessageBlockStatus.PROCESSING
            })
            handleBlockTransition(imageBlock, MessageBlockType.IMAGE)
          }
        }
      },
      onImageGenerated: (imageData) => {
        const imageUrl = imageData.images?.[0] || 'placeholder_image_url'
        if (lastBlockId && lastBlockType === MessageBlockType.IMAGE) {
          const changes: Partial<ImageMessageBlock> = {
            url: imageUrl,
            metadata: { generateImageResponse: imageData },
            status: MessageBlockStatus.SUCCESS
          }
          dispatch(updateOneBlock({ id: lastBlockId, changes }))
          saveUpdatedBlockToDB(lastBlockId, assistantMsgId, topicId, getState)
        } else {
          console.error('[onImageGenerated] Last block was not an Image block or ID is missing.')
        }
      },
      onError: async (error) => {
        cancelThrottledBlockUpdate()
        console.dir(error, { depth: null })
        const isErrorTypeAbort = isAbortError(error)
        let pauseErrorLanguagePlaceholder = ''
        if (isErrorTypeAbort) {
          pauseErrorLanguagePlaceholder = 'pause_placeholder'
        }

        const serializableError = {
          name: error.name,
          message: pauseErrorLanguagePlaceholder || error.message || 'Stream processing error',
          originalMessage: error.message,
          stack: error.stack,
          status: error.status || error.code,
          requestId: error.request_id
        }
        if (lastBlockId) {
          // 更改上一个block的状态为ERROR
          const changes: Partial<MessageBlock> = {
            status: isErrorTypeAbort ? MessageBlockStatus.PAUSED : MessageBlockStatus.ERROR
          }
          dispatch(updateOneBlock({ id: lastBlockId, changes }))
          saveUpdatedBlockToDB(lastBlockId, assistantMsgId, topicId, getState)
        }

        const errorBlock = createErrorBlock(assistantMsgId, serializableError, { status: MessageBlockStatus.SUCCESS })
        await handleBlockTransition(errorBlock, MessageBlockType.ERROR)
        const messageErrorUpdate = {
          status: isErrorTypeAbort ? AssistantMessageStatus.SUCCESS : AssistantMessageStatus.ERROR
        }
        dispatch(newMessagesActions.updateMessage({ topicId, messageId: assistantMsgId, updates: messageErrorUpdate }))

        saveUpdatesToDB(assistantMsgId, topicId, messageErrorUpdate, [])

        EventEmitter.emit(EVENT_NAMES.MESSAGE_COMPLETE, {
          id: assistantMsgId,
          topicId,
          status: isErrorTypeAbort ? 'pause' : 'error',
          error: error.message
        })
      },
      onComplete: async (status: AssistantMessageStatus, response?: Response) => {
        cancelThrottledBlockUpdate()

        const finalStateOnComplete = getState()
        const finalAssistantMsg = finalStateOnComplete.messages.entities[assistantMsgId]

        if (status === 'success' && finalAssistantMsg) {
          const userMsgId = finalAssistantMsg.askId
          const orderedMsgs = selectMessagesForTopic(finalStateOnComplete, topicId)
          const userMsgIndex = orderedMsgs.findIndex((m) => m.id === userMsgId)
          const contextForUsage = userMsgIndex !== -1 ? orderedMsgs.slice(0, userMsgIndex + 1) : []
          const finalContextWithAssistant = [...contextForUsage, finalAssistantMsg]

          if (lastBlockId) {
            const changes: Partial<MessageBlock> = {
              status: MessageBlockStatus.SUCCESS
            }
            dispatch(updateOneBlock({ id: lastBlockId, changes }))
            saveUpdatedBlockToDB(lastBlockId, assistantMsgId, topicId, getState)
          }

          // 更新topic的name
          autoRenameTopic(assistant, topicId)

          if (response && response.usage?.total_tokens === 0) {
            const usage = await estimateMessagesUsage({ assistant, messages: finalContextWithAssistant })
            response.usage = usage
          }
        }
        if (response && response.metrics) {
          if (response.metrics.completion_tokens === 0 && response.usage?.completion_tokens) {
            response = {
              ...response,
              metrics: {
                ...response.metrics,
                completion_tokens: response.usage.completion_tokens
              }
            }
          }
        }

        const messageUpdates: Partial<Message> = { status, metrics: response?.metrics, usage: response?.usage }
        dispatch(
          newMessagesActions.updateMessage({
            topicId,
            messageId: assistantMsgId,
            updates: messageUpdates
          })
        )
        saveUpdatesToDB(assistantMsgId, topicId, messageUpdates, [])

        EventEmitter.emit(EVENT_NAMES.MESSAGE_COMPLETE, { id: assistantMsgId, topicId, status })
      }
    }

    const streamProcessorCallbacks = createStreamProcessor(callbacks)

    await fetchChatCompletion({
      messages: messagesForContext,
      assistant: assistant,
      onChunkReceived: streamProcessorCallbacks
    })
  } catch (error: any) {
    console.error('Error fetching chat completion:', error)
    if (assistantMessage) {
      callbacks.onError?.(error)
      throw error
    }
  }
}

/**
 * 发送消息并处理助手回复
 * @param userMessage 已创建的用户消息
 * @param userMessageBlocks 用户消息关联的消息块
 * @param assistant 助手对象
 * @param topicId 主题ID
 */
export const sendMessage =
  (userMessage: Message, userMessageBlocks: MessageBlock[], assistant: Assistant, topicId: Topic['id']) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    try {
      if (userMessage.blocks.length === 0) {
        console.warn('sendMessage: No blocks in the provided message.')
        return
      }
      await saveMessageAndBlocksToDB(userMessage, userMessageBlocks)
      dispatch(newMessagesActions.addMessage({ topicId, message: userMessage }))
      if (userMessageBlocks.length > 0) {
        dispatch(upsertManyBlocks(userMessageBlocks))
      }

      const mentionedModels = userMessage.mentions
      const queue = getTopicQueue(topicId)

      if (mentionedModels && mentionedModels.length > 0) {
        await dispatchMultiModelResponses(dispatch, getState, topicId, userMessage, assistant, mentionedModels)
      } else {
        const assistantMessage = createAssistantMessage(assistant.id, topicId, {
          askId: userMessage.id,
          model: assistant.model
        })
        await saveMessageAndBlocksToDB(assistantMessage, [])
        dispatch(newMessagesActions.addMessage({ topicId, message: assistantMessage }))

        queue.add(async () => {
          await fetchAndProcessAssistantResponseImpl(dispatch, getState, topicId, assistant, assistantMessage)
        })
      }
    } catch (error) {
      console.error('Error in sendMessage thunk:', error)
    } finally {
      handleChangeLoadingOfTopic(topicId)
    }
  }

/**
 * Loads messages and their blocks for a specific topic from the database
 * and updates the Redux store.
 */
export const loadTopicMessagesThunk =
  (topicId: string, forceReload: boolean = false) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState()
    const topicMessagesExist = !!state.messages.messageIdsByTopic[topicId]
    dispatch(newMessagesActions.setCurrentTopicId(topicId))

    if (topicMessagesExist && !forceReload) {
      return
    }

    try {
      const topic = await db.topics.get(topicId)
      if (!topic) {
        await db.topics.add({ id: topicId, messages: [] })
      }

      const messagesFromDB = topic?.messages || []

      if (messagesFromDB.length > 0) {
        const messageIds = messagesFromDB.map((m) => m.id)
        const blocks = await db.message_blocks.where('messageId').anyOf(messageIds).toArray()

        if (blocks && blocks.length > 0) {
          dispatch(upsertManyBlocks(blocks))
        }
        const messagesWithBlockIds = messagesFromDB.map((m) => ({
          ...m,
          blocks: m.blocks?.map(String) || []
        }))
        dispatch(newMessagesActions.messagesReceived({ topicId, messages: messagesWithBlockIds }))
      } else {
        dispatch(newMessagesActions.messagesReceived({ topicId, messages: [] }))
      }
    } catch (error: any) {
      console.error(`[loadTopicMessagesThunk] Failed to load messages for topic ${topicId}:`, error)
      // dispatch(newMessagesActions.setTopicLoading({ topicId, loading: false }))
    }
  }

/**
 * Thunk to delete a single message and its associated blocks.
 */
export const deleteSingleMessageThunk =
  (topicId: string, messageId: string) => async (dispatch: AppDispatch, getState: () => RootState) => {
    const currentState = getState()
    const messageToDelete = currentState.messages.entities[messageId]
    if (!messageToDelete || messageToDelete.topicId !== topicId) {
      console.error(`[deleteSingleMessage] Message ${messageId} not found in topic ${topicId}.`)
      return
    }

    const blockIdsToDelete = messageToDelete.blocks || []

    try {
      dispatch(newMessagesActions.removeMessage({ topicId, messageId }))
      dispatch(removeManyBlocks(blockIdsToDelete))
      await db.message_blocks.bulkDelete(blockIdsToDelete)
      const topic = await db.topics.get(topicId)
      if (topic) {
        const finalMessagesToSave = selectMessagesForTopic(getState(), topicId)
        await db.topics.update(topicId, { messages: finalMessagesToSave })
      }
    } catch (error) {
      console.error(`[deleteSingleMessage] Failed to delete message ${messageId}:`, error)
    }
  }

/**
 * Thunk to delete a group of messages (user query + assistant responses) based on askId.
 */
export const deleteMessageGroupThunk =
  (topicId: string, askId: string) => async (dispatch: AppDispatch, getState: () => RootState) => {
    const currentState = getState()
    const topicMessageIds = currentState.messages.messageIdsByTopic[topicId] || []
    const messagesToDelete: Message[] = []

    topicMessageIds.forEach((id) => {
      const msg = currentState.messages.entities[id]
      if (msg && msg.askId === askId) {
        messagesToDelete.push(msg)
      }
    })

    // const userQuery = currentState.messages.entities[askId]
    // if (userQuery && userQuery.topicId === topicId && !idsToDelete.includes(askId)) {
    //   messagesToDelete.push(userQuery)
    //   idsToDelete.push(askId)
    // }

    if (messagesToDelete.length === 0) {
      console.warn(`[deleteMessageGroup] No messages found with askId ${askId} in topic ${topicId}.`)
      return
    }

    const blockIdsToDelete = messagesToDelete.flatMap((m) => m.blocks || [])

    try {
      dispatch(newMessagesActions.removeMessagesByAskId({ topicId, askId }))
      dispatch(removeManyBlocks(blockIdsToDelete))
      await db.message_blocks.bulkDelete(blockIdsToDelete)
      const topic = await db.topics.get(topicId)
      if (topic) {
        const finalMessagesToSave = selectMessagesForTopic(getState(), topicId)
        await db.topics.update(topicId, { messages: finalMessagesToSave })
      }
    } catch (error) {
      console.error(`[deleteMessageGroup] Failed to delete messages with askId ${askId}:`, error)
    }
  }

/**
 * Thunk to clear all messages and associated blocks for a topic.
 */
export const clearTopicMessagesThunk =
  (topicId: string) => async (dispatch: AppDispatch, getState: () => RootState) => {
    try {
      const state = getState()
      const messageIdsToClear = state.messages.messageIdsByTopic[topicId] || []
      const blockIdsToDeleteSet = new Set<string>()

      messageIdsToClear.forEach((messageId) => {
        const message = state.messages.entities[messageId]
        message?.blocks?.forEach((blockId) => blockIdsToDeleteSet.add(blockId))
      })

      const blockIdsToDelete = Array.from(blockIdsToDeleteSet)

      dispatch(newMessagesActions.clearTopicMessages(topicId))
      if (blockIdsToDelete.length > 0) {
        dispatch(removeManyBlocks(blockIdsToDelete))
      }

      await db.topics.update(topicId, { messages: [] })
      if (blockIdsToDelete.length > 0) {
        await db.message_blocks.bulkDelete(blockIdsToDelete)
      }
    } catch (error) {
      console.error(`[clearTopicMessagesThunk] Failed to clear messages for topic ${topicId}:`, error)
    }
  }

/**
 * Thunk to resend a user message by regenerating its associated assistant responses.
 * Finds all assistant messages responding to the given user message, resets them,
 * and queues them for regeneration without deleting other messages.
 */
export const resendMessageThunk =
  (topicId: Topic['id'], userMessageToResend: Message, assistant: Assistant) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    try {
      const state = getState()
      // Use selector to get all messages for the topic
      const allMessagesForTopic = selectMessagesForTopic(state, topicId)

      // Filter to find the assistant messages to reset
      const assistantMessagesToReset = allMessagesForTopic.filter(
        (m) => m.askId === userMessageToResend.id && m.role === 'assistant'
      )

      const resetDataList: Message[] = []

      if (assistantMessagesToReset.length === 0) {
        // 没有用户消息,就创建一个或多个

        if (userMessageToResend?.mentions?.length) {
          console.log('userMessageToResend.mentions', userMessageToResend.mentions)
          for (const mention of userMessageToResend.mentions) {
            const assistantMessage = createAssistantMessage(assistant.id, topicId, {
              askId: userMessageToResend.id,
              model: mention,
              modelId: mention.id
            })
            resetDataList.push(assistantMessage)
          }
        } else {
          const assistantMessage = createAssistantMessage(assistant.id, topicId, {
            askId: userMessageToResend.id,
            model: assistant.model
          })
          resetDataList.push(assistantMessage)
        }

        resetDataList.forEach((message) => {
          dispatch(newMessagesActions.addMessage({ topicId, message }))
        })
      }

      const allBlockIdsToDelete: string[] = []
      const messagesToUpdateInRedux: { topicId: string; messageId: string; updates: Partial<Message> }[] = []

      for (const originalMsg of assistantMessagesToReset) {
        const blockIdsToDelete = [...(originalMsg.blocks || [])]
        const resetMsg = resetAssistantMessage(originalMsg, {
          status: AssistantMessageStatus.PENDING,
          updatedAt: new Date().toISOString(),
          ...(assistantMessagesToReset.length === 1 ? { model: assistant.model } : {})
        })

        resetDataList.push(resetMsg)
        allBlockIdsToDelete.push(...blockIdsToDelete)
        messagesToUpdateInRedux.push({ topicId, messageId: resetMsg.id, updates: resetMsg })
      }

      messagesToUpdateInRedux.forEach((update) => dispatch(newMessagesActions.updateMessage(update)))
      if (allBlockIdsToDelete.length > 0) {
        dispatch(removeManyBlocks(allBlockIdsToDelete))
      }

      try {
        if (allBlockIdsToDelete.length > 0) {
          await db.message_blocks.bulkDelete(allBlockIdsToDelete)
        }
        const finalMessagesToSave = selectMessagesForTopic(getState(), topicId)
        await db.topics.update(topicId, { messages: finalMessagesToSave })
      } catch (dbError) {
        console.error('[resendMessageThunk] Error updating database:', dbError)
      }

      const queue = getTopicQueue(topicId)
      for (const resetMsg of resetDataList) {
        const assistantConfigForThisRegen = {
          ...assistant,
          ...(resetMsg.model ? { model: resetMsg.model } : {})
        }
        queue.add(async () => {
          await fetchAndProcessAssistantResponseImpl(dispatch, getState, topicId, assistantConfigForThisRegen, resetMsg)
        })
      }
    } catch (error) {
      console.error(`[resendMessageThunk] Error resending user message ${userMessageToResend.id}:`, error)
    } finally {
      handleChangeLoadingOfTopic(topicId)
    }
  }

/**
 * Thunk to resend a user message after its content has been edited.
 * Updates the user message's text block and then triggers the regeneration
 * of its associated assistant responses using resendMessageThunk.
 */
export const resendUserMessageWithEditThunk =
  (topicId: Topic['id'], originalMessage: Message, assistant: Assistant) => async (dispatch: AppDispatch) => {
    // Trigger the regeneration logic for associated assistant messages
    dispatch(resendMessageThunk(topicId, originalMessage, assistant))
  }

/**
 * Thunk to regenerate a specific assistant response.
 */
export const regenerateAssistantResponseThunk =
  (topicId: Topic['id'], assistantMessageToRegenerate: Message, assistant: Assistant) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    try {
      const state = getState()

      // 1. Use selector to get all messages for the topic
      const allMessagesForTopic = selectMessagesForTopic(state, topicId)

      // 2. Find the original user query (Restored Logic)
      const originalUserQuery = allMessagesForTopic.find((m) => m.id === assistantMessageToRegenerate.askId)
      if (!originalUserQuery) {
        console.error(
          `[regenerateAssistantResponseThunk] Original user query (askId: ${assistantMessageToRegenerate.askId}) not found for assistant message ${assistantMessageToRegenerate.id}. Cannot regenerate.`
        )
        return
      }

      // 3. Verify the assistant message itself exists in entities
      const messageToResetEntity = state.messages.entities[assistantMessageToRegenerate.id]
      if (!messageToResetEntity) {
        // No need to check topicId again as selector implicitly handles it
        console.error(
          `[regenerateAssistantResponseThunk] Assistant message ${assistantMessageToRegenerate.id} not found in entities despite being in the topic list. State might be inconsistent.`
        )
        return
      }

      // 4. Get Block IDs to delete
      const blockIdsToDelete = [...(messageToResetEntity.blocks || [])]

      // 5. Reset the message entity in Redux
      const resetAssistantMsg = resetAssistantMessage(
        messageToResetEntity,
        // Grouped message (mentioned model message) should not reset model and modelId, always use the original model
        assistantMessageToRegenerate.modelId
          ? {
              status: AssistantMessageStatus.PENDING,
              updatedAt: new Date().toISOString()
            }
          : {
              status: AssistantMessageStatus.PENDING,
              updatedAt: new Date().toISOString(),
              model: assistant.model
            }
      )

      dispatch(
        newMessagesActions.updateMessage({
          topicId,
          messageId: resetAssistantMsg.id,
          updates: resetAssistantMsg
        })
      )

      // 6. Remove old blocks from Redux
      if (blockIdsToDelete.length > 0) {
        dispatch(removeManyBlocks(blockIdsToDelete))
      }

      // 7. Update DB: Save the reset message state within the topic and delete old blocks
      // Fetch the current state *after* Redux updates to get the latest message list
      // Use the selector to get the final ordered list of messages for the topic
      const finalMessagesToSave = selectMessagesForTopic(getState(), topicId)

      await db.transaction('rw', db.topics, db.message_blocks, async () => {
        // Use the result from the selector to update the DB
        await db.topics.update(topicId, { messages: finalMessagesToSave })
        if (blockIdsToDelete.length > 0) {
          await db.message_blocks.bulkDelete(blockIdsToDelete)
        }
      })

      // 8. Add fetch/process call to the queue
      const queue = getTopicQueue(topicId)
      const assistantConfigForRegen = {
        ...assistant,
        ...(resetAssistantMsg.model ? { model: resetAssistantMsg.model } : {})
      }
      queue.add(async () => {
        await fetchAndProcessAssistantResponseImpl(
          dispatch,
          getState,
          topicId,
          assistantConfigForRegen,
          resetAssistantMsg
        )
      })
    } catch (error) {
      console.error(
        `[regenerateAssistantResponseThunk] Error regenerating response for assistant message ${assistantMessageToRegenerate.id}:`,
        error
      )
      dispatch(newMessagesActions.setTopicLoading({ topicId, loading: false }))
    } finally {
      handleChangeLoadingOfTopic(topicId)
    }
  }

// --- Thunk to initiate translation and create the initial block ---
export const initiateTranslationThunk =
  (
    messageId: string,
    topicId: string,
    targetLanguage: string,
    sourceBlockId?: string, // Optional: If known
    sourceLanguage?: string // Optional: If known
  ) =>
  async (dispatch: AppDispatch, getState: () => RootState): Promise<string | undefined> => {
    // Return the new block ID
    try {
      const state = getState()
      const originalMessage = state.messages.entities[messageId]

      if (!originalMessage) {
        console.error(`[initiateTranslationThunk] Original message ${messageId} not found.`)
        return undefined
      }

      // 1. Create the initial translation block (streaming state)
      const newBlock = createTranslationBlock(
        messageId,
        '', // Start with empty content
        targetLanguage,
        {
          status: MessageBlockStatus.STREAMING, // Set to STREAMING
          sourceBlockId,
          sourceLanguage
        }
      )

      // 2. Update Redux State
      const updatedBlockIds = [...(originalMessage.blocks || []), newBlock.id]
      dispatch(upsertOneBlock(newBlock)) // Add the new block
      dispatch(
        newMessagesActions.updateMessage({
          topicId,
          messageId,
          updates: { blocks: updatedBlockIds } // Update message's block list
        })
      )

      // 3. Update Database
      // Get the final message list from Redux state *after* updates
      const finalMessagesToSave = selectMessagesForTopic(getState(), topicId)

      await db.transaction('rw', db.topics, db.message_blocks, async () => {
        await db.message_blocks.put(newBlock) // Save the initial block
        await db.topics.update(topicId, { messages: finalMessagesToSave }) // Save updated message list
      })
      return newBlock.id // Return the ID
    } catch (error) {
      console.error(`[initiateTranslationThunk] Failed for message ${messageId}:`, error)
      return undefined
      // Optional: Dispatch an error action or show notification
    }
  }

// --- Thunk to update the translation block with new content ---
export const updateTranslationBlockThunk =
  (blockId: string, accumulatedText: string, isComplete: boolean = false) =>
  async (dispatch: AppDispatch) => {
    // Logger.log(`[updateTranslationBlockThunk] 更新翻译块 ${blockId}, isComplete: ${isComplete}`)
    try {
      const status = isComplete ? MessageBlockStatus.SUCCESS : MessageBlockStatus.STREAMING
      const changes: Partial<MessageBlock> = {
        content: accumulatedText,
        status: status
      }

      // 更新Redux状态
      dispatch(updateOneBlock({ id: blockId, changes }))

      // 更新数据库
      await db.message_blocks.update(blockId, changes)
      // Logger.log(`[updateTranslationBlockThunk] Successfully updated translation block ${blockId}.`)
    } catch (error) {
      console.error(`[updateTranslationBlockThunk] Failed to update translation block ${blockId}:`, error)
    }
  }

/**
 * Thunk to append a new assistant response (using a potentially different model)
 * in reply to the same user query as an existing assistant message.
 */
export const appendAssistantResponseThunk =
  (
    topicId: Topic['id'],
    existingAssistantMessageId: string, // ID of the assistant message the user interacted with
    newModel: Model, // The new model selected by the user
    assistant: Assistant // Base assistant configuration
  ) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    try {
      const state = getState()

      // 1. Find the existing assistant message to get the original askId
      const existingAssistantMsg = state.messages.entities[existingAssistantMessageId]
      if (!existingAssistantMsg) {
        console.error(
          `[appendAssistantResponseThunk] Existing assistant message ${existingAssistantMessageId} not found.`
        )
        return // Stop if the reference message doesn't exist
      }
      if (existingAssistantMsg.role !== 'assistant') {
        console.error(
          `[appendAssistantResponseThunk] Message ${existingAssistantMessageId} is not an assistant message.`
        )
        return // Ensure it's an assistant message
      }
      const askId = existingAssistantMsg.askId
      if (!askId) {
        console.error(
          `[appendAssistantResponseThunk] Existing assistant message ${existingAssistantMessageId} does not have an askId.`
        )
        return // Stop if askId is missing
      }

      // (Optional but recommended) Verify the original user query exists
      if (!state.messages.entities[askId]) {
        console.warn(
          `[appendAssistantResponseThunk] Original user query (askId: ${askId}) not found in entities. Proceeding, but state might be inconsistent.`
        )
        // Decide whether to proceed or return based on requirements
      }

      // 2. Create the new assistant message stub
      const newAssistantStub = createAssistantMessage(assistant.id, topicId, {
        askId: askId, // Crucial: Use the original askId
        model: newModel,
        modelId: newModel.id
      })

      // 3. Update Redux Store
      dispatch(newMessagesActions.addMessage({ topicId, message: newAssistantStub }))

      // 4. Update Database (Save the stub to the topic's message list)
      await saveMessageAndBlocksToDB(newAssistantStub, [])

      // 5. Prepare and queue the processing task
      const assistantConfigForThisCall = {
        ...assistant,
        model: newModel
      }
      const queue = getTopicQueue(topicId)
      queue.add(async () => {
        await fetchAndProcessAssistantResponseImpl(
          dispatch,
          getState,
          topicId,
          assistantConfigForThisCall,
          newAssistantStub // Pass the newly created stub
        )
      })
    } catch (error) {
      console.error(`[appendAssistantResponseThunk] Error appending assistant response:`, error)
      // Optionally dispatch an error action or notification
      // Resetting loading state should be handled by the underlying fetchAndProcessAssistantResponseImpl
    } finally {
      handleChangeLoadingOfTopic(topicId)
    }
  }

/**
 * Clones messages from a source topic up to a specified index into a *pre-existing* new topic.
 * Generates new unique IDs for all cloned messages and blocks.
 * Updates the DB and Redux message/block state for the new topic.
 * Assumes the newTopic object already exists in Redux topic state and DB.
 * @param sourceTopicId The ID of the topic to branch from.
 * @param branchPointIndex The index *after* which messages should NOT be copied (slice endpoint).
 * @param newTopic The newly created Topic object (created and added to Redux/DB by the caller).
 */
export const cloneMessagesToNewTopicThunk =
  (
    sourceTopicId: string,
    branchPointIndex: number,
    newTopic: Topic // Receive newTopic object
  ) =>
  async (dispatch: AppDispatch, getState: () => RootState): Promise<boolean> => {
    if (!newTopic || !newTopic.id) {
      console.error(`[cloneMessagesToNewTopicThunk] Invalid newTopic provided.`)
      return false
    }
    try {
      const state = getState()
      const sourceMessages = selectMessagesForTopic(state, sourceTopicId)

      if (!sourceMessages || sourceMessages.length === 0) {
        console.error(`[cloneMessagesToNewTopicThunk] Source topic ${sourceTopicId} not found or is empty.`)
        return false
      }

      // 1. Slice messages to clone
      const messagesToClone = sourceMessages.slice(0, branchPointIndex)
      if (messagesToClone.length === 0) {
        console.warn(`[cloneMessagesToNewTopicThunk] No messages to branch (index ${branchPointIndex}).`)
        return true // Nothing to clone, operation considered successful but did nothing.
      }

      // 2. Prepare for cloning: Maps and Arrays
      const clonedMessages: Message[] = []
      const clonedBlocks: MessageBlock[] = []
      const filesToUpdateCount: FileType[] = []
      const originalToNewMsgIdMap = new Map<string, string>() // Map original message ID -> new message ID

      // 3. Clone Messages and Blocks with New IDs
      for (const oldMessage of messagesToClone) {
        const newMsgId = uuidv4()
        originalToNewMsgIdMap.set(oldMessage.id, newMsgId) // Store mapping for all cloned messages

        let newAskId: string | undefined = undefined // Initialize newAskId
        if (oldMessage.role === 'assistant' && oldMessage.askId) {
          // If it's an assistant message with an askId, find the NEW ID of the user message it references
          const mappedNewAskId = originalToNewMsgIdMap.get(oldMessage.askId)
          if (mappedNewAskId) {
            newAskId = mappedNewAskId // Use the new ID
          } else {
            // This happens if the user message corresponding to askId was *before* the branch point index
            // and thus wasn't included in messagesToClone or the map.
            // In this case, the link is broken in the new topic.
            console.warn(
              `[cloneMessages] Could not find new ID mapping for original askId ${oldMessage.askId} (likely outside branch). Setting askId to undefined for new assistant message ${newMsgId}.`
            )
            // newAskId remains undefined
          }
        }

        // --- Clone Blocks ---
        const newBlockIds: string[] = []
        if (oldMessage.blocks && oldMessage.blocks.length > 0) {
          for (const oldBlockId of oldMessage.blocks) {
            const oldBlock = state.messageBlocks.entities[oldBlockId]
            if (oldBlock) {
              const newBlockId = uuidv4()
              const newBlock: MessageBlock = {
                ...oldBlock,
                id: newBlockId,
                messageId: newMsgId // Link block to the NEW message ID
              }
              clonedBlocks.push(newBlock)
              newBlockIds.push(newBlockId)

              if (newBlock.type === MessageBlockType.FILE || newBlock.type === MessageBlockType.IMAGE) {
                const fileInfo = (newBlock as FileMessageBlock | ImageMessageBlock).file
                if (fileInfo) {
                  filesToUpdateCount.push(fileInfo)
                }
              }
            } else {
              console.warn(
                `[cloneMessagesToNewTopicThunk] Block ${oldBlockId} not found in state for message ${oldMessage.id}. Skipping block clone.`
              )
            }
          }
        }

        // --- Create New Message Object ---
        const newMessage: Message = {
          ...oldMessage,
          id: newMsgId,
          topicId: newTopic.id, // Use the NEW topic ID provided
          blocks: newBlockIds // Use the NEW block IDs
        }
        if (newMessage.role === 'assistant') {
          newMessage.askId = newAskId // Use the mapped/updated askId
        }
        clonedMessages.push(newMessage)
      }

      // 4. Update Database (Atomic Transaction)
      await db.transaction('rw', db.topics, db.message_blocks, db.files, async () => {
        // Update the NEW topic with the cloned messages
        // Assumes topic entry was added by caller, so we UPDATE.
        await db.topics.put({ id: newTopic.id, messages: clonedMessages })

        // Add the NEW blocks
        if (clonedBlocks.length > 0) {
          await db.message_blocks.bulkAdd(clonedBlocks)
        }
        // Update file counts
        const uniqueFiles = [...new Map(filesToUpdateCount.map((f) => [f.id, f])).values()]
        for (const file of uniqueFiles) {
          await db.files
            .where('id')
            .equals(file.id)
            .modify((f) => {
              if (f) {
                // Ensure file exists before modifying
                f.count = (f.count || 0) + 1
              }
            })
        }
      })

      // --- Update Redux State ---
      dispatch(newMessagesActions.messagesReceived({ topicId: newTopic.id, messages: clonedMessages }))
      if (clonedBlocks.length > 0) {
        dispatch(upsertManyBlocks(clonedBlocks))
      }

      return true // Indicate success
    } catch (error) {
      console.error(`[cloneMessagesToNewTopicThunk] Failed to clone messages:`, error)
      return false // Indicate failure
    }
  }

/**
 * Thunk to edit properties of a message and/or its associated blocks.
 * Updates Redux state and persists changes to the database within a transaction.
 * Message updates are optional if only blocks need updating.
 */
export const updateMessageAndBlocksThunk =
  (
    topicId: string,
    // Allow messageUpdates to be optional or just contain the ID if only blocks are updated
    messageUpdates: (Partial<Message> & Pick<Message, 'id'>) | null, // ID is always required for context
    blockUpdatesList: MessageBlock[] // Block updates remain required for this thunk's purpose
  ) =>
  async (dispatch: AppDispatch): Promise<void> => {
    const messageId = messageUpdates?.id

    if (messageUpdates && !messageId) {
      console.error('[updateMessageAndUpdateBlocksThunk] Message ID is required.')
      return
    }

    try {
      // 1. 更新 Redux Store
      if (messageUpdates && messageId) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: msgId, ...actualMessageChanges } = messageUpdates // Separate ID from actual changes

        // Only dispatch message update if there are actual changes beyond the ID
        if (Object.keys(actualMessageChanges).length > 0) {
          dispatch(newMessagesActions.updateMessage({ topicId, messageId, updates: actualMessageChanges }))
        }
      }

      if (blockUpdatesList.length > 0) {
        dispatch(upsertManyBlocks(blockUpdatesList))
      }

      // 2. 更新数据库 (在事务中)
      await db.transaction('rw', db.topics, db.message_blocks, async () => {
        // Only update topic.messages if there were actual message changes
        if (messageUpdates && Object.keys(messageUpdates).length > 0) {
          const topic = await db.topics.get(topicId)
          if (topic && topic.messages) {
            const messageIndex = topic.messages.findIndex((m) => m.id === messageId)
            if (messageIndex !== -1) {
              Object.assign(topic.messages[messageIndex], messageUpdates)
              await db.topics.update(topicId, { messages: topic.messages })
            } else {
              console.error(
                `[updateMessageAndBlocksThunk] Message ${messageId} not found in DB topic ${topicId} for property update.`
              )
              throw new Error(`Message ${messageId} not found in DB topic ${topicId} for property update.`)
            }
          } else {
            console.error(
              `[updateMessageAndBlocksThunk] Topic ${topicId} not found or empty for message property update.`
            )
            throw new Error(`Topic ${topicId} not found or empty for message property update.`)
          }
        }

        if (blockUpdatesList.length > 0) {
          await db.message_blocks.bulkPut(blockUpdatesList)
        }
      })
    } catch (error) {
      console.error(`[updateMessageAndBlocksThunk] Failed to process updates for message ${messageId}:`, error)
    }
  }

export const removeBlocksThunk =
  (topicId: string, messageId: string, blockIdsToRemove: string[]) =>
  async (dispatch: AppDispatch, getState: () => RootState): Promise<void> => {
    if (!blockIdsToRemove.length) {
      console.warn('[removeBlocksFromMessageThunk] No block IDs provided to remove.')
      return
    }

    try {
      const state = getState()
      const message = state.messages.entities[messageId]

      if (!message) {
        console.error(`[removeBlocksFromMessageThunk] Message ${messageId} not found in state.`)
        return
      }
      const blockIdsToRemoveSet = new Set(blockIdsToRemove)

      const updatedBlockIds = (message.blocks || []).filter((id) => !blockIdsToRemoveSet.has(id))

      // 1. Update Redux state
      dispatch(newMessagesActions.updateMessage({ topicId, messageId, updates: { blocks: updatedBlockIds } }))

      if (blockIdsToRemove.length > 0) {
        dispatch(removeManyBlocks(blockIdsToRemove))
      }

      const finalMessagesToSave = selectMessagesForTopic(getState(), topicId)

      // 2. Update database (in a transaction)
      await db.transaction('rw', db.topics, db.message_blocks, async () => {
        // Update the message in the topic
        await db.topics.update(topicId, { messages: finalMessagesToSave })
        // Delete the blocks from the database
        if (blockIdsToRemove.length > 0) {
          await db.message_blocks.bulkDelete(blockIdsToRemove)
        }
      })

      return
    } catch (error) {
      console.error(`[removeBlocksFromMessageThunk] Failed to remove blocks from message ${messageId}:`, error)
      throw error
    }
  }
