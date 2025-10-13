import { cacheService } from '@data/CacheService'
import { loggerService } from '@logger'
import { AiSdkToChunkAdapter } from '@renderer/aiCore/chunk/AiSdkToChunkAdapter'
import { AgentApiClient } from '@renderer/api/agent'
import db from '@renderer/databases'
import { fetchMessagesSummary } from '@renderer/services/ApiService'
import { DbService } from '@renderer/services/db/DbService'
import FileManager from '@renderer/services/FileManager'
import { BlockManager } from '@renderer/services/messageStreaming/BlockManager'
import { createCallbacks } from '@renderer/services/messageStreaming/callbacks'
import { transformMessagesAndFetch } from '@renderer/services/OrchestrateService'
import { endSpan } from '@renderer/services/SpanManagerService'
import { createStreamProcessor, type StreamProcessorCallbacks } from '@renderer/services/StreamProcessingService'
import store from '@renderer/store'
import { updateTopicUpdatedAt } from '@renderer/store/assistants'
import { type ApiServerConfig, type Assistant, type FileMetadata, type Model, type Topic } from '@renderer/types'
import type { AgentSessionEntity, GetAgentSessionResponse } from '@renderer/types/agent'
import { ChunkType } from '@renderer/types/chunk'
import type { FileMessageBlock, ImageMessageBlock, Message, MessageBlock } from '@renderer/types/newMessage'
import { AssistantMessageStatus, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { uuid } from '@renderer/utils'
import { addAbortController } from '@renderer/utils/abortController'
import {
  buildAgentSessionTopicId,
  extractAgentSessionIdFromTopicId,
  isAgentSessionTopicId
} from '@renderer/utils/agentSession'
import {
  createAssistantMessage,
  createTranslationBlock,
  resetAssistantMessage
} from '@renderer/utils/messageUtils/create'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import { getTopicQueue, waitForTopicQueue } from '@renderer/utils/queue'
import { IpcChannel } from '@shared/IpcChannel'
import { defaultAppHeaders } from '@shared/utils'
import type { TextStreamPart } from 'ai'
import { t } from 'i18next'
import { isEmpty, throttle } from 'lodash'
import { LRUCache } from 'lru-cache'
import { mutate } from 'swr'

import type { AppDispatch, RootState } from '../index'
import { removeManyBlocks, updateOneBlock, upsertManyBlocks, upsertOneBlock } from '../messageBlock'
import { newMessagesActions, selectMessagesForTopic } from '../newMessage'
import {
  bulkAddBlocksV2,
  clearMessagesFromDBV2,
  deleteMessageFromDBV2,
  deleteMessagesFromDBV2,
  loadTopicMessagesThunkV2,
  saveMessageAndBlocksToDBV2,
  updateBlocksV2,
  updateFileCountV2,
  updateMessageV2,
  updateSingleBlockV2
} from './messageThunk.v2'

const logger = loggerService.withContext('MessageThunk')

const finishTopicLoading = async (topicId: string) => {
  await waitForTopicQueue(topicId)
  store.dispatch(newMessagesActions.setTopicLoading({ topicId, loading: false }))
  store.dispatch(newMessagesActions.setTopicFulfilled({ topicId, fulfilled: true }))
}

type AgentSessionContext = {
  agentId: string
  sessionId: string
  agentSessionId?: string
}

const agentSessionRenameLocks = new Set<string>()
const dbFacade = DbService.getInstance()

const findExistingAgentSessionContext = (
  state: RootState,
  topicId: string,
  assistantId: string
): AgentSessionContext | undefined => {
  if (!isAgentSessionTopicId(topicId)) {
    return undefined
  }

  const sessionId = extractAgentSessionIdFromTopicId(topicId)
  if (!sessionId) {
    return undefined
  }

  const messageIds = state.messages.messageIdsByTopic[topicId]
  let existingAgentSessionId: string | undefined

  if (messageIds?.length) {
    for (let index = messageIds.length - 1; index >= 0; index -= 1) {
      const messageId = messageIds[index]
      const message = state.messages.entities[messageId]
      const candidate = message?.agentSessionId?.trim()

      if (!candidate) {
        continue
      }

      if (message.assistantId !== assistantId) {
        continue
      }

      existingAgentSessionId = candidate
      break
    }
  }

  return {
    agentId: assistantId,
    sessionId,
    agentSessionId: existingAgentSessionId
  }
}

const buildAgentBaseURL = (apiServer: ApiServerConfig) => {
  const hasProtocol = apiServer.host.startsWith('http://') || apiServer.host.startsWith('https://')
  const baseHost = hasProtocol ? apiServer.host : `http://${apiServer.host}`
  const portSegment = apiServer.port ? `:${apiServer.port}` : ''
  return `${baseHost}${portSegment}`
}

const renameAgentSessionIfNeeded = async (
  agentSession: AgentSessionContext,
  assistant: Assistant,
  topicId: string,
  getState: () => RootState
): Promise<void> => {
  const lockId = `${agentSession.agentId}:${agentSession.sessionId}`
  if (agentSessionRenameLocks.has(lockId)) {
    return
  }

  try {
    const state = getState()
    const apiServer = state.settings.apiServer
    if (!apiServer?.apiKey) {
      return
    }

    const { messages } = await dbFacade.fetchMessages(topicId, true)
    if (!messages.length) {
      return
    }

    const summary = await fetchMessagesSummary({ messages, assistant })
    const summaryText = summary?.trim()
    if (!summaryText) {
      return
    }

    const baseURL = buildAgentBaseURL(apiServer)
    const client = new AgentApiClient({
      baseURL,
      headers: {
        Authorization: `Bearer ${apiServer.apiKey}`
      }
    })

    agentSessionRenameLocks.add(lockId)

    let session: GetAgentSessionResponse
    try {
      session = await client.getSession(agentSession.agentId, agentSession.sessionId)
    } catch (error) {
      logger.warn('Failed to fetch agent session for rename', error as Error)
      return
    }

    const currentName = (session.name ?? '').trim()
    if (currentName === summaryText) {
      return
    }

    let updatedSession: GetAgentSessionResponse
    try {
      updatedSession = await client.updateSession(agentSession.agentId, {
        id: agentSession.sessionId,
        name: summaryText
      })
    } catch (error) {
      logger.warn('Failed to update agent session name', error as Error)
      return
    }

    const paths = client.getSessionPaths(agentSession.agentId)

    try {
      await mutate(paths.withId(agentSession.sessionId), updatedSession, {
        revalidate: false
      })

      await mutate<AgentSessionEntity[]>(
        paths.base,
        (prev) =>
          prev?.map((sessionItem) =>
            sessionItem.id === updatedSession.id
              ? ({ ...sessionItem, name: updatedSession.name } as AgentSessionEntity)
              : sessionItem
          ) ?? prev,
        {
          revalidate: false
        }
      )
    } catch (error) {
      logger.warn('Failed to update agent session cache after rename', error as Error)
    }
  } catch (error) {
    logger.warn('Unexpected error during agent session rename', error as Error)
  } finally {
    agentSessionRenameLocks.delete(lockId)
  }
}

const createSSEReadableStream = (
  source: ReadableStream<Uint8Array>,
  signal: AbortSignal
): ReadableStream<TextStreamPart<Record<string, any>>> => {
  return new ReadableStream<TextStreamPart<Record<string, any>>>({
    start(controller) {
      const reader = source.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      const cancelReader = (reason?: any) => reader.cancel(reason).catch(() => {})

      const abortHandler = () => {
        cancelReader(signal.reason ?? 'aborted')
        controller.error(new DOMException('Aborted', 'AbortError'))
      }

      if (signal.aborted) {
        abortHandler()
        return
      }

      signal.addEventListener('abort', abortHandler, { once: true })

      const emitEvent = (eventString: string): boolean => {
        const lines = eventString.split(/\r?\n/)
        let dataPayload = ''
        for (const line of lines) {
          if (line.startsWith('data:')) {
            dataPayload += line.slice(5).trimStart()
          }
        }

        if (!dataPayload) {
          return false
        }

        if (dataPayload === '[DONE]') {
          signal.removeEventListener('abort', abortHandler)
          cancelReader()
          controller.close()
          return true
        }

        try {
          const parsed = JSON.parse(dataPayload) as TextStreamPart<Record<string, any>>
          controller.enqueue(parsed)
        } catch (error) {
          logger.warn('Failed to parse agent SSE chunk', { dataPayload })
        }
        return false
      }

      const pump = async () => {
        try {
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })

            let separatorIndex = buffer.indexOf('\n\n')
            while (separatorIndex !== -1) {
              const rawEvent = buffer.slice(0, separatorIndex).trim()
              buffer = buffer.slice(separatorIndex + 2)
              if (rawEvent) {
                const shouldStop = emitEvent(rawEvent)
                if (shouldStop) {
                  return
                }
              }
              separatorIndex = buffer.indexOf('\n\n')
            }
          }

          buffer += decoder.decode()
          if (buffer.trim()) {
            emitEvent(buffer.trim())
          }
          signal.removeEventListener('abort', abortHandler)
          controller.close()
        } catch (error) {
          signal.removeEventListener('abort', abortHandler)
          controller.error(error)
        }
      }

      pump().catch((error) => {
        signal.removeEventListener('abort', abortHandler)
        controller.error(error)
      })
    },
    cancel(reason) {
      return source.cancel(reason).catch(() => {})
    }
  })
}

