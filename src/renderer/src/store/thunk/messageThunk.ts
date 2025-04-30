import db from '@renderer/databases'
import { autoRenameTopic } from '@renderer/hooks/useTopic'
import { fetchChatCompletion } from '@renderer/services/ApiService'
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
  console.log('topicId', topicId)
  await waitForTopicQueue(topicId)
  console.log('[DEBUG] Waiting for topic queue to complete')
  store.dispatch(newMessagesActions.setTopicLoading({ topicId, loading: false }))
}

const saveMessageAndBlocksToDB = async (message: Message, blocks: MessageBlock[]) => {
  try {
    console.log(`[DEBUG] saveMessageAndBlocksToDB started for message ${message.id} with ${blocks.length} blocks`)
    if (blocks.length > 0) {
      console.log('[DEBUG] Saving blocks to DB')
      await db.message_blocks.bulkPut(blocks)
      console.log('[DEBUG] Blocks saved to DB')
    }
    console.log('[DEBUG] Getting topic from DB')
    const topic = await db.topics.get(message.topicId)
    console.log('[DEBUG] Got topic from DB:', topic)
    if (topic) {
      const messageIndex = topic.messages.findIndex((m) => m.id === message.id)
      const updatedMessages = [...topic.messages]

      if (messageIndex !== -1) {
        updatedMessages[messageIndex] = message
      } else {
        updatedMessages.push(message)
      }
      console.log('[DEBUG] Updating topic in DB', updatedMessages)
      await db.topics.update(message.topicId, { messages: updatedMessages })
      console.log('[DEBUG] Topic updated in DB')
    } else {
      console.error(`[saveMessageAndBlocksToDB] Topic ${message.topicId} not found.`)
    }
    console.log(`[DEBUG] saveMessageAndBlocksToDB completed for message ${message.id}`)
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
const throttledBlockUpdate = throttle((id, blockUpdate) => {
  const state = store.getState()
  const block = state.messageBlocks.entities[id]
  // throttle是异步函数,可能会在complete事件触发后才执行
  if (
    blockUpdate.status === MessageBlockStatus.STREAMING &&
    (block?.status === MessageBlockStatus.SUCCESS || block?.status === MessageBlockStatus.ERROR)
  )
    return

  store.dispatch(updateOneBlock({ id, changes: blockUpdate }))
}, 150)

// 修改: 节流更新单个块的内容/状态到数据库 (仅用于 Text/Thinking Chunks)
export const throttledBlockDbUpdate = throttle(
  async (blockId: string, blockChanges: Partial<MessageBlock>) => {
    // Check if blockId is valid before attempting update
    if (!blockId) {
      console.warn('[DB Throttle Block Update] Attempted to update with null/undefined blockId. Skipping.')
      return
    }
    const state = store.getState()
    const block = state.messageBlocks.entities[blockId]
    // throttle是异步函数,可能会在complete事件触发后才执行
    if (
      blockChanges.status === MessageBlockStatus.STREAMING &&
      (block?.status === MessageBlockStatus.SUCCESS || block?.status === MessageBlockStatus.ERROR)
    )
      return
    console.log(`[DB Throttle Block Update] Updating block ${blockId} with changes:`, blockChanges)
    try {
      await db.message_blocks.update(blockId, blockChanges)
    } catch (error) {
      console.error(`[DB Throttle Block Update] Failed for block ${blockId}:`, error)
    }
  },
  300, // 可以调整节流间隔
  { leading: false, trailing: true }
)

// 新增: 通用的、非节流的函数，用于保存消息和块的更新到数据库
const saveUpdatesToDB = async (
  messageId: string,
  topicId: string,
  messageUpdates: Partial<Message>, // 需要更新的消息字段
  blocksToUpdate: MessageBlock[] // 需要更新/创建的块
) => {
  console.log(
    `[DB Save Updates] Triggered for message ${messageId}. MessageUpdates:`,
    messageUpdates,
    `BlocksToUpdate count: ${blocksToUpdate.length}`
  )
  try {
    const messageDataToSave: Partial<Message> & Pick<Message, 'id' | 'topicId'> = {
      id: messageId,
      topicId,
      ...messageUpdates
    }
    await updateExistingMessageAndBlocksInDB(messageDataToSave, blocksToUpdate)
    console.log(`[DB Save Updates] Successfully saved updates for message ${messageId}.`)
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
  console.log(`[DB Save Single Block] Attempting to save block ${blockId} for message ${messageId}`)
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
  console.log(
    `[DEBUG] dispatchMultiModelResponses called for ${mentionedModels.length} models, triggered by message ${triggeringMessage.id}.`
  )
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
    console.log('[DEBUG] Topic updated in DB successfully.')
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
  console.log('[DEBUG] fetchAndProcessAssistantResponseImpl started for existing message:', assistantMessage.id)
  const assistantMsgId = assistantMessage.id
  let callbacks: StreamProcessorCallbacks = {}
  try {
    console.log('[DEBUG] Setting topic loading state')
    dispatch(newMessagesActions.setTopicLoading({ topicId, loading: true }))

    let accumulatedContent = ''
    let accumulatedThinking = ''
    let lastBlockId: string | null = null
    let lastBlockType: MessageBlockType | null = null
    let citationBlockId: string | null = null
    let mainTextBlockId: string | null = null
    const toolCallIdToBlockIdMap = new Map<string, string>()

    const handleBlockTransition = (newBlock: MessageBlock, newBlockType: MessageBlockType) => {
      lastBlockId = newBlock.id
      lastBlockType = newBlockType
      if (newBlockType !== MessageBlockType.MAIN_TEXT) {
        accumulatedContent = ''
      }
      if (newBlockType !== MessageBlockType.THINKING) {
        accumulatedThinking = ''
      }
      console.log(`[Transition] Adding/Updating new ${newBlockType} block ${newBlock.id}.`)
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
        saveUpdatesToDB(assistantMsgId, topicId, { blocks: updatedMessage.blocks, status: updatedMessage.status }, [
          newBlock
        ])
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
      console.log('messagesForContext', messagesForContext)
      console.log(`[DEBUG] Context for message ${assistantMsgId}: ${messagesForContext.length} messages.`)
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
            throttledBlockDbUpdate(lastBlockId, blockChanges)
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
      onTextComplete: (finalText) => {
        if (lastBlockType === MessageBlockType.MAIN_TEXT && lastBlockId) {
          console.log(`[onTextComplete] Marking MAIN_TEXT block ${lastBlockId} as SUCCESS.`)
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
              handleBlockTransition(citationBlock, MessageBlockType.CITATION)
              saveUpdatedBlockToDB(citationBlock.id, assistantMsgId, topicId, getState)
            } else {
              console.log('[onTextComplete] No URLs found for OpenRouter citation.')
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
            console.log(`[onThinkingChunk] Saved initial THINKING block ${lastBlockId} to DB.`)
          } else if (lastBlockType === MessageBlockType.THINKING) {
            const blockChanges: Partial<MessageBlock> = {
              content: accumulatedThinking,
              status: MessageBlockStatus.STREAMING,
              thinking_millsec: thinking_millsec
            }
            throttledBlockUpdate(lastBlockId, blockChanges)
            throttledBlockDbUpdate(lastBlockId, blockChanges)
          } else {
            const newBlock = createThinkingBlock(assistantMsgId, accumulatedThinking, {
              status: MessageBlockStatus.STREAMING,
              thinking_millsec: thinking_millsec
            })
            handleBlockTransition(newBlock, MessageBlockType.THINKING)
          }
        }
      },
      onThinkingComplete: (finalText, final_thinking_millsec) => {
        if (lastBlockType === MessageBlockType.THINKING && lastBlockId) {
          console.log(`[onThinkingComplete] Marking THINKING block ${lastBlockId} as SUCCESS.`)
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
        if (toolResponse.status === 'invoking') {
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
        console.log('toolResponse', toolResponse, toolResponse.status)
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
          console.log(`[${toolResponse.status}] Updating ToolBlock ${existingBlockId} with changes:`, changes)
          dispatch(updateOneBlock({ id: existingBlockId, changes }))
          saveUpdatedBlockToDB(existingBlockId, assistantMsgId, topicId, getState)
        } else {
          console.warn(
            `[onToolCallComplete] Received unhandled tool status: ${toolResponse.status} for ID: ${toolResponse.id}`
          )
        }
      },
      onExternalToolInProgress: () => {
        console.log('onExternalToolInProgress received, creating placeholder CitationBlock.')
        const citationBlock = createCitationBlock(assistantMsgId, {}, { status: MessageBlockStatus.PROCESSING })
        citationBlockId = citationBlock.id
        handleBlockTransition(citationBlock, MessageBlockType.CITATION)
        saveUpdatedBlockToDB(citationBlock.id, assistantMsgId, topicId, getState)
      },
      onExternalToolComplete: (externalToolResult: ExternalToolResult) => {
        console.warn('onExternalToolComplete received.', externalToolResult)
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
      onLLMWebSearchComplete(llmWebSearchResult) {
        console.log('onLLMWebSearchComplete', llmWebSearchResult)
        if (citationBlockId) {
          console.log(`Updating existing citation block ${citationBlockId} with LLM search results.`)
          const changes: Partial<CitationMessageBlock> = {
            response: llmWebSearchResult,
            status: MessageBlockStatus.SUCCESS
          }
          dispatch(updateOneBlock({ id: citationBlockId, changes }))
          saveUpdatedBlockToDB(citationBlockId, assistantMsgId, topicId, getState)
        } else {
          console.log('Creating new citation block for LLM search results.')
          const citationBlock = createCitationBlock(
            assistantMsgId,
            { response: llmWebSearchResult },
            { status: MessageBlockStatus.SUCCESS }
          )
          citationBlockId = citationBlock.id
          handleBlockTransition(citationBlock, MessageBlockType.CITATION)
          if (mainTextBlockId) {
            const state = getState()
            const existingMainTextBlock = state.messageBlocks.entities[mainTextBlockId]
            if (existingMainTextBlock && existingMainTextBlock.type === MessageBlockType.MAIN_TEXT) {
              const currentRefs = existingMainTextBlock.citationReferences || []
              if (!currentRefs.some((ref) => ref.citationBlockId === citationBlockId)) {
                const mainTextChanges = { citationReferences: [...currentRefs, { citationBlockId }] }
                dispatch(updateOneBlock({ id: mainTextBlockId, changes: mainTextChanges }))
                saveUpdatedBlockToDB(mainTextBlockId, assistantMsgId, topicId, getState)
              }
            }
          }
        }
      },
      onImageCreated: () => {
        const imageBlock = createImageBlock(assistantMsgId, {
          status: MessageBlockStatus.PROCESSING
        })
        handleBlockTransition(imageBlock, MessageBlockType.IMAGE)
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
      onError: (error) => {
        console.dir(error, { depth: null })
        let pauseErrorLanguagePlaceholder = ''
        if (isAbortError(error)) {
          pauseErrorLanguagePlaceholder = 'pause_placeholder'
        }

        const serializableError = {
          name: error.name,
          message: pauseErrorLanguagePlaceholder || error.message || 'Stream processing error',
          originalMessage: error.message,
          stack: error.stack,
          status: error.status,
          requestId: error.request_id
        }
        if (lastBlockId) {
          // 更改上一个block的状态为ERROR
          const changes: Partial<MessageBlock> = {
            status: MessageBlockStatus.ERROR
          }
          dispatch(updateOneBlock({ id: lastBlockId, changes }))
          saveUpdatedBlockToDB(lastBlockId, assistantMsgId, topicId, getState)
        }

        const errorBlock = createErrorBlock(assistantMsgId, serializableError, { status: MessageBlockStatus.SUCCESS })
        handleBlockTransition(errorBlock, MessageBlockType.ERROR)

        const messageErrorUpdate = { status: AssistantMessageStatus.ERROR }
        dispatch(newMessagesActions.updateMessage({ topicId, messageId: assistantMsgId, updates: messageErrorUpdate }))

        saveUpdatesToDB(assistantMsgId, topicId, messageErrorUpdate, [])
      },
      onComplete: async (status: AssistantMessageStatus, response?: Response) => {
        const finalStateOnComplete = getState()
        const finalAssistantMsg = finalStateOnComplete.messages.entities[assistantMsgId]

        if (status === 'success' && finalAssistantMsg && response && !response?.usage) {
          const userMsgId = finalAssistantMsg.askId
          const orderedMsgs = selectMessagesForTopic(finalStateOnComplete, topicId)
          const userMsgIndex = orderedMsgs.findIndex((m) => m.id === userMsgId)
          const contextForUsage = userMsgIndex !== -1 ? orderedMsgs.slice(0, userMsgIndex + 1) : []
          const finalContextWithAssistant = [...contextForUsage, finalAssistantMsg]

          // 更新topic的name
          autoRenameTopic(assistant, topicId)

          const usage = await estimateMessagesUsage({ assistant, messages: finalContextWithAssistant })
          response.usage = usage
        }
        if (response && response.metrics) {
          if (!response.metrics.completion_tokens && response.usage) {
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
        console.log('Updating final message state in Redux:', { messageId: assistantMsgId, ...messageUpdates })
        dispatch(
          newMessagesActions.updateMessage({
            topicId,
            messageId: assistantMsgId,
            updates: messageUpdates
          })
        )

        saveUpdatesToDB(assistantMsgId, topicId, messageUpdates, [])
      }
    }

    console.log('[DEBUG] Creating stream processor')
    const streamProcessorCallbacks = createStreamProcessor(callbacks)

    console.log('[DEBUG] Calling fetchChatCompletion')
    await fetchChatCompletion({
      messages: messagesForContext,
      assistant: assistant,
      onChunkReceived: streamProcessorCallbacks
    })
    console.log('[DEBUG] fetchChatCompletion completed')
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
    console.log('[DEBUG] sendMessage thunk started')
    try {
      if (userMessage.blocks.length === 0) {
        console.warn('sendMessage: No blocks in the provided message.')
        return
      }
      console.log('sendMessage', userMessage)
      await saveMessageAndBlocksToDB(userMessage, userMessageBlocks)
      dispatch(newMessagesActions.addMessage({ topicId, message: userMessage }))
      if (userMessageBlocks.length > 0) {
        dispatch(upsertManyBlocks(userMessageBlocks))
      }
      console.log('[DEBUG] Saved user message successfully')

      const mentionedModels = userMessage.mentions
      const queue = getTopicQueue(topicId)

      if (mentionedModels && mentionedModels.length > 0) {
        console.log(`[DEBUG] Multi-model send detected for ${mentionedModels.length} models.`)
        await dispatchMultiModelResponses(dispatch, getState, topicId, userMessage, assistant, mentionedModels)
      } else {
        console.log('[DEBUG] Single-model send.')
        const assistantMessage = createAssistantMessage(assistant.id, topicId, {
          askId: userMessage.id,
          model: assistant.model
        })
        await saveMessageAndBlocksToDB(assistantMessage, [])
        dispatch(newMessagesActions.addMessage({ topicId, message: assistantMessage }))

        console.log('[DEBUG] Adding task to queue')
        queue.add(async () => {
          console.log('[DEBUG] Queue task started')
          await fetchAndProcessAssistantResponseImpl(dispatch, getState, topicId, assistant, assistantMessage)
          console.log('[DEBUG] fetchAndProcessAssistantResponseImpl completed')
        })
      }
    } catch (error) {
      console.error('Error in sendMessage thunk:', error)
    } finally {
      console.log('sendMessage finally', userMessage)
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

    if (topicMessagesExist && !forceReload) {
      return
    }

    try {
      const topic = await db.topics.get(topicId)
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
      console.log('deleteSingleMessageThunk', messageToDelete)
      dispatch(newMessagesActions.removeMessage({ topicId, messageId }))
      dispatch(removeManyBlocks(blockIdsToDelete))
      await db.message_blocks.bulkDelete(blockIdsToDelete)
      const topic = await db.topics.get(topicId)
      if (topic) {
        const finalMessagesToSave = selectMessagesForTopic(getState(), topicId)
        console.log('finalMessagesToSave', finalMessagesToSave)
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
    const idsToDelete: string[] = []

    topicMessageIds.forEach((id) => {
      const msg = currentState.messages.entities[id]
      if (msg && msg.askId === askId) {
        messagesToDelete.push(msg)
        idsToDelete.push(id)
      }
    })

    const userQuery = currentState.messages.entities[askId]
    if (userQuery && userQuery.topicId === topicId && !idsToDelete.includes(askId)) {
      messagesToDelete.push(userQuery)
      idsToDelete.push(askId)
    }

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
    console.log(
      `[resendMessageThunk] Regenerating responses for user message ${userMessageToResend.id} in topic ${topicId}`
    )
    try {
      const state = getState()
      // Use selector to get all messages for the topic
      const allMessagesForTopic = selectMessagesForTopic(state, topicId)

      // Filter to find the assistant messages to reset
      const assistantMessagesToReset = allMessagesForTopic.filter(
        (m) => m.askId === userMessageToResend.id && m.role === 'assistant'
      )

      if (assistantMessagesToReset.length === 0) {
        console.warn(
          `[resendMessageThunk] No assistant responses found for user message ${userMessageToResend.id}. Nothing to regenerate.`
        )
        return
      }

      console.log(
        `[resendMessageThunk] Found ${assistantMessagesToReset.length} assistant messages to reset and regenerate.`
      )

      const resetDataList: { resetMsg: Message }[] = []
      const allBlockIdsToDelete: string[] = []
      const messagesToUpdateInRedux: { topicId: string; messageId: string; updates: Partial<Message> }[] = []

      for (const originalMsg of assistantMessagesToReset) {
        const blockIdsToDelete = [...(originalMsg.blocks || [])]
        const resetMsg = resetAssistantMessage(originalMsg, {
          status: AssistantMessageStatus.PENDING
        })

        resetDataList.push({ resetMsg })
        allBlockIdsToDelete.push(...blockIdsToDelete)
        messagesToUpdateInRedux.push({ topicId, messageId: resetMsg.id, updates: resetMsg })
      }

      console.log('[resendMessageThunk] Updating Redux state...')
      messagesToUpdateInRedux.forEach((update) => dispatch(newMessagesActions.updateMessage(update)))
      if (allBlockIdsToDelete.length > 0) {
        dispatch(removeManyBlocks(allBlockIdsToDelete))
        console.log(`[resendMessageThunk] Removed ${allBlockIdsToDelete.length} old blocks from Redux.`)
      }

      console.log('[resendMessageThunk] Updating Database...')
      try {
        if (allBlockIdsToDelete.length > 0) {
          await db.message_blocks.bulkDelete(allBlockIdsToDelete)
          console.log(`[resendMessageThunk] Removed ${allBlockIdsToDelete.length} old blocks from DB.`)
        }
        const finalMessagesToSave = selectMessagesForTopic(getState(), topicId)
        await db.topics.update(topicId, { messages: finalMessagesToSave })
        console.log(`[resendMessageThunk] Updated DB topic ${topicId} with latest messages from Redux state.`)
      } catch (dbError) {
        console.error('[resendMessageThunk] Error updating database:', dbError)
      }

      console.log('[resendMessageThunk] Queueing regeneration tasks...')
      const queue = getTopicQueue(topicId)
      for (const { resetMsg } of resetDataList) {
        const assistantConfigForThisRegen = {
          ...assistant,
          ...(resetMsg.model ? { model: resetMsg.model } : {})
        }
        console.log(
          `[resendMessageThunk] Queueing task for message ${resetMsg.id} with model ${assistantConfigForThisRegen.model?.id}`
        )
        queue.add(async () => {
          await fetchAndProcessAssistantResponseImpl(dispatch, getState, topicId, assistantConfigForThisRegen, resetMsg)
        })
      }
      console.log(`[resendMessageThunk] Successfully queued ${resetDataList.length} regeneration tasks.`)
    } catch (error) {
      console.error(`[resendMessageThunk] Error resending user message ${userMessageToResend.id}:`, error)
    } finally {
      console.log('sendMessage finally', topicId)
      handleChangeLoadingOfTopic(topicId)
    }
  }

/**
 * Thunk to resend a user message after its content has been edited.
 * Updates the user message's text block and then triggers the regeneration
 * of its associated assistant responses using resendMessageThunk.
 */
export const resendUserMessageWithEditThunk =
  (
    topicId: Topic['id'],
    originalMessage: Message,
    mainTextBlockId: string,
    editedContent: string,
    assistant: Assistant
  ) =>
  async (dispatch: AppDispatch) => {
    console.log(
      `[resendUserMessageWithEditThunk] Updating block ${mainTextBlockId} for message ${originalMessage.id} and triggering regeneration.`
    )
    const blockChanges = {
      content: editedContent,
      updatedAt: new Date().toISOString()
    }
    console.log('[resendUserMessageWithEditThunk] Updating edited block...')
    // Update block in Redux and DB
    dispatch(updateOneBlock({ id: mainTextBlockId, changes: blockChanges }))
    await db.message_blocks.update(mainTextBlockId, blockChanges)
    console.log('[resendUserMessageWithEditThunk] Edited block updated successfully.')

    // Trigger the regeneration logic for associated assistant messages
    dispatch(resendMessageThunk(topicId, originalMessage, assistant))
    console.log('[resendUserMessageWithEditThunk] Regeneration process initiated by resendMessageThunk dispatch.')
  }

/**
 * Thunk to regenerate a specific assistant response.
 */
export const regenerateAssistantResponseThunk =
  (topicId: Topic['id'], assistantMessageToRegenerate: Message, assistant: Assistant) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    console.log(
      `[regenerateAssistantResponseThunk] Regenerating response for assistant message ${assistantMessageToRegenerate.id} in topic ${topicId}`
    )
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
      const resetAssistantMsg = resetAssistantMessage(messageToResetEntity, {
        status: AssistantMessageStatus.PENDING
      })
      console.log('resetAssistantMsg', resetAssistantMsg)
      dispatch(
        newMessagesActions.updateMessage({
          topicId,
          messageId: resetAssistantMsg.id,
          updates: resetAssistantMsg
        })
      )

      // 6. Remove old blocks from Redux
      if (blockIdsToDelete.length > 0) {
        console.log(`[regenerateAssistantResponseThunk] Removing ${blockIdsToDelete.length} old blocks from Redux.`)
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
      console.log('[regenerateAssistantResponseThunk] Updated DB with reset message and removed old blocks.')

      // 8. Add fetch/process call to the queue
      const queue = getTopicQueue(topicId)
      const assistantConfigForRegen = {
        ...assistant,
        ...(resetAssistantMsg.model ? { model: resetAssistantMsg.model } : {})
      }
      console.log(
        `[regenerateAssistantResponseThunk] Queueing task for message ${resetAssistantMsg.id} with model ${assistantConfigForRegen.model?.id}`
      )
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
      console.log('sendMessage finally', topicId)
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
    console.log(`[initiateTranslationThunk] Initiating translation block for message ${messageId}`)
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
      console.log(
        `[initiateTranslationThunk] Successfully initiated translation block ${newBlock.id} for message ${messageId}.`
      )
      return newBlock.id // Return the ID
    } catch (error) {
      console.error(`[initiateTranslationThunk] Failed for message ${messageId}:`, error)
      return undefined
      // Optional: Dispatch an error action or show notification
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
    console.log(
      `[appendAssistantResponseThunk] Appending response for topic ${topicId} based on message ${existingAssistantMessageId} with new model ${newModel.id}`
    )
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
      console.log(
        `[appendAssistantResponseThunk] Creating new assistant message stub for askId ${askId} with model ${newModel.id}`
      )
      const newAssistantStub = createAssistantMessage(assistant.id, topicId, {
        askId: askId, // Crucial: Use the original askId
        model: newModel,
        modelId: newModel.id
      })

      // 3. Update Redux Store
      console.log(`[appendAssistantResponseThunk] Adding new stub ${newAssistantStub.id} to Redux.`)
      dispatch(newMessagesActions.addMessage({ topicId, message: newAssistantStub }))

      // 4. Update Database (Save the stub to the topic's message list)
      console.log(`[appendAssistantResponseThunk] Saving new stub ${newAssistantStub.id} to DB.`)
      await saveMessageAndBlocksToDB(newAssistantStub, [])

      // 5. Prepare and queue the processing task
      const assistantConfigForThisCall = {
        ...assistant,
        model: newModel
      }
      const queue = getTopicQueue(topicId)
      console.log(`[appendAssistantResponseThunk] Adding task to queue for new stub ${newAssistantStub.id}`)
      queue.add(async () => {
        await fetchAndProcessAssistantResponseImpl(
          dispatch,
          getState,
          topicId,
          assistantConfigForThisCall,
          newAssistantStub // Pass the newly created stub
        )
      })

      console.log(
        `[appendAssistantResponseThunk] Successfully queued processing for new assistant message ${newAssistantStub.id}`
      )
    } catch (error) {
      console.error(`[appendAssistantResponseThunk] Error appending assistant response:`, error)
      // Optionally dispatch an error action or notification
      // Resetting loading state should be handled by the underlying fetchAndProcessAssistantResponseImpl
    } finally {
      console.log('sendMessage finally', topicId)
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
    console.log(
      `[cloneMessagesToNewTopicThunk] Cloning messages from topic ${sourceTopicId} to new topic ${newTopic.id} up to index ${branchPointIndex}`
    )
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
            console.log(`[cloneMessages] Mapped askId ${oldMessage.askId} to ${newAskId} for new message ${newMsgId}`)
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
      console.log(
        `[cloneMessagesToNewTopicThunk] Saving ${clonedMessages.length} cloned messages and ${clonedBlocks.length} blocks to DB for topic ${newTopic.id}`
      )
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
      console.log(`[cloneMessagesToNewTopicThunk] DB update complete for topic ${newTopic.id}.`)

      // --- Update Redux State ---
      console.log(`[cloneMessages] Updating Redux message/block state for new topic ${newTopic.id}.`)
      dispatch(newMessagesActions.messagesReceived({ topicId: newTopic.id, messages: clonedMessages }))
      if (clonedBlocks.length > 0) {
        dispatch(upsertManyBlocks(clonedBlocks))
      }

      console.log(`[cloneMessagesToNewTopicThunk] Message cloning successful for topic ${newTopic.id}`)
      return true // Indicate success
    } catch (error) {
      console.error(`[cloneMessagesToNewTopicThunk] Failed to clone messages:`, error)
      return false // Indicate failure
    }
  }
