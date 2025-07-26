import { loggerService } from '@logger'
import db from '@renderer/databases'
import { fetchChatCompletion } from '@renderer/services/ApiService'
import FileManager from '@renderer/services/FileManager'
import { BlockManager } from '@renderer/services/messageStreaming/BlockManager'
import { createCallbacks } from '@renderer/services/messageStreaming/callbacks'
import { endSpan } from '@renderer/services/SpanManagerService'
import { createStreamProcessor, type StreamProcessorCallbacks } from '@renderer/services/StreamProcessingService'
import store from '@renderer/store'
import { updateTopicUpdatedAt } from '@renderer/store/assistants'
import { type Assistant, type FileMetadata, type Model, type Topic } from '@renderer/types'
import type { FileMessageBlock, ImageMessageBlock, Message, MessageBlock } from '@renderer/types/newMessage'
import { AssistantMessageStatus, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { uuid } from '@renderer/utils'
import {
  createAssistantMessage,
  createTranslationBlock,
  resetAssistantMessage
} from '@renderer/utils/messageUtils/create'
import { buildSystemPrompt } from '@renderer/utils/prompt'
import { getTopicQueue } from '@renderer/utils/queue'
import { waitForTopicQueue } from '@renderer/utils/queue'
import { t } from 'i18next'
import { isEmpty, throttle } from 'lodash'
import { LRUCache } from 'lru-cache'

import type { AppDispatch, RootState } from '../index'
import { removeManyBlocks, updateOneBlock, upsertManyBlocks, upsertOneBlock } from '../messageBlock'
import { newMessagesActions, selectMessagesForTopic } from '../newMessage'

const logger = loggerService.withContext('MessageThunk')

const finishTopicLoading = async (topicId: string) => {
  await waitForTopicQueue(topicId)
  store.dispatch(newMessagesActions.setTopicLoading({ topicId, loading: false }))
  store.dispatch(newMessagesActions.setTopicFulfilled({ topicId, fulfilled: true }))
}
// TODO: 后续可以将db操作移到Listener Middleware中
export const saveMessageAndBlocksToDB = async (message: Message, blocks: MessageBlock[], messageIndex: number = -1) => {
  try {
    if (blocks.length > 0) {
      await db.message_blocks.bulkPut(blocks)
    }
    const topic = await db.topics.get(message.topicId)
    if (topic) {
      const _messageIndex = topic.messages.findIndex((m) => m.id === message.id)
      const updatedMessages = [...topic.messages]

      if (_messageIndex !== -1) {
        updatedMessages[_messageIndex] = message
      } else {
        if (messageIndex !== -1) {
          updatedMessages.splice(messageIndex, 0, message)
        } else {
          updatedMessages.push(message)
        }
      }
      await db.topics.update(message.topicId, { messages: updatedMessages })
      store.dispatch(updateTopicUpdatedAt({ topicId: message.topicId }))
    } else {
      logger.error(`[saveMessageAndBlocksToDB] Topic ${message.topicId} not found.`)
    }
  } catch (error) {
    logger.error(`[saveMessageAndBlocksToDB] Failed to save message ${message.id}:`, error as Error)
  }
}

const updateExistingMessageAndBlocksInDB = async (
  updatedMessage: Partial<Message> & Pick<Message, 'id' | 'topicId'>,
  updatedBlocks: MessageBlock[]
) => {
  try {
    await db.transaction('rw', db.topics, db.message_blocks, async () => {
      // Always update blocks if provided
      if (updatedBlocks.length > 0) {
        await db.message_blocks.bulkPut(updatedBlocks)
      }

      // Check if there are message properties to update beyond id and topicId
      const messageKeysToUpdate = Object.keys(updatedMessage).filter((key) => key !== 'id' && key !== 'topicId')

      // Only proceed with topic update if there are actual message changes
      if (messageKeysToUpdate.length > 0) {
        // 使用 where().modify() 进行原子更新
        await db.topics
          .where('id')
          .equals(updatedMessage.topicId)
          .modify((topic) => {
            if (!topic) return

            const messageIndex = topic.messages.findIndex((m) => m.id === updatedMessage.id)
            if (messageIndex !== -1) {
              // 直接在原对象上更新需要修改的属性
              messageKeysToUpdate.forEach((key) => {
                topic.messages[messageIndex][key] = updatedMessage[key]
              })
            }
          })

        store.dispatch(updateTopicUpdatedAt({ topicId: updatedMessage.topicId }))
      }
    })
  } catch (error) {
    logger.error(`[updateExistingMsg] Failed to update message ${updatedMessage.id}:`, error as Error)
  }
}

/**
 * 消息块节流器。
 * 每个消息块有独立节流器，并发更新时不会互相影响
 */
const blockUpdateThrottlers = new LRUCache<string, ReturnType<typeof throttle>>({
  max: 100,
  ttl: 1000 * 60 * 5,
  updateAgeOnGet: true
})

/**
 * 消息块 RAF 缓存。
 * 用于管理 RAF 请求创建和取消。
 */
const blockUpdateRafs = new LRUCache<string, number>({
  max: 100,
  ttl: 1000 * 60 * 5,
  updateAgeOnGet: true
})

/**
 * 获取或创建消息块专用的节流函数。
 */
const getBlockThrottler = (id: string) => {
  if (!blockUpdateThrottlers.has(id)) {
    const throttler = throttle(async (blockUpdate: any) => {
      const existingRAF = blockUpdateRafs.get(id)
      if (existingRAF) {
        cancelAnimationFrame(existingRAF)
      }

      const rafId = requestAnimationFrame(() => {
        store.dispatch(updateOneBlock({ id, changes: blockUpdate }))
        blockUpdateRafs.delete(id)
      })

      blockUpdateRafs.set(id, rafId)
      await db.message_blocks.update(id, blockUpdate)
    }, 150)

    blockUpdateThrottlers.set(id, throttler)
  }

  return blockUpdateThrottlers.get(id)!
}

/**
 * 更新单个消息块。
 */
export const throttledBlockUpdate = (id: string, blockUpdate: any) => {
  const throttler = getBlockThrottler(id)
  throttler(blockUpdate)
}

/**
 * 取消单个块的节流更新，移除节流器和 RAF。
 */
export const cancelThrottledBlockUpdate = (id: string) => {
  const rafId = blockUpdateRafs.get(id)
  if (rafId) {
    cancelAnimationFrame(rafId)
    blockUpdateRafs.delete(id)
  }

  const throttler = blockUpdateThrottlers.get(id)
  if (throttler) {
    throttler.cancel()
    blockUpdateThrottlers.delete(id)
  }
}

/**
 * 批量清理多个消息块。
 */
export const cleanupMultipleBlocks = (dispatch: AppDispatch, blockIds: string[]) => {
  blockIds.forEach((id) => {
    cancelThrottledBlockUpdate(id)
  })

  const getBlocksFiles = async (blockIds: string[]) => {
    const blocks = await db.message_blocks.where('id').anyOf(blockIds).toArray()
    const files = blocks
      .filter((block) => block.type === MessageBlockType.FILE || block.type === MessageBlockType.IMAGE)
      .map((block) => block.file)
      .filter((file): file is FileMetadata => file !== undefined)
    return isEmpty(files) ? [] : files
  }

  const cleanupFiles = async (files: FileMetadata[]) => {
    await Promise.all(files.map((file) => FileManager.deleteFile(file.id, false)))
  }

  getBlocksFiles(blockIds).then(cleanupFiles)

  if (blockIds.length > 0) {
    dispatch(removeManyBlocks(blockIds))
  }
}

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
    logger.error(`[DB Save Updates] Failed for message ${messageId}:`, error as Error)
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
    logger.warn('[DB Save Single Block] Received null/undefined blockId. Skipping save.')
    return
  }
  const state = getState()
  const blockToSave = state.messageBlocks.entities[blockId]
  if (blockToSave) {
    await saveUpdatesToDB(messageId, topicId, {}, [blockToSave]) // Pass messageId, topicId, empty message updates, and the block
  } else {
    logger.warn(`[DB Save Single Block] Block ${blockId} not found in state. Cannot save.`)
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
      modelId: mentionedModel.id,
      traceId: triggeringMessage.traceId
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
    logger.error(`[dispatchMultiModelResponses] Topic ${topicId} not found in DB during multi-model save.`)
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

    // let accumulatedContent = ''
    // let accumulatedThinking = ''
    // let lastBlockId: string | null = null
    // let lastBlockType: MessageBlockType | null = null
    // let currentActiveBlockType: MessageBlockType | null = null
    // // 专注于块内部的生命周期处理
    // let initialPlaceholderBlockId: string | null = null
    // let citationBlockId: string | null = null
    // let mainTextBlockId: string | null = null
    // let thinkingBlockId: string | null = null
    // let imageBlockId: string | null = null
    // let toolBlockId: string | null = null

    // const toolCallIdToBlockIdMap = new Map<string, string>()
    // const notificationService = NotificationService.getInstance()

    /**
     * 智能更新策略：根据块类型连续性自动判断使用节流还是立即更新
     * - 连续同类块：使用节流（减少重渲染）
     * - 块类型切换：立即更新（确保状态正确）
     * @param blockId 块ID
     * @param changes 块更新内容
     * @param blockType 块类型
     * @param isComplete 是否完成，如果完成，则需要保存块更新到redux中
     */
    // const smartBlockUpdate = (
    //   blockId: string,
    //   changes: Partial<MessageBlock>,
    //   blockType: MessageBlockType,
    //   isComplete: boolean = false
    // ) => {
    //   const isBlockTypeChanged = currentActiveBlockType !== null && currentActiveBlockType !== blockType
    //   if (isBlockTypeChanged || isComplete) {
    //     // 如果块类型改变，则取消上一个块的节流更新，并保存块更新到redux中（尽管有可能被上一个块本身的oncomplete事件的取消节流已经取消了）
    //     if (isBlockTypeChanged && lastBlockId) {
    //       cancelThrottledBlockUpdate(lastBlockId)
    //     }
    //     // 如果当前块完成，则取消当前块的节流更新，并保存块更新到redux中，避免streaming状态覆盖掉完成状态
    //     if (isComplete) {
    //       cancelThrottledBlockUpdate(blockId)
    //     }
    //     dispatch(updateOneBlock({ id: blockId, changes }))
    //     saveUpdatedBlockToDB(blockId, assistantMsgId, topicId, getState)
    //   } else {
    //     throttledBlockUpdate(blockId, changes)
    //   }

    //   // 更新当前活跃块类型
    //   currentActiveBlockType = blockType
    // }

    // const handleBlockTransition = async (newBlock: MessageBlock, newBlockType: MessageBlockType) => {
    //   lastBlockId = newBlock.id
    //   lastBlockType = newBlockType
    //   if (newBlockType !== MessageBlockType.MAIN_TEXT) {
    //     accumulatedContent = ''
    //   }
    //   if (newBlockType !== MessageBlockType.THINKING) {
    //     accumulatedThinking = ''
    //   }
    //   dispatch(
    //     newMessagesActions.updateMessage({
    //       topicId,
    //       messageId: assistantMsgId,
    //       updates: { blockInstruction: { id: newBlock.id } }
    //     })
    //   )
    //   dispatch(upsertOneBlock(newBlock))
    //   dispatch(
    //     newMessagesActions.upsertBlockReference({
    //       messageId: assistantMsgId,
    //       blockId: newBlock.id,
    //       status: newBlock.status
    //     })
    //   )

    //   const currentState = getState()
    //   const updatedMessage = currentState.messages.entities[assistantMsgId]
    //   if (updatedMessage) {
    //     await saveUpdatesToDB(assistantMsgId, topicId, { blocks: updatedMessage.blocks }, [newBlock])
    //   } else {
    //     console.error(`[handleBlockTransition] Failed to get updated message ${assistantMsgId} from state for DB save.`)
    //   }
    // }

    // 创建 BlockManager 实例
    const blockManager = new BlockManager({
      dispatch,
      getState,
      saveUpdatedBlockToDB,
      saveUpdatesToDB,
      assistantMsgId,
      topicId,
      throttledBlockUpdate,
      cancelThrottledBlockUpdate
    })

    const allMessagesForTopic = selectMessagesForTopic(getState(), topicId)

    let messagesForContext: Message[] = []
    const userMessageId = assistantMessage.askId
    const userMessageIndex = allMessagesForTopic.findIndex((m) => m?.id === userMessageId)

    if (userMessageIndex === -1) {
      logger.error(
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

    // callbacks = {
    //   onLLMResponseCreated: async () => {
    //     const baseBlock = createBaseMessageBlock(assistantMsgId, MessageBlockType.UNKNOWN, {
    //       status: MessageBlockStatus.PROCESSING
    //     })
    //     initialPlaceholderBlockId = baseBlock.id
    //     await handleBlockTransition(baseBlock as PlaceholderMessageBlock, MessageBlockType.UNKNOWN)
    //   },
    //   onTextStart: async () => {
    //     if (initialPlaceholderBlockId) {
    //       lastBlockType = MessageBlockType.MAIN_TEXT
    //       const changes = {
    //         type: MessageBlockType.MAIN_TEXT,
    //         content: accumulatedContent,
    //         status: MessageBlockStatus.STREAMING
    //       }
    //       smartBlockUpdate(initialPlaceholderBlockId, changes, MessageBlockType.MAIN_TEXT, true)
    //       mainTextBlockId = initialPlaceholderBlockId
    //       initialPlaceholderBlockId = null
    //     } else if (!mainTextBlockId) {
    //       const newBlock = createMainTextBlock(assistantMsgId, accumulatedContent, {
    //         status: MessageBlockStatus.STREAMING
    //       })
    //       mainTextBlockId = newBlock.id
    //       await handleBlockTransition(newBlock, MessageBlockType.MAIN_TEXT)
    //     }
    //   },
    //   onTextChunk: async (text) => {
    //     const citationBlockSource = citationBlockId
    //       ? (getState().messageBlocks.entities[citationBlockId] as CitationMessageBlock).response?.source
    //       : WebSearchSource.WEBSEARCH
    //     accumulatedContent += text
    //     if (mainTextBlockId) {
    //       const blockChanges: Partial<MessageBlock> = {
    //         content: accumulatedContent,
    //         status: MessageBlockStatus.STREAMING,
    //         citationReferences: citationBlockId ? [{ citationBlockId, citationBlockSource }] : []
    //       }
    //       smartBlockUpdate(mainTextBlockId, blockChanges, MessageBlockType.MAIN_TEXT)
    //     }
    //   },
    //   onTextComplete: async (finalText) => {
    //     if (mainTextBlockId) {
    //       const changes = {
    //         content: finalText,
    //         status: MessageBlockStatus.SUCCESS
    //       }
    //       smartBlockUpdate(mainTextBlockId, changes, MessageBlockType.MAIN_TEXT, true)
    //       mainTextBlockId = null
    //     } else {
    //       console.warn(
    //         `[onTextComplete] Received text.complete but last block was not MAIN_TEXT (was ${lastBlockType}) or lastBlockId  is null.`
    //       )
    //     }
    //   },
    //   onThinkingStart: async () => {
    //     if (initialPlaceholderBlockId) {
    //       lastBlockType = MessageBlockType.THINKING
    //       const changes = {
    //         type: MessageBlockType.THINKING,
    //         content: accumulatedThinking,
    //         status: MessageBlockStatus.STREAMING,
    //         thinking_millsec: 0
    //       }
    //       thinkingBlockId = initialPlaceholderBlockId
    //       initialPlaceholderBlockId = null
    //       smartBlockUpdate(thinkingBlockId, changes, MessageBlockType.THINKING, true)
    //     } else if (!thinkingBlockId) {
    //       const newBlock = createThinkingBlock(assistantMsgId, accumulatedThinking, {
    //         status: MessageBlockStatus.STREAMING,
    //         thinking_millsec: 0
    //       })
    //       thinkingBlockId = newBlock.id
    //       await handleBlockTransition(newBlock, MessageBlockType.THINKING)
    //     }
    //   },
    //   onThinkingChunk: async (text, thinking_millsec) => {
    //     accumulatedThinking += text
    //     if (thinkingBlockId) {
    //       const blockChanges: Partial<MessageBlock> = {
    //         content: accumulatedThinking,
    //         status: MessageBlockStatus.STREAMING,
    //         thinking_millsec: thinking_millsec
    //       }
    //       smartBlockUpdate(thinkingBlockId, blockChanges, MessageBlockType.THINKING)
    //     }
    //   },
    //   onThinkingComplete: (finalText, final_thinking_millsec) => {
    //     if (thinkingBlockId) {
    //       const changes = {
    //         type: MessageBlockType.THINKING,
    //         content: finalText,
    //         status: MessageBlockStatus.SUCCESS,
    //         thinking_millsec: final_thinking_millsec
    //       }
    //       smartBlockUpdate(thinkingBlockId, changes, MessageBlockType.THINKING, true)
    //     } else {
    //       console.warn(
    //         `[onThinkingComplete] Received thinking.complete but last block was not THINKING (was ${lastBlockType}) or lastBlockId  is null.`
    //       )
    //     }
    //     thinkingBlockId = null
    //   },
    //   onToolCallPending: (toolResponse: MCPToolResponse) => {
    //     if (initialPlaceholderBlockId) {
    //       lastBlockType = MessageBlockType.TOOL
    //       const changes = {
    //         type: MessageBlockType.TOOL,
    //         status: MessageBlockStatus.PENDING,
    //         toolName: toolResponse.tool.name,
    //         metadata: { rawMcpToolResponse: toolResponse }
    //       }
    //       toolBlockId = initialPlaceholderBlockId
    //       initialPlaceholderBlockId = null
    //       smartBlockUpdate(toolBlockId, changes, MessageBlockType.TOOL)
    //       toolCallIdToBlockIdMap.set(toolResponse.id, toolBlockId)
    //     } else if (toolResponse.status === 'pending') {
    //       const toolBlock = createToolBlock(assistantMsgId, toolResponse.id, {
    //         toolName: toolResponse.tool.name,
    //         status: MessageBlockStatus.PENDING,
    //         metadata: { rawMcpToolResponse: toolResponse }
    //       })
    //       toolBlockId = toolBlock.id
    //       handleBlockTransition(toolBlock, MessageBlockType.TOOL)
    //       toolCallIdToBlockIdMap.set(toolResponse.id, toolBlock.id)
    //     } else {
    //       console.warn(
    //         `[onToolCallPending] Received unhandled tool status: ${toolResponse.status} for ID: ${toolResponse.id}`
    //       )
    //     }
    //   },
    //   onToolCallInProgress: (toolResponse: MCPToolResponse) => {
    //     // 根据 toolResponse.id 查找对应的块ID
    //     const targetBlockId = toolCallIdToBlockIdMap.get(toolResponse.id)

    //     if (targetBlockId && toolResponse.status === 'invoking') {
    //       const changes = {
    //         status: MessageBlockStatus.PROCESSING,
    //         metadata: { rawMcpToolResponse: toolResponse }
    //       }
    //       smartBlockUpdate(targetBlockId, changes, MessageBlockType.TOOL)
    //     } else if (!targetBlockId) {
    //       console.warn(
    //         `[onToolCallInProgress] No block ID found for tool ID: ${toolResponse.id}. Available mappings:`,
    //         Array.from(toolCallIdToBlockIdMap.entries())
    //       )
    //     } else {
    //       console.warn(
    //         `[onToolCallInProgress] Received unhandled tool status: ${toolResponse.status} for ID: ${toolResponse.id}`
    //       )
    //     }
    //   },
    //   onToolCallComplete: (toolResponse: MCPToolResponse) => {
    //     const existingBlockId = toolCallIdToBlockIdMap.get(toolResponse.id)
    //     toolCallIdToBlockIdMap.delete(toolResponse.id)
    //     if (toolResponse.status === 'done' || toolResponse.status === 'error' || toolResponse.status === 'cancelled') {
    //       if (!existingBlockId) {
    //         console.error(
    //           `[onToolCallComplete] No existing block found for completed/error tool call ID: ${toolResponse.id}. Cannot update.`
    //         )
    //         return
    //       }
    //       const finalStatus =
    //         toolResponse.status === 'done' || toolResponse.status === 'cancelled'
    //           ? MessageBlockStatus.SUCCESS
    //           : MessageBlockStatus.ERROR
    //       const changes: Partial<ToolMessageBlock> = {
    //         content: toolResponse.response,
    //         status: finalStatus,
    //         metadata: { rawMcpToolResponse: toolResponse }
    //       }
    //       if (finalStatus === MessageBlockStatus.ERROR) {
    //         changes.error = { message: `Tool execution failed/error`, details: toolResponse.response }
    //       }
    //       smartBlockUpdate(existingBlockId, changes, MessageBlockType.TOOL, true)
    //     } else {
    //       console.warn(
    //         `[onToolCallComplete] Received unhandled tool status: ${toolResponse.status} for ID: ${toolResponse.id}`
    //       )
    //     }
    //     toolBlockId = null
    //   },
    //   onExternalToolInProgress: async () => {
    //     const citationBlock = createCitationBlock(assistantMsgId, {}, { status: MessageBlockStatus.PROCESSING })
    //     citationBlockId = citationBlock.id
    //     await handleBlockTransition(citationBlock, MessageBlockType.CITATION)
    //     // saveUpdatedBlockToDB(citationBlock.id, assistantMsgId, topicId, getState)
    //   },
    //   onExternalToolComplete: (externalToolResult: ExternalToolResult) => {
    //     if (citationBlockId) {
    //       const changes: Partial<CitationMessageBlock> = {
    //         response: externalToolResult.webSearch,
    //         knowledge: externalToolResult.knowledge,
    //         status: MessageBlockStatus.SUCCESS
    //       }
    //       smartBlockUpdate(citationBlockId, changes, MessageBlockType.CITATION, true)
    //     } else {
    //       console.error('[onExternalToolComplete] citationBlockId is null. Cannot update.')
    //     }
    //   },
    //   onLLMWebSearchInProgress: async () => {
    //     if (initialPlaceholderBlockId) {
    //       lastBlockType = MessageBlockType.CITATION
    //       citationBlockId = initialPlaceholderBlockId
    //       const changes = {
    //         type: MessageBlockType.CITATION,
    //         status: MessageBlockStatus.PROCESSING
    //       }
    //       lastBlockType = MessageBlockType.CITATION
    //       smartBlockUpdate(initialPlaceholderBlockId, changes, MessageBlockType.CITATION)
    //       initialPlaceholderBlockId = null
    //     } else {
    //       const citationBlock = createCitationBlock(assistantMsgId, {}, { status: MessageBlockStatus.PROCESSING })
    //       citationBlockId = citationBlock.id
    //       await handleBlockTransition(citationBlock, MessageBlockType.CITATION)
    //     }
    //   },
    //   onLLMWebSearchComplete: async (llmWebSearchResult) => {
    //     const blockId = citationBlockId || initialPlaceholderBlockId
    //     if (blockId) {
    //       const changes: Partial<CitationMessageBlock> = {
    //         type: MessageBlockType.CITATION,
    //         response: llmWebSearchResult,
    //         status: MessageBlockStatus.SUCCESS
    //       }
    //       smartBlockUpdate(blockId, changes, MessageBlockType.CITATION)

    //       const state = getState()
    //       const existingMainTextBlocks = findMainTextBlocks(state.messages.entities[assistantMsgId])
    //       if (existingMainTextBlocks.length > 0) {
    //         const existingMainTextBlock = existingMainTextBlocks[0]
    //         const currentRefs = existingMainTextBlock.citationReferences || []
    //         const mainTextChanges = {
    //           citationReferences: [...currentRefs, { blockId, citationBlockSource: llmWebSearchResult.source }]
    //         }
    //         smartBlockUpdate(existingMainTextBlock.id, mainTextChanges, MessageBlockType.MAIN_TEXT, true)
    //       }

    //       if (initialPlaceholderBlockId) {
    //         citationBlockId = initialPlaceholderBlockId
    //         initialPlaceholderBlockId = null
    //       }
    //     } else {
    //       const citationBlock = createCitationBlock(
    //         assistantMsgId,
    //         {
    //           response: llmWebSearchResult
    //         },
    //         {
    //           status: MessageBlockStatus.SUCCESS
    //         }
    //       )
    //       citationBlockId = citationBlock.id
    //       const state = getState()
    //       const existingMainTextBlocks = findMainTextBlocks(state.messages.entities[assistantMsgId])
    //       if (existingMainTextBlocks.length > 0) {
    //         const existingMainTextBlock = existingMainTextBlocks[0]
    //         const currentRefs = existingMainTextBlock.citationReferences || []
    //         const mainTextChanges = {
    //           citationReferences: [...currentRefs, { citationBlockId, citationBlockSource: llmWebSearchResult.source }]
    //         }
    //         smartBlockUpdate(existingMainTextBlock.id, mainTextChanges, MessageBlockType.MAIN_TEXT, true)
    //       }
    //       await handleBlockTransition(citationBlock, MessageBlockType.CITATION)
    //     }
    //   },
    //   onImageCreated: async () => {
    //     if (initialPlaceholderBlockId) {
    //       lastBlockType = MessageBlockType.IMAGE
    //       const initialChanges: Partial<MessageBlock> = {
    //         type: MessageBlockType.IMAGE,
    //         status: MessageBlockStatus.PENDING
    //       }
    //       lastBlockType = MessageBlockType.IMAGE
    //       imageBlockId = initialPlaceholderBlockId
    //       initialPlaceholderBlockId = null
    //       smartBlockUpdate(imageBlockId, initialChanges, MessageBlockType.IMAGE)
    //     } else if (!imageBlockId) {
    //       const imageBlock = createImageBlock(assistantMsgId, {
    //         status: MessageBlockStatus.PENDING
    //       })
    //       imageBlockId = imageBlock.id
    //       await handleBlockTransition(imageBlock, MessageBlockType.IMAGE)
    //     }
    //   },
    //   onImageDelta: (imageData) => {
    //     const imageUrl = imageData.images?.[0] || 'placeholder_image_url'
    //     if (imageBlockId) {
    //       const changes: Partial<ImageMessageBlock> = {
    //         url: imageUrl,
    //         metadata: { generateImageResponse: imageData },
    //         status: MessageBlockStatus.STREAMING
    //       }
    //       smartBlockUpdate(imageBlockId, changes, MessageBlockType.IMAGE, true)
    //     }
    //   },
    //   onImageGenerated: (imageData) => {
    //     if (imageBlockId) {
    //       if (!imageData) {
    //         const changes: Partial<ImageMessageBlock> = {
    //           status: MessageBlockStatus.SUCCESS
    //         }
    //         smartBlockUpdate(imageBlockId, changes, MessageBlockType.IMAGE)
    //       } else {
    //         const imageUrl = imageData.images?.[0] || 'placeholder_image_url'
    //         const changes: Partial<ImageMessageBlock> = {
    //           url: imageUrl,
    //           metadata: { generateImageResponse: imageData },
    //           status: MessageBlockStatus.SUCCESS
    //         }
    //         smartBlockUpdate(imageBlockId, changes, MessageBlockType.IMAGE, true)
    //       }
    //     } else {
    //       console.error('[onImageGenerated] Last block was not an Image block or ID is missing.')
    //     }
    //     imageBlockId = null
    //   },
    //   onError: async (error) => {
    //     console.dir(error, { depth: null })
    //     const isErrorTypeAbort = isAbortError(error)
    //     let pauseErrorLanguagePlaceholder = ''
    //     if (isErrorTypeAbort) {
    //       pauseErrorLanguagePlaceholder = 'pause_placeholder'
    //     }

    //     const serializableError = {
    //       name: error.name,
    //       message: pauseErrorLanguagePlaceholder || error.message || formatErrorMessage(error),
    //       originalMessage: error.message,
    //       stack: error.stack,
    //       status: error.status || error.code,
    //       requestId: error.request_id
    //     }
    //     if (!isOnHomePage()) {
    //       await notificationService.send({
    //         id: uuid(),
    //         type: 'error',
    //         title: t('notification.assistant'),
    //         message: serializableError.message,
    //         silent: false,
    //         timestamp: Date.now(),
    //         source: 'assistant'
    //       })
    //     }
    //     const possibleBlockId =
    //       mainTextBlockId ||
    //       thinkingBlockId ||
    //       toolBlockId ||
    //       imageBlockId ||
    //       citationBlockId ||
    //       initialPlaceholderBlockId ||
    //       lastBlockId

    //     if (possibleBlockId) {
    //       // 更改上一个block的状态为ERROR
    //       const changes: Partial<MessageBlock> = {
    //         status: isErrorTypeAbort ? MessageBlockStatus.PAUSED : MessageBlockStatus.ERROR
    //       }
    //       smartBlockUpdate(possibleBlockId, changes, lastBlockType!, true)
    //     }

    //     const errorBlock = createErrorBlock(assistantMsgId, serializableError, { status: MessageBlockStatus.SUCCESS })
    //     await handleBlockTransition(errorBlock, MessageBlockType.ERROR)
    //     const messageErrorUpdate = {
    //       status: isErrorTypeAbort ? AssistantMessageStatus.SUCCESS : AssistantMessageStatus.ERROR
    //     }
    //     dispatch(newMessagesActions.updateMessage({ topicId, messageId: assistantMsgId, updates: messageErrorUpdate }))

    //     saveUpdatesToDB(assistantMsgId, topicId, messageErrorUpdate, [])

    //     EventEmitter.emit(EVENT_NAMES.MESSAGE_COMPLETE, {
    //       id: assistantMsgId,
    //       topicId,
    //       status: isErrorTypeAbort ? 'pause' : 'error',
    //       error: error.message
    //     })
    //   },
    //   onComplete: async (status: AssistantMessageStatus, response?: Response) => {
    //     const finalStateOnComplete = getState()
    //     const finalAssistantMsg = finalStateOnComplete.messages.entities[assistantMsgId]

    //     if (status === 'success' && finalAssistantMsg) {
    //       const userMsgId = finalAssistantMsg.askId
    //       const orderedMsgs = selectMessagesForTopic(finalStateOnComplete, topicId)
    //       const userMsgIndex = orderedMsgs.findIndex((m) => m.id === userMsgId)
    //       const contextForUsage = userMsgIndex !== -1 ? orderedMsgs.slice(0, userMsgIndex + 1) : []
    //       const finalContextWithAssistant = [...contextForUsage, finalAssistantMsg]

    //       const possibleBlockId =
    //         mainTextBlockId ||
    //         thinkingBlockId ||
    //         toolBlockId ||
    //         imageBlockId ||
    //         citationBlockId ||
    //         initialPlaceholderBlockId ||
    //         lastBlockId
    //       if (possibleBlockId) {
    //         const changes: Partial<MessageBlock> = {
    //           status: MessageBlockStatus.SUCCESS
    //         }
    //         smartBlockUpdate(possibleBlockId, changes, lastBlockType!, true)
    //       }

    //       const endTime = Date.now()
    //       const duration = endTime - startTime
    //       const content = getMainTextContent(finalAssistantMsg)
    //       if (!isOnHomePage() && duration > 60 * 1000) {
    //         await notificationService.send({
    //           id: uuid(),
    //           type: 'success',
    //           title: t('notification.assistant'),
    //           message: content.length > 50 ? content.slice(0, 47) + '...' : content,
    //           silent: false,
    //           timestamp: Date.now(),
    //           source: 'assistant'
    //         })
    //       }

    //       // 更新topic的name
    //       autoRenameTopic(assistant, topicId)

    //       if (
    //         response &&
    //         (response.usage?.total_tokens === 0 ||
    //           response?.usage?.prompt_tokens === 0 ||
    //           response?.usage?.completion_tokens === 0)
    //       ) {
    //         const usage = await estimateMessagesUsage({ assistant, messages: finalContextWithAssistant })
    //         response.usage = usage
    //       }
    //       // dispatch(newMessagesActions.setTopicLoading({ topicId, loading: false }))
    //     }
    //     if (response && response.metrics) {
    //       if (response.metrics.completion_tokens === 0 && response.usage?.completion_tokens) {
    //         response = {
    //           ...response,
    //           metrics: {
    //             ...response.metrics,
    //             completion_tokens: response.usage.completion_tokens
    //           }
    //         }
    //       }
    //     }

    //     const messageUpdates: Partial<Message> = { status, metrics: response?.metrics, usage: response?.usage }
    //     dispatch(
    //       newMessagesActions.updateMessage({
    //         topicId,
    //         messageId: assistantMsgId,
    //         updates: messageUpdates
    //       })
    //     )
    //     saveUpdatesToDB(assistantMsgId, topicId, messageUpdates, [])

    //     EventEmitter.emit(EVENT_NAMES.MESSAGE_COMPLETE, { id: assistantMsgId, topicId, status })
    //   }
    // }

    assistant.prompt = await buildSystemPrompt(assistant.prompt || '', assistant)

    callbacks = createCallbacks({
      blockManager,
      dispatch,
      getState,
      topicId,
      assistantMsgId,
      saveUpdatesToDB,
      assistant
    })
    const streamProcessorCallbacks = createStreamProcessor(callbacks)

    // const startTime = Date.now()
    const result = await fetchChatCompletion({
      messages: messagesForContext,
      assistant: assistant,
      onChunkReceived: streamProcessorCallbacks
    })
    endSpan({
      topicId,
      outputs: result ? result.getText() : '',
      modelName: assistant.model?.name,
      modelEnded: true
    })
  } catch (error: any) {
    logger.error('Error fetching chat completion:', error)
    endSpan({
      topicId,
      error: error,
      modelName: assistant.model?.name
    })
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
        logger.warn('sendMessage: No blocks in the provided message.')
        return
      }
      await saveMessageAndBlocksToDB(userMessage, userMessageBlocks)
      dispatch(newMessagesActions.addMessage({ topicId, message: userMessage }))
      if (userMessageBlocks.length > 0) {
        dispatch(upsertManyBlocks(userMessageBlocks))
      }
      dispatch(updateTopicUpdatedAt({ topicId }))

      const mentionedModels = userMessage.mentions
      const queue = getTopicQueue(topicId)

      if (mentionedModels && mentionedModels.length > 0) {
        await dispatchMultiModelResponses(dispatch, getState, topicId, userMessage, assistant, mentionedModels)
      } else {
        const assistantMessage = createAssistantMessage(assistant.id, topicId, {
          askId: userMessage.id,
          model: assistant.model,
          traceId: userMessage.traceId
        })
        await saveMessageAndBlocksToDB(assistantMessage, [])
        dispatch(newMessagesActions.addMessage({ topicId, message: assistantMessage }))

        queue.add(async () => {
          await fetchAndProcessAssistantResponseImpl(dispatch, getState, topicId, assistant, assistantMessage)
        })
      }
    } catch (error) {
      logger.error('Error in sendMessage thunk:', error as Error)
    } finally {
      finishTopicLoading(topicId)
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
      logger.error(`[loadTopicMessagesThunk] Failed to load messages for topic ${topicId}:`, error)
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
      logger.error(`[deleteSingleMessage] Message ${messageId} not found in topic ${topicId}.`)
      return
    }

    const blockIdsToDelete = messageToDelete.blocks || []

    try {
      dispatch(newMessagesActions.removeMessage({ topicId, messageId }))
      cleanupMultipleBlocks(dispatch, blockIdsToDelete)
      await db.message_blocks.bulkDelete(blockIdsToDelete)
      const topic = await db.topics.get(topicId)
      if (topic) {
        const finalMessagesToSave = selectMessagesForTopic(getState(), topicId)
        await db.topics.update(topicId, { messages: finalMessagesToSave })
        dispatch(updateTopicUpdatedAt({ topicId }))
      }
    } catch (error) {
      logger.error(`[deleteSingleMessage] Failed to delete message ${messageId}:`, error as Error)
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
      logger.warn(`[deleteMessageGroup] No messages found with askId ${askId} in topic ${topicId}.`)
      return
    }

    const blockIdsToDelete = messagesToDelete.flatMap((m) => m.blocks || [])

    try {
      dispatch(newMessagesActions.removeMessagesByAskId({ topicId, askId }))
      cleanupMultipleBlocks(dispatch, blockIdsToDelete)
      await db.message_blocks.bulkDelete(blockIdsToDelete)
      const topic = await db.topics.get(topicId)
      if (topic) {
        const finalMessagesToSave = selectMessagesForTopic(getState(), topicId)
        await db.topics.update(topicId, { messages: finalMessagesToSave })
        dispatch(updateTopicUpdatedAt({ topicId }))
      }
    } catch (error) {
      logger.error(`[deleteMessageGroup] Failed to delete messages with askId ${askId}:`, error as Error)
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
      cleanupMultipleBlocks(dispatch, blockIdsToDelete)

      await db.topics.update(topicId, { messages: [] })
      dispatch(updateTopicUpdatedAt({ topicId }))
      if (blockIdsToDelete.length > 0) {
        await db.message_blocks.bulkDelete(blockIdsToDelete)
      }
    } catch (error) {
      logger.error(`[clearTopicMessagesThunk] Failed to clear messages for topic ${topicId}:`, error as Error)
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

      // Clear cached search results for the user message being resent
      // This ensures that the regenerated responses will not use stale search results
      try {
        window.keyv.remove(`web-search-${userMessageToResend.id}`)
        window.keyv.remove(`knowledge-search-${userMessageToResend.id}`)
      } catch (error) {
        logger.warn(`Failed to clear keyv cache for message ${userMessageToResend.id}:`, error as Error)
      }

      const resetDataList: Message[] = []

      if (assistantMessagesToReset.length === 0 && !userMessageToResend?.mentions?.length) {
        // 没有相关的助手消息且没有提及模型时，使用助手模型创建一条消息

        const assistantMessage = createAssistantMessage(assistant.id, topicId, {
          askId: userMessageToResend.id,
          model: assistant.model
        })
        assistantMessage.traceId = userMessageToResend.traceId
        resetDataList.push(assistantMessage)

        resetDataList.forEach((message) => {
          dispatch(newMessagesActions.addMessage({ topicId, message }))
        })
      }

      // 处理存在相关的助手消息的情况
      const allBlockIdsToDelete: string[] = []
      const messagesToUpdateInRedux: { topicId: string; messageId: string; updates: Partial<Message> }[] = []

      // 先处理已有的重传
      for (const originalMsg of assistantMessagesToReset) {
        const modelToSet =
          assistantMessagesToReset.length === 1 && !userMessageToResend?.mentions?.length
            ? assistant.model
            : originalMsg.model
        const blockIdsToDelete = [...(originalMsg.blocks || [])]
        const resetMsg = resetAssistantMessage(originalMsg, {
          status: AssistantMessageStatus.PENDING,
          updatedAt: new Date().toISOString(),
          model: modelToSet
        })

        resetDataList.push(resetMsg)
        allBlockIdsToDelete.push(...blockIdsToDelete)
        messagesToUpdateInRedux.push({ topicId, messageId: resetMsg.id, updates: resetMsg })
      }

      // 再处理新的重传（用户消息提及，但是现有助手消息中不存在提及的模型）
      const originModelSet = new Set(assistantMessagesToReset.map((m) => m.model).filter((m) => m !== undefined))
      const mentionedModelSet = new Set(userMessageToResend.mentions ?? [])
      const newModelSet = new Set([...mentionedModelSet].filter((m) => !originModelSet.has(m)))
      for (const model of newModelSet) {
        const assistantMessage = createAssistantMessage(assistant.id, topicId, {
          askId: userMessageToResend.id,
          model: model,
          modelId: model.id
        })
        resetDataList.push(assistantMessage)
        dispatch(newMessagesActions.addMessage({ topicId, message: assistantMessage }))
      }

      messagesToUpdateInRedux.forEach((update) => dispatch(newMessagesActions.updateMessage(update)))
      cleanupMultipleBlocks(dispatch, allBlockIdsToDelete)

      try {
        if (allBlockIdsToDelete.length > 0) {
          await db.message_blocks.bulkDelete(allBlockIdsToDelete)
        }
        const finalMessagesToSave = selectMessagesForTopic(getState(), topicId)
        await db.topics.update(topicId, { messages: finalMessagesToSave })
      } catch (dbError) {
        logger.error('[resendMessageThunk] Error updating database:', dbError as Error)
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
      logger.error(`[resendMessageThunk] Error resending user message ${userMessageToResend.id}:`, error as Error)
    } finally {
      finishTopicLoading(topicId)
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

      const askId = assistantMessageToRegenerate.askId

      if (!askId) {
        logger.error(
          `[appendAssistantResponseThunk] Existing assistant message ${assistantMessageToRegenerate.id} does not have an askId.`
        )
        return // Stop if askId is missing
      }

      if (!state.messages.entities[askId]) {
        logger.error(
          `[appendAssistantResponseThunk] Original user query (askId: ${askId}) not found in entities. Cannot create assistant response without corresponding user message.`
        )

        // Show error popup instead of creating error message block
        window.message.error({
          content: t('error.missing_user_message'),
          key: 'missing-user-message-error'
        })

        return
      }

      // 2. Find the original user query (Restored Logic)
      const originalUserQuery = allMessagesForTopic.find((m) => m.id === assistantMessageToRegenerate.askId)
      if (!originalUserQuery) {
        logger.error(
          `[regenerateAssistantResponseThunk] Original user query (askId: ${assistantMessageToRegenerate.askId}) not found for assistant message ${assistantMessageToRegenerate.id}. Cannot regenerate.`
        )
        return
      }

      // 3. Verify the assistant message itself exists in entities
      const messageToResetEntity = state.messages.entities[assistantMessageToRegenerate.id]
      if (!messageToResetEntity) {
        // No need to check topicId again as selector implicitly handles it
        logger.error(
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
      cleanupMultipleBlocks(dispatch, blockIdsToDelete)

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
      logger.error(
        `[regenerateAssistantResponseThunk] Error regenerating response for assistant message ${assistantMessageToRegenerate.id}:`,
        error as Error
      )
      // dispatch(newMessagesActions.setTopicLoading({ topicId, loading: false }))
    } finally {
      finishTopicLoading(topicId)
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
        logger.error(`[initiateTranslationThunk] Original message ${messageId} not found.`)
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
      logger.error(`[initiateTranslationThunk] Failed for message ${messageId}:`, error as Error)
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
      logger.error(`[updateTranslationBlockThunk] Failed to update translation block ${blockId}:`, error as Error)
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
    assistant: Assistant, // Base assistant configuration
    traceId?: string
  ) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    try {
      const state = getState()

      // 1. Find the existing assistant message to get the original askId
      const existingAssistantMsg = state.messages.entities[existingAssistantMessageId]
      if (!existingAssistantMsg) {
        logger.error(
          `[appendAssistantResponseThunk] Existing assistant message ${existingAssistantMessageId} not found.`
        )
        return // Stop if the reference message doesn't exist
      }
      if (existingAssistantMsg.role !== 'assistant') {
        logger.error(
          `[appendAssistantResponseThunk] Message ${existingAssistantMessageId} is not an assistant message.`
        )
        return // Ensure it's an assistant message
      }
      const askId = existingAssistantMsg.askId
      if (!askId) {
        logger.error(
          `[appendAssistantResponseThunk] Existing assistant message ${existingAssistantMessageId} does not have an askId.`
        )
        return // Stop if askId is missing
      }

      // (Optional but recommended) Verify the original user query exists
      if (!state.messages.entities[askId]) {
        logger.error(
          `[appendAssistantResponseThunk] Original user query (askId: ${askId}) not found in entities. Cannot create assistant response without corresponding user message.`
        )

        // Show error popup instead of creating error message block
        window.message.error({
          content: t('error.missing_user_message'),
          key: 'missing-user-message-error'
        })

        return
      }

      // 2. Create the new assistant message stub
      const newAssistantStub = createAssistantMessage(assistant.id, topicId, {
        askId: askId, // Crucial: Use the original askId
        model: newModel,
        modelId: newModel.id,
        traceId: traceId
      })

      // 3. Update Redux Store
      const currentTopicMessageIds = getState().messages.messageIdsByTopic[topicId] || []
      const existingMessageIndex = currentTopicMessageIds.findIndex((id) => id === existingAssistantMessageId)
      const insertAtIndex = existingMessageIndex !== -1 ? existingMessageIndex + 1 : currentTopicMessageIds.length

      dispatch(newMessagesActions.insertMessageAtIndex({ topicId, message: newAssistantStub, index: insertAtIndex }))

      // 4. Update Database (Save the stub to the topic's message list)
      await saveMessageAndBlocksToDB(newAssistantStub, [], insertAtIndex)

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
      logger.error(`[appendAssistantResponseThunk] Error appending assistant response:`, error as Error)
      // Optionally dispatch an error action or notification
      // Resetting loading state should be handled by the underlying fetchAndProcessAssistantResponseImpl
    } finally {
      finishTopicLoading(topicId)
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
      logger.error(`[cloneMessagesToNewTopicThunk] Invalid newTopic provided.`)
      return false
    }
    try {
      const state = getState()
      const sourceMessages = selectMessagesForTopic(state, sourceTopicId)

      if (!sourceMessages || sourceMessages.length === 0) {
        logger.error(`[cloneMessagesToNewTopicThunk] Source topic ${sourceTopicId} not found or is empty.`)
        return false
      }

      // 1. Slice messages to clone
      const messagesToClone = sourceMessages.slice(0, branchPointIndex)
      if (messagesToClone.length === 0) {
        logger.warn(`[cloneMessagesToNewTopicThunk] No messages to branch (index ${branchPointIndex}).`)
        return true // Nothing to clone, operation considered successful but did nothing.
      }

      // 2. Prepare for cloning: Maps and Arrays
      const clonedMessages: Message[] = []
      const clonedBlocks: MessageBlock[] = []
      const filesToUpdateCount: FileMetadata[] = []
      const originalToNewMsgIdMap = new Map<string, string>() // Map original message ID -> new message ID

      // 3. Clone Messages and Blocks with New IDs
      for (const oldMessage of messagesToClone) {
        const newMsgId = uuid()
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
            logger.warn(
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
              const newBlockId = uuid()
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
              logger.warn(
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
      logger.error(`[cloneMessagesToNewTopicThunk] Failed to clone messages:`, error as Error)
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
      logger.error('[updateMessageAndUpdateBlocksThunk] Message ID is required.')
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
              logger.error(
                `[updateMessageAndBlocksThunk] Message ${messageId} not found in DB topic ${topicId} for property update.`
              )
              throw new Error(`Message ${messageId} not found in DB topic ${topicId} for property update.`)
            }
          } else {
            logger.error(
              `[updateMessageAndBlocksThunk] Topic ${topicId} not found or empty for message property update.`
            )
            throw new Error(`Topic ${topicId} not found or empty for message property update.`)
          }
        }

        if (blockUpdatesList.length > 0) {
          await db.message_blocks.bulkPut(blockUpdatesList)
        }
      })

      dispatch(updateTopicUpdatedAt({ topicId }))
    } catch (error) {
      logger.error(`[updateMessageAndBlocksThunk] Failed to process updates for message ${messageId}:`, error as Error)
    }
  }

export const removeBlocksThunk =
  (topicId: string, messageId: string, blockIdsToRemove: string[]) =>
  async (dispatch: AppDispatch, getState: () => RootState): Promise<void> => {
    if (!blockIdsToRemove.length) {
      logger.warn('[removeBlocksFromMessageThunk] No block IDs provided to remove.')
      return
    }

    try {
      const state = getState()
      const message = state.messages.entities[messageId]

      if (!message) {
        logger.error(`[removeBlocksFromMessageThunk] Message ${messageId} not found in state.`)
        return
      }
      const blockIdsToRemoveSet = new Set(blockIdsToRemove)

      const updatedBlockIds = (message.blocks || []).filter((id) => !blockIdsToRemoveSet.has(id))

      // 1. Update Redux state
      dispatch(newMessagesActions.updateMessage({ topicId, messageId, updates: { blocks: updatedBlockIds } }))

      cleanupMultipleBlocks(dispatch, blockIdsToRemove)

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

      dispatch(updateTopicUpdatedAt({ topicId }))

      return
    } catch (error) {
      logger.error(`[removeBlocksFromMessageThunk] Failed to remove blocks from message ${messageId}:`, error as Error)
      throw error
    }
  }