const createAgentMessageStream = async (
  apiServer: ApiServerConfig,
  agentSession: AgentSessionContext,
  content: string,
  signal: AbortSignal
): Promise<ReadableStream<TextStreamPart<Record<string, any>>>> => {
  if (!apiServer.enabled) {
    throw new Error('Agent API server is disabled')
  }

  const baseURL = buildAgentBaseURL(apiServer)
  const url = `${baseURL}/v1/agents/${agentSession.agentId}/sessions/${agentSession.sessionId}/messages`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiServer.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache'
    },
    body: JSON.stringify({ content }),
    signal
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(errorText || `Failed to stream agent message: ${response.status}`)
  }

  if (!response.body) {
    throw new Error('Agent message stream has no body')
  }

  return createSSEReadableStream(response.body, signal)
}
// TODO: 后续可以将db操作移到Listener Middleware中
export const saveMessageAndBlocksToDB = async (message: Message, blocks: MessageBlock[], messageIndex: number = -1) => {
  return saveMessageAndBlocksToDBV2(message.topicId, message, blocks, messageIndex)
}

const updateExistingMessageAndBlocksInDB = async (
  updatedMessage: Partial<Message> & Pick<Message, 'id' | 'topicId'>,
  updatedBlocks: MessageBlock[]
) => {
  try {
    // Always update blocks if provided
    if (updatedBlocks.length > 0) {
      await updateBlocksV2(updatedBlocks)
    }

    // Check if there are message properties to update beyond id and topicId
    const messageKeysToUpdate = Object.keys(updatedMessage).filter((key) => key !== 'id' && key !== 'topicId')

    if (messageKeysToUpdate.length > 0) {
      const messageUpdatesPayload = messageKeysToUpdate.reduce<Partial<Message>>((acc, key) => {
        acc[key] = updatedMessage[key]
        return acc
      }, {})

      await updateMessageV2(updatedMessage.topicId, updatedMessage.id, messageUpdatesPayload)

      store.dispatch(updateTopicUpdatedAt({ topicId: updatedMessage.topicId }))
    }
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
      await updateSingleBlockV2(id, blockUpdate)
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
  // store.dispatch(updateOneBlock({ id, changes: blockUpdate }))
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

interface AgentStreamParams {
  topicId: string
  assistant: Assistant
  assistantMessage: Message
  agentSession: AgentSessionContext
  userMessageId: string
}

const fetchAndProcessAgentResponseImpl = async (
  dispatch: AppDispatch,
  getState: () => RootState,
  { topicId, assistant, assistantMessage, agentSession, userMessageId }: AgentStreamParams
) => {
  let callbacks: StreamProcessorCallbacks = {}
  try {
    dispatch(newMessagesActions.setTopicLoading({ topicId, loading: true }))

    const blockManager = new BlockManager({
      dispatch,
      getState,
      saveUpdatedBlockToDB,
      saveUpdatesToDB,
      assistantMsgId: assistantMessage.id,
      topicId,
      throttledBlockUpdate,
      cancelThrottledBlockUpdate
    })

    callbacks = createCallbacks({
      blockManager,
      dispatch,
      getState,
      topicId,
      assistantMsgId: assistantMessage.id,
      saveUpdatesToDB,
      assistant
    })

    const streamProcessorCallbacks = createStreamProcessor(callbacks)

    // Emit initial chunk to mirror assistant behaviour and ensure pending UI state
    streamProcessorCallbacks({ type: ChunkType.LLM_RESPONSE_CREATED })

    const state = getState()
    const userMessageEntity = state.messages.entities[userMessageId]
    const userContent = userMessageEntity ? getMainTextContent(userMessageEntity) : ''

    const abortController = new AbortController()
    addAbortController(userMessageId, () => abortController.abort())

    const stream = await createAgentMessageStream(
      state.settings.apiServer,
      agentSession,
      userContent,
      abortController.signal
    )

    let latestAgentSessionId = ''

    const persistAgentSessionId = async (sessionId: string) => {
      if (!sessionId || sessionId === latestAgentSessionId) {
        return
      }

      latestAgentSessionId = sessionId
      agentSession.agentSessionId = sessionId

      logger.debug(`Agent session ID updated`, {
        topicId,
        assistantMessageId: assistantMessage.id,
        value: sessionId
      })

      try {
        const stateAfterUpdate = getState()
        const assistantInState = stateAfterUpdate.messages.entities[assistantMessage.id]
        const userInState = stateAfterUpdate.messages.entities[userMessageId]

        const persistTasks: Promise<void>[] = []

        if (assistantInState?.agentSessionId !== sessionId) {
          dispatch(
            newMessagesActions.updateMessage({
              topicId,
              messageId: assistantMessage.id,
              updates: { agentSessionId: sessionId }
            })
          )
          persistTasks.push(saveUpdatesToDB(assistantMessage.id, topicId, { agentSessionId: sessionId }, []))
        }

        if (userInState && userInState.agentSessionId !== sessionId) {
          dispatch(
            newMessagesActions.updateMessage({
              topicId,
              messageId: userMessageId,
              updates: { agentSessionId: sessionId }
            })
          )
          persistTasks.push(saveUpdatesToDB(userMessageId, topicId, { agentSessionId: sessionId }, []))
        }

        if (persistTasks.length > 0) {
          await Promise.all(persistTasks)
        }
      } catch (error) {
        logger.error('Failed to persist agent session ID during stream', error as Error)
      }
    }

    const adapter = new AiSdkToChunkAdapter(streamProcessorCallbacks, [], false, false, (sessionId) => {
      persistAgentSessionId(sessionId)
    })

    await adapter.processStream({
      fullStream: stream,
      text: Promise.resolve('')
    })

    if (latestAgentSessionId) {
      await persistAgentSessionId(latestAgentSessionId)
    }

    await renameAgentSessionIfNeeded(agentSession, assistant, topicId, getState)
  } catch (error: any) {
    logger.error('Error in fetchAndProcessAgentResponseImpl:', error)
    try {
      callbacks.onError?.(error)
    } catch (callbackError) {
      logger.error('Error in agent onError callback:', callbackError as Error)
    } finally {
      dispatch(newMessagesActions.setTopicLoading({ topicId, loading: false }))
    }
  }
}

// Removed persistAgentExchange and createPersistedMessagePayload functions
// These are no longer needed since messages are saved immediately via appendMessage
// and updated during streaming via updateMessageAndBlocks

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
// 发送和处理助手响应的实现函数，话题提示词在此拼接
const fetchAndProcessAssistantResponseImpl = async (
  dispatch: AppDispatch,
  getState: () => RootState,
  topicId: string,
  origAssistant: Assistant,
  assistantMessage: Message // Pass the prepared assistant message (new or reset)
) => {
  const topic = origAssistant.topics.find((t) => t.id === topicId)
  const assistant = topic?.prompt
    ? { ...origAssistant, prompt: `${origAssistant.prompt}\n${topic.prompt}` }
    : origAssistant
  const assistantMsgId = assistantMessage.id
  let callbacks: StreamProcessorCallbacks = {}
  try {
    dispatch(newMessagesActions.setTopicLoading({ topicId, loading: true }))

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

    // Ensure at least the triggering user message is present to avoid empty payloads
    if ((!messagesForContext || messagesForContext.length === 0) && userMessageId) {
      const stateAfter = getState()
      const maybeUserMessage = stateAfter.messages.entities[userMessageId]
      if (maybeUserMessage) {
        messagesForContext = [maybeUserMessage]
      }
    }

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

    const abortController = new AbortController()
    addAbortController(userMessageId!, () => abortController.abort())

    await transformMessagesAndFetch(
      {
        messages: messagesForContext,
        assistant,
        topicId,
        options: {
          signal: abortController.signal,
          timeout: 30000,
          headers: defaultAppHeaders()
        }
      },
      streamProcessorCallbacks
    )
  } catch (error: any) {
    logger.error('Error in fetchAndProcessAssistantResponseImpl:', error)
    endSpan({
      topicId,
      error: error,
      modelName: assistant.model?.name
    })
    // 统一错误处理：确保 loading 状态被正确设置，避免队列任务卡住
    try {
      callbacks.onError?.(error)
    } catch (callbackError) {
      logger.error('Error in onError callback:', callbackError as Error)
    } finally {
      // 确保无论如何都设置 loading 为 false（onError 回调中已设置，这里是保险）
      dispatch(newMessagesActions.setTopicLoading({ topicId, loading: false }))
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
  (
    userMessage: Message,
    userMessageBlocks: MessageBlock[],
    assistant: Assistant,
    topicId: Topic['id'],
    agentSession?: AgentSessionContext
  ) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    try {
      if (userMessage.blocks.length === 0) {
        logger.warn('sendMessage: No blocks in the provided message.')
        return
      }

      const stateBeforeSend = getState()
      let activeAgentSession = agentSession ?? findExistingAgentSessionContext(stateBeforeSend, topicId, assistant.id)
      if (activeAgentSession) {
        const derivedSession = findExistingAgentSessionContext(stateBeforeSend, topicId, assistant.id)
        if (derivedSession?.agentSessionId && derivedSession.agentSessionId !== activeAgentSession.agentSessionId) {
          activeAgentSession = { ...activeAgentSession, agentSessionId: derivedSession.agentSessionId }
        }
      }
      if (activeAgentSession?.agentSessionId && !userMessage.agentSessionId) {
        userMessage.agentSessionId = activeAgentSession.agentSessionId
      }

      await saveMessageAndBlocksToDB(userMessage, userMessageBlocks)
      dispatch(newMessagesActions.addMessage({ topicId, message: userMessage }))
      if (userMessageBlocks.length > 0) {
        dispatch(upsertManyBlocks(userMessageBlocks))
      }
      dispatch(updateTopicUpdatedAt({ topicId }))

      const queue = getTopicQueue(topicId)

      if (activeAgentSession) {
        const assistantMessage = createAssistantMessage(assistant.id, topicId, {
          askId: userMessage.id,
          model: assistant.model,
          traceId: userMessage.traceId
        })
        if (activeAgentSession.agentSessionId && !assistantMessage.agentSessionId) {
          assistantMessage.agentSessionId = activeAgentSession.agentSessionId
        }
        await saveMessageAndBlocksToDB(assistantMessage, [])
        dispatch(newMessagesActions.addMessage({ topicId, message: assistantMessage }))

        queue.add(async () => {
          await fetchAndProcessAgentResponseImpl(dispatch, getState, {
            topicId,
            assistant,
            assistantMessage,
            agentSession: activeAgentSession,
            userMessageId: userMessage.id
          })
        })
      } else {
        const mentionedModels = userMessage.mentions

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
      }
    } catch (error) {
      logger.error('Error in sendMessage thunk:', error as Error)
    } finally {
      finishTopicLoading(topicId)
    }
  }

/**
 * Loads agent session messages from backend
 */
export const loadAgentSessionMessagesThunk =
  // oxlint-disable-next-line no-unused-vars
  (sessionId: string) => async (dispatch: AppDispatch, _getState: () => RootState) => {
    const topicId = buildAgentSessionTopicId(sessionId)

    try {
      dispatch(newMessagesActions.setTopicLoading({ topicId, loading: true }))

      // Fetch from agent backend
      const historicalMessages = await window.electron?.ipcRenderer.invoke(IpcChannel.AgentMessage_GetHistory, {
        sessionId
      })

      if (historicalMessages && Array.isArray(historicalMessages)) {
        const messages: Message[] = []
        const blocks: MessageBlock[] = []

        for (const persistedMsg of historicalMessages) {
          if (persistedMsg?.message) {
            messages.push(persistedMsg.message)
            if (persistedMsg.blocks && persistedMsg.blocks.length > 0) {
              blocks.push(...persistedMsg.blocks)
            }
          }
        }

        // Update Redux store
        if (blocks.length > 0) {
          dispatch(upsertManyBlocks(blocks))
        }
        dispatch(newMessagesActions.messagesReceived({ topicId, messages }))

        logger.silly(`Loaded ${messages.length} messages for agent session ${sessionId}`)
      } else {
        dispatch(newMessagesActions.messagesReceived({ topicId, messages: [] }))
      }
    } catch (error) {
      logger.error(`Failed to load agent session messages for ${sessionId}:`, error as Error)
      dispatch(newMessagesActions.messagesReceived({ topicId, messages: [] }))
    } finally {
      dispatch(newMessagesActions.setTopicLoading({ topicId, loading: false }))
    }
  }

/**
 * Loads messages and their blocks for a specific topic from the database
 * and updates the Redux store.
 */
export const loadTopicMessagesThunk =
  (topicId: string, forceReload: boolean = false) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    return loadTopicMessagesThunkV2(topicId, forceReload)(dispatch, getState)
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
      await deleteMessageFromDBV2(topicId, messageId)
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
    const messageIdsToDelete = messagesToDelete.map((m) => m.id)

    try {
      dispatch(newMessagesActions.removeMessagesByAskId({ topicId, askId }))
      cleanupMultipleBlocks(dispatch, blockIdsToDelete)
      await deleteMessagesFromDBV2(topicId, messageIdsToDelete)
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
      await clearMessagesFromDBV2(topicId)
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
        cacheService.delete(`web-search-${userMessageToResend.id}`)
        cacheService.delete(`knowledge-search-${userMessageToResend.id}`)
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
        window.toast.error(t('error.missing_user_message'))

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

      await updateSingleBlockV2(blockId, changes)
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
        window.toast.error(t('error.missing_user_message'))

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

      // 4. Update Database (Save the stub to the topic's message list)
      await saveMessageAndBlocksToDB(newAssistantStub, [], insertAtIndex)

      dispatch(newMessagesActions.insertMessageAtIndex({ topicId, message: newAssistantStub, index: insertAtIndex }))

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
              const newBlock = {
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
          await bulkAddBlocksV2(clonedBlocks)
        }
        // Update file counts
        const uniqueFiles = [...new Map(filesToUpdateCount.map((f) => [f.id, f])).values()]
        for (const file of uniqueFiles) {
          await updateFileCountV2(file.id, 1, false)
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
        // oxlint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: msgId, ...actualMessageChanges } = messageUpdates // Separate ID from actual changes

        // Only dispatch message update if there are actual changes beyond the ID
        if (Object.keys(actualMessageChanges).length > 0) {
          dispatch(newMessagesActions.updateMessage({ topicId, messageId, updates: actualMessageChanges }))
        }
      }

      if (blockUpdatesList.length > 0) {
        dispatch(upsertManyBlocks(blockUpdatesList))
      }
      // Update message properties if provided
      if (messageUpdates && Object.keys(messageUpdates).length > 0 && messageId) {
        await updateMessageV2(topicId, messageId, messageUpdates)
      }
      // Update blocks if provided
      if (blockUpdatesList.length > 0) {
        await updateBlocksV2(blockUpdatesList)
      }

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
