import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { fetchChatflowCompletion, fetchWorkflowCompletion } from '@renderer/services/FlowEngineService'
import { createStreamProcessor, type StreamProcessorCallbacks } from '@renderer/services/StreamProcessingService'
import type { Assistant, Flow, FlowNode } from '@renderer/types'
import { Chunk, ChunkType } from '@renderer/types/chunk'
import type { FlowMessageBlock, Message, MessageBlock } from '@renderer/types/newMessage'
import { AssistantMessageStatus, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { isAbortError } from '@renderer/utils/error'
import { createErrorBlock, createFlowBlock, createMainTextBlock } from '@renderer/utils/messageUtils/create'
import { findFlowBlocks, findLastFormBlock } from '@renderer/utils/messageUtils/find'
import { findLast } from 'lodash'

import type { AppDispatch, RootState } from '../index'
import { updateOneBlock, upsertOneBlock } from '../messageBlock'
import { newMessagesActions, selectMessagesForTopic } from '../newMessage'
import { handleChangeLoadingOfTopic, saveUpdatedBlockToDB, saveUpdatesToDB, throttledBlockUpdate } from './messageThunk'

function getCommonStreamLogic(
  dispatch: AppDispatch,
  getState: () => RootState,
  topicId: string,
  assistantMessage: Message,
  flowDefinition: Flow,
  streamState: {
    accumulatedContent: string
    lastBlockId: string | null
    lastBlockType: MessageBlockType | null
    flowBlockId: string | null
    formBlockId?: string | null
  }
) {
  const handleBlockTransition = (newBlock: MessageBlock, newBlockType: MessageBlockType) => {
    streamState.lastBlockId = newBlock.id
    streamState.lastBlockType = newBlockType
    if (newBlockType !== MessageBlockType.MAIN_TEXT) {
      streamState.accumulatedContent = ''
    }
    dispatch(
      newMessagesActions.updateMessage({
        topicId,
        messageId: assistantMessage.id,
        updates: { blockInstruction: { id: newBlock.id } }
      })
    )
    dispatch(upsertOneBlock(newBlock))
    dispatch(
      newMessagesActions.upsertBlockReference({
        messageId: assistantMessage.id,
        blockId: newBlock.id,
        status: newBlock.status
      })
    )
    const currentState = getState()
    const updatedMsgState = currentState.messages.entities[assistantMessage.id]
    if (updatedMsgState) {
      saveUpdatesToDB(
        assistantMessage.id,
        topicId,
        { blocks: updatedMsgState.blocks, status: updatedMsgState.status },
        [newBlock]
      )
    } else {
      console.error(
        `[CommonLogic handleBlockTransition] Failed to get updated message ${assistantMessage.id} for DB save.`
      )
    }
  }

  const onTextChunk = (text: string) => {
    streamState.accumulatedContent += text
    if (!streamState.lastBlockId || streamState.lastBlockType !== MessageBlockType.MAIN_TEXT) {
      const newBlock = createMainTextBlock(assistantMessage.id, streamState.accumulatedContent, {
        status: MessageBlockStatus.STREAMING
      })
      handleBlockTransition(newBlock, MessageBlockType.MAIN_TEXT)
    } else {
      const blockChanges: Partial<MessageBlock> = {
        content: streamState.accumulatedContent,
        status: MessageBlockStatus.STREAMING
      }
      throttledBlockUpdate(streamState.lastBlockId!, blockChanges)
    }
  }

  const onTextComplete = (finalText: string, logPrefix: string) => {
    if (streamState.lastBlockType === MessageBlockType.MAIN_TEXT && streamState.lastBlockId) {
      const changes = {
        content: finalText,
        status: MessageBlockStatus.SUCCESS
      }
      dispatch(updateOneBlock({ id: streamState.lastBlockId, changes }))
      saveUpdatedBlockToDB(streamState.lastBlockId, assistantMessage.id, topicId, getState)
    } else {
      console.warn(
        `${logPrefix} Received text.complete but last block was not MAIN_TEXT (was ${streamState.lastBlockType}) or lastBlockId is null.`
      )
    }
  }

  const onWorkflowStarted = async (chunk: Chunk) => {
    if (chunk.type === ChunkType.WORKFLOW_STARTED && flowDefinition) {
      // dispatch(
      //   newMessagesActions.updateMessage({
      //     topicId,
      //     messageId: assistantMessage.id,
      //     updates: { conversationId: conversationId }
      //   })
      // )

      // // 保存 conversationId 到数据库
      // saveUpdatesToDB(assistantMessage.id, topicId, { conversationId }, [])

      const overrides = {
        status: MessageBlockStatus.PROCESSING,
        conversationId: chunk.conversationId,
        taskId: chunk.taskId
      }

      const flowBlock = createFlowBlock(assistantMessage.id, chunk.type, flowDefinition, overrides)
      streamState.flowBlockId = flowBlock.id

      handleBlockTransition(flowBlock, MessageBlockType.FLOW)
    }
  }

  const onWorkflowNodeInProgress = (chunk: Chunk) => {
    if (streamState.flowBlockId && chunk.type === ChunkType.WORKFLOW_NODE_STARTED && flowDefinition) {
      const node: FlowNode = {
        status: MessageBlockStatus.PROCESSING,
        id: chunk.metadata.id,
        title: chunk.metadata.title,
        type: chunk.metadata.type
      }

      const currentFlowBlock = getState().messageBlocks.entities[streamState.flowBlockId] as FlowMessageBlock

      const changes = {
        nodes: [...(currentFlowBlock?.nodes || []), node]
      }

      dispatch(updateOneBlock({ id: streamState.flowBlockId, changes }))
      saveUpdatedBlockToDB(streamState.flowBlockId, assistantMessage.id, topicId, getState)
    }
  }

  const onWorkflowNodeComplete = (chunk: Chunk) => {
    if (streamState.flowBlockId && chunk.type === ChunkType.WORKFLOW_NODE_FINISHED) {
      const currentFlowBlock = getState().messageBlocks.entities[streamState.flowBlockId] as FlowMessageBlock

      if (!currentFlowBlock.nodes) {
        return
      }

      const changes: Partial<FlowMessageBlock> = {
        nodes: currentFlowBlock.nodes.map((node) => {
          if (node.id === chunk.metadata.id) {
            return {
              ...node,
              status: MessageBlockStatus.SUCCESS
            }
          }
          return node
        })
      }

      dispatch(updateOneBlock({ id: streamState.flowBlockId, changes }))
      saveUpdatedBlockToDB(streamState.flowBlockId, assistantMessage.id, topicId, getState)
    }
  }

  const onWorkflowFinished = (chunk: Chunk) => {
    if (streamState.flowBlockId && chunk.type === ChunkType.WORKFLOW_FINISHED) {
      const changes: Partial<FlowMessageBlock> = {
        status: MessageBlockStatus.SUCCESS
      }
      dispatch(updateOneBlock({ id: streamState.flowBlockId, changes }))
      saveUpdatedBlockToDB(streamState.flowBlockId, assistantMessage.id, topicId, getState)

      const messageUpdates: Partial<Message> = {
        status: AssistantMessageStatus.SUCCESS
      }

      dispatch(
        newMessagesActions.updateMessage({
          topicId,
          messageId: assistantMessage.id,
          updates: messageUpdates
        })
      )
      saveUpdatesToDB(assistantMessage.id, topicId, messageUpdates, [])

      EventEmitter.emit(EVENT_NAMES.MESSAGE_COMPLETE, {
        id: assistantMessage.id,
        topicId,
        status: 'success'
      })
    }
  }

  const onError = (error) => {
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
    if (streamState.lastBlockId) {
      const changes: Partial<MessageBlock> = {
        status: MessageBlockStatus.ERROR
      }
      dispatch(updateOneBlock({ id: streamState.lastBlockId, changes }))
      saveUpdatedBlockToDB(streamState.lastBlockId, assistantMessage.id, topicId, getState)
    }

    const errorBlock = createErrorBlock(assistantMessage.id, serializableError, { status: MessageBlockStatus.SUCCESS })
    handleBlockTransition(errorBlock, MessageBlockType.ERROR)
    const messageErrorUpdate = {
      status: isAbortError(error) ? AssistantMessageStatus.SUCCESS : AssistantMessageStatus.ERROR
    }
    dispatch(newMessagesActions.updateMessage({ topicId, messageId: assistantMessage.id, updates: messageErrorUpdate }))

    saveUpdatesToDB(assistantMessage.id, topicId, messageErrorUpdate, [])

    EventEmitter.emit(EVENT_NAMES.MESSAGE_COMPLETE, {
      id: assistantMessage.id,
      topicId,
      status: isAbortError(error) ? 'pause' : 'error',
      error: error.message
    })
  }
  return {
    onTextChunk,
    onTextComplete,
    onWorkflowStarted,
    onWorkflowNodeInProgress,
    onWorkflowNodeComplete,
    onWorkflowFinished,
    handleBlockTransition,
    onError
  }
}

export const fetchAndProcessChatflowResponseImpl = async (
  dispatch: AppDispatch,
  getState: () => RootState,
  topicId: string,
  assistant: Assistant,
  assistantMessage: Message
) => {
  dispatch(newMessagesActions.setTopicLoading({ topicId, loading: true }))

  const allMessagesForTopic = selectMessagesForTopic(getState(), topicId)
  const lastUserMessage = findLast(allMessagesForTopic, (m) => m.role === 'user')
  const secondLastAssistantMessage = findLast(allMessagesForTopic, (m) => m.role === 'assistant', 2)
  // 获取倒数第二条assistant消息
  // const conversationId = secondLastAssistantMessage?.conversationId ?? ''
  const lastFlowBlock = findFlowBlocks(secondLastAssistantMessage).pop()
  const conversationId = lastFlowBlock?.conversationId ?? ''
  // 从最后一个FormBlock中获取inputs
  const lastFormBlock = findLastFormBlock(allMessagesForTopic.filter((m) => m.role === 'assistant'))
  const inputs = lastFormBlock?.flow?.inputs || {}

  if (!lastUserMessage) {
    dispatch(newMessagesActions.setTopicLoading({ topicId, loading: false }))
    return
  }

  if (!assistant.chatflow) {
    console.error('Assistant chatflow configuration is missing.')
    dispatch(newMessagesActions.setTopicLoading({ topicId, loading: false }))
    return
  }

  const streamState = {
    accumulatedContent: '',
    lastBlockId: null as string | null,
    lastBlockType: null as MessageBlockType | null,
    flowBlockId: null as string | null,
    formBlockId: lastFormBlock?.id ?? null
  }

  const commonLogic = getCommonStreamLogic(
    dispatch,
    getState,
    topicId,
    assistantMessage,
    assistant.chatflow,
    streamState
  )
  let callbacks: StreamProcessorCallbacks = {}

  try {
    callbacks = {
      onTextChunk: commonLogic.onTextChunk,
      onTextComplete: (finalText) => commonLogic.onTextComplete(finalText, '[Chatflow onTextComplete]'),
      onWorkflowStarted: (chunk) => commonLogic.onWorkflowStarted(chunk),
      onWorkflowNodeInProgress: (chunk) => commonLogic.onWorkflowNodeInProgress(chunk),
      onWorkflowNodeComplete: (chunk) => commonLogic.onWorkflowNodeComplete(chunk),
      onWorkflowFinished: (chunk) => commonLogic.onWorkflowFinished(chunk),
      onError: (error) => commonLogic.onError(error)
    }

    const streamProcessorCallbacks = createStreamProcessor(callbacks)

    await fetchChatflowCompletion({
      assistant: assistant,
      message: lastUserMessage,
      conversationId: conversationId ?? '',
      inputs: inputs,
      onChunkReceived: streamProcessorCallbacks
    })
  } catch (error: any) {
    console.error(`Error in processChatflowResponseThunk for message ${assistantMessage.id}:`, error)
    if (callbacks && callbacks.onError) {
      callbacks.onError(error)
    }
  } finally {
    handleChangeLoadingOfTopic(topicId)
  }
}

export const fetchAndProcessWorkflowResponseImpl = async (
  dispatch: AppDispatch,
  getState: () => RootState,
  assistant: Assistant,
  assistantMessage: Message
) => {
  if (!assistantMessage.flow) {
    console.error(
      `[WorkflowResponseImpl] Workflow definition is missing in the provided assistantMessage (ID: ${assistantMessage.id}).`
    )
    const messageErrorUpdate = { status: AssistantMessageStatus.ERROR }
    dispatch(
      newMessagesActions.updateMessage({
        topicId: assistantMessage.topicId,
        messageId: assistantMessage.id,
        updates: messageErrorUpdate
      })
    )
    saveUpdatesToDB(assistantMessage.id, assistantMessage.topicId, messageErrorUpdate, [])
    handleChangeLoadingOfTopic(assistantMessage.topicId)
    return
  }

  const allMessagesForTopic = selectMessagesForTopic(getState(), assistantMessage.topicId)

  const assistantMessages = allMessagesForTopic.filter((m) => m.role === 'assistant')
  const lastFormBlock = findLastFormBlock(assistantMessages)

  const inputs: Record<string, string> = lastFormBlock?.flow?.inputs || assistantMessage.flow.inputs || {}

  const formBlockIdForStreamState: string | null = lastFormBlock?.id ?? null

  dispatch(newMessagesActions.setTopicLoading({ topicId: assistantMessage.topicId, loading: true }))

  const streamState = {
    accumulatedContent: '',
    lastBlockId: null as string | null,
    lastBlockType: null as MessageBlockType | null,
    flowBlockId: null as string | null,
    formBlockId: formBlockIdForStreamState
  }

  const commonLogic = getCommonStreamLogic(
    dispatch,
    getState,
    assistantMessage.topicId,
    assistantMessage,
    assistantMessage.flow,
    streamState
  )
  let callbacks: StreamProcessorCallbacks = {}

  try {
    callbacks = {
      onTextChunk: commonLogic.onTextChunk,
      onTextComplete: (finalText) => commonLogic.onTextComplete(finalText, '[Workflow onTextComplete]'),
      onWorkflowStarted: (chunk) => commonLogic.onWorkflowStarted(chunk),
      onWorkflowNodeInProgress: (chunk) => commonLogic.onWorkflowNodeInProgress(chunk),
      onWorkflowNodeComplete: (chunk) => commonLogic.onWorkflowNodeComplete(chunk),
      onWorkflowFinished: (chunk) => commonLogic.onWorkflowFinished(chunk),
      onError: (error) => commonLogic.onError(error)
    }
    const streamProcessorCallbacks = createStreamProcessor(callbacks)

    await fetchWorkflowCompletion({
      message: assistantMessage,
      assistant: assistant,
      inputs: inputs,
      onChunkReceived: streamProcessorCallbacks
    })
  } catch (error: any) {
    console.error(`Error processing workflow response for message ${assistantMessage.id}:`, error)
    if (callbacks && callbacks.onError) {
      callbacks.onError(error)
    }
  } finally {
    handleChangeLoadingOfTopic(assistantMessage.topicId)
  }
}
