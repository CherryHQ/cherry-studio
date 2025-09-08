import { loggerService } from '@logger'
import { createDeepResearchCitationCallbacks } from '@renderer/services/deepResearch/callbacks/citationCallbacks'
import { createDeepResearchTextCallbacks } from '@renderer/services/deepResearch/callbacks/textCallbacks'
import { createDeepResearchToolCallbacks } from '@renderer/services/deepResearch/callbacks/toolCallbacks'
import { DeepResearchService } from '@renderer/services/deepResearch/service'
import { BlockManager, createCallbacks } from '@renderer/services/messageStreaming'
import { createBaseCallbacks } from '@renderer/services/messageStreaming/callbacks/baseCallbacks'
import { createImageCallbacks } from '@renderer/services/messageStreaming/callbacks/imageCallbacks'
import { createThinkingCallbacks } from '@renderer/services/messageStreaming/callbacks/thinkingCallbacks'
import { createStreamProcessor } from '@renderer/services/StreamProcessingService'
import { AppDispatch, RootState } from '@renderer/store'
import { updateTopicUpdatedAt } from '@renderer/store/assistants'
import { deepResearchActions, ResearcherTask } from '@renderer/store/deepResearch'
import { upsertManyBlocks, upsertOneBlock } from '@renderer/store/messageBlock'
import { newMessagesActions } from '@renderer/store/newMessage'
import {
  cancelThrottledBlockUpdate,
  finishTopicLoading,
  saveMessageAndBlocksToDB,
  saveUpdatedBlockToDB,
  saveUpdatesToDB,
  throttledBlockUpdate
} from '@renderer/store/thunk/messageThunk'
import {
  MainTextMessageBlock,
  MessageBlock,
  MessageBlockStatus,
  MessageBlockType,
  UserMessageStatus
} from '@renderer/types/newMessage'
import { uuid } from '@renderer/utils'
import { createAssistantMessage } from '@renderer/utils/messageUtils/create'
import { getTopicQueue } from '@renderer/utils/queue'
import type { Assistant, Message, Topic } from '@types'

const logger = loggerService.withContext('DeepResearchThunk')

// 实际的researcher agent的最大运行次数为 MAX_RESEARCH_DEPTH * MAX_PARALLEL_RESEARCH_TASKS
const DEFAULT_MAX_RESEARCH_DEPTH = 3 // 最大递归深度
const DEFAULT_MAX_PARALLEL_RESEARCH_TASKS = 3 // 最大并行研究任务数
const api = new DeepResearchService()

export const canExecuteDeepResearch =
  (topic: Topic, assistant: Assistant) =>
  (_dispatch: AppDispatch, getState: () => RootState): boolean => {
    const enableWebSearch = assistant?.webSearchProviderId || assistant.enableWebSearch

    // TODO: 暂时无法区分mcp tools是否为搜索类工具
    const enableMCP = assistant?.mcpServers && assistant.mcpServers.length > 0
    if (!enableWebSearch && !enableMCP) {
      logger.warn('Deep Research requires web search or MCP tools to be enabled in the assistant settings.')

      window.message.error({
        content: 'Deep Research requires web search or MCP tools to be enabled in the assistant settings.',
        key: 'deep-research-no-websearch'
      })

      return false
    }

    const state = getState()
    const researchId = topic.id
    const research = state.deepResearch.researches[researchId]
    if (research && research.status !== 'clarifying') {
      logger.warn(`A Deep Research process is already running for topic ID ${topic.id}.`)
      window.message.error({
        content: 'A Deep Research process is already running for this topic.',
        key: 'deep-research-already-running'
      })
      return false
    }
    return true
  }

/**
 * [入口] 启动整个 Deep Research 流程
 */
export const executeDeepResearch =
  (userMessage: Message, userMessageBlocks: MessageBlock[], assistant: Assistant, topicId: Topic['id']) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    // 单一topic内只能有一个research
    const researchId = topicId
    try {
      if (userMessage.blocks.length === 0) {
        logger.warn('initiateDeepResearchThunk: No blocks in the provided message.')
        return
      }
      await saveMessageAndBlocksToDB(userMessage, userMessageBlocks)
      dispatch(newMessagesActions.addMessage({ topicId, message: userMessage }))
      if (userMessageBlocks.length > 0) {
        dispatch(upsertManyBlocks(userMessageBlocks))
      }
      dispatch(updateTopicUpdatedAt({ topicId }))

      // 1. 判断是否已经有research, 如果有，将消息视作clarifying
      const state = getState()
      if (state.deepResearch.researches[researchId]) {
        logger.info(`Research with ID ${researchId} already exists. Adding message as clarification.`)
        dispatch(deepResearchActions.addMessage({ researchId, message: userMessage.id }))
        await dispatch(clarificationStepThunk(researchId, topicId))
        return
      }

      // 1. 初始化 State
      dispatch(
        deepResearchActions.startResearch({
          researchId,
          initialMessage: userMessage.id,
          assistant,
          config: {
            maxResearchDepth: DEFAULT_MAX_RESEARCH_DEPTH,
            maxParallelResearchTasks: DEFAULT_MAX_PARALLEL_RESEARCH_TASKS
          }
        })
      )

      // 2. 进入流程的第一步：澄清
      await dispatch(clarificationStepThunk(researchId, topicId))
    } catch (error: any) {
      logger.error('Error in initiateDeepResearchThunk:', error)
      dispatch(deepResearchActions.setResearchError({ researchId, error: error.message }))
      dispatch(deepResearchActions.cleanupResearch({ researchId }))
    } finally {
      finishTopicLoading(topicId)
    }
  }

export const abortDeepResearch = (researchId: string) => async (dispatch: AppDispatch, getState: () => RootState) => {
  logger.info(`Aborting Deep Research with ID ${researchId}...`)
  const research = getState().deepResearch.researches[researchId]
  if (!research) {
    logger.warn(`abortDeepResearch: Research with ID ${researchId} not found.`)
    return
  }
  dispatch(deepResearchActions.updateStatus({ researchId, status: 'aborted' }))
  dispatch(deepResearchActions.cleanupResearch({ researchId }))
  const queue = getTopicQueue(researchId)
  queue.clear()
  await finishTopicLoading(researchId)
}

/**
 * [流程步骤 1] 澄清用户意图
 */
const clarificationStepThunk =
  (researchId: string, topicId: Topic['id']) => async (dispatch: AppDispatch, getState: () => RootState) => {
    try {
      const research = getState().deepResearch.researches[researchId]
      if (!research) {
        logger.error(`clarificationStepThunk: Research with ID ${researchId} not found.`)
        return
      }

      const assistant = research.assistant
      if (!assistant) {
        logger.error(`clarificationStepThunk: Assistant not found in research ID ${researchId}.`)
        return
      }

      const messageIds = research.messages
      const messages = messageIds
        .map((msgId) => getState().messages.entities[msgId])
        .filter((msg): msg is Message => !!msg)
      if (messages.length === 0) {
        logger.error(`clarificationStepThunk: No messages found in research ID ${researchId}.`)
        return
      }

      dispatch(newMessagesActions.setTopicLoading({ topicId, loading: true }))

      const latestMessage = messages[messages.length - 1]
      const blockId = uuid()
      const assistantMessage = createAssistantMessage(assistant.id, topicId, {
        askId: latestMessage.id,
        model: assistant.model,
        blocks: [blockId]
      })

      const placeholderBlock: MessageBlock = {
        id: blockId,
        type: MessageBlockType.UNKNOWN,
        messageId: assistantMessage.id,
        status: MessageBlockStatus.PROCESSING,
        createdAt: new Date().toISOString()
      }
      dispatch(newMessagesActions.addMessage({ topicId, message: assistantMessage }))
      dispatch(upsertOneBlock(placeholderBlock))

      const result = await api.clarifyQuery(messages, assistant)
      logger.info('Clarification result:', result)

      if (result.needClarification) {
        logger.info('Clarification needed, asking user for more info.')
        // 如果需要澄清，则向用户提问并暂停流程
        const block: MainTextMessageBlock = {
          ...placeholderBlock,
          type: MessageBlockType.MAIN_TEXT,
          content: result.question,
          status: MessageBlockStatus.SUCCESS
        }
        await saveMessageAndBlocksToDB(assistantMessage, [block])
        dispatch(upsertOneBlock(block))
        dispatch(deepResearchActions.addMessage({ researchId, message: assistantMessage.id }))
        // 流程在此处等待用户输入，可以由用户的新消息再次触发
        finishTopicLoading(topicId)
        return Promise.resolve()
      } else {
        // 如果不需要，则继续
        logger.info('No clarification needed, proceeding to briefing step.')
        const block: MainTextMessageBlock = {
          ...placeholderBlock,
          type: MessageBlockType.MAIN_TEXT,
          content: result.verification,
          status: MessageBlockStatus.SUCCESS
        }
        await saveMessageAndBlocksToDB(assistantMessage, [block])
        dispatch(upsertOneBlock(block))
        dispatch(deepResearchActions.addMessage({ researchId, message: assistantMessage.id }))
        await dispatch(briefingStepThunk(researchId)) // 进入下一步
      }
    } catch (error: any) {
      logger.error('Error in clarificationStepThunk:', error)
      dispatch(deepResearchActions.setResearchError({ researchId, error: error.message }))
      dispatch(deepResearchActions.cleanupResearch({ researchId }))
    }
  }

/**
 * [流程步骤 2] 生成研究简报
 */
const briefingStepThunk = (researchId: string) => async (dispatch: AppDispatch, getState: () => RootState) => {
  try {
    dispatch(deepResearchActions.updateStatus({ researchId, status: 'briefing' }))
    const state = getState()
    const research = state.deepResearch.researches[researchId]
    if (!research) {
      logger.warn(`research with id ${researchId} not exist.`)
      return
    }

    if (['succeeded', 'failed', 'aborted'].includes(research.status)) {
      logger.info(`Research with ID ${researchId} has already completed with status ${research.status}. Exiting...`)
      return
    }

    const messages = research.messages
      .map((msgId) => getState().messages.entities[msgId])
      .filter((msg): msg is Message => !!msg)

    const latestAssistantMessage = messages.findLast((m) => m.role === 'assistant')
    if (!latestAssistantMessage) {
      logger.error(`No assistant message found in research ID ${researchId}.`)
      return
    }

    const blockId = uuid()
    const placeholderBlock: MessageBlock = {
      id: blockId,
      type: MessageBlockType.UNKNOWN,
      messageId: latestAssistantMessage.id,
      status: MessageBlockStatus.PROCESSING,
      createdAt: new Date().toISOString()
    }
    dispatch(
      newMessagesActions.updateMessage({
        topicId: latestAssistantMessage.topicId,
        messageId: latestAssistantMessage.id,
        updates: { blocks: [...latestAssistantMessage.blocks, blockId] }
      })
    )
    dispatch(upsertOneBlock(placeholderBlock))

    const brief = await api.generateBrief(messages, research.assistant)
    logger.info(`research brief: ${brief}`)

    const block: MainTextMessageBlock = {
      ...placeholderBlock,
      type: MessageBlockType.MAIN_TEXT,
      content: brief,
      status: MessageBlockStatus.SUCCESS
    }
    dispatch(upsertOneBlock(block))

    dispatch(deepResearchActions.setResearchBrief({ researchId, brief }))

    await dispatch(supervisorStepThunk(researchId)) // 进入下一步
  } catch (error: any) {
    logger.error('Error in briefingStepThunk:', error)
    dispatch(deepResearchActions.setResearchError({ researchId, error: error.message }))
    dispatch(deepResearchActions.cleanupResearch({ researchId }))
  }
}

/**
 * [流程步骤 3] 主管生成研究员任务并分配, 聚合研究员结果，达到最大递归深度或满足要求后，进入最终报告生成
 */
const supervisorStepThunk = (researchId: string) => async (dispatch: AppDispatch, getState: () => RootState) => {
  try {
    const state = getState()
    const research = state.deepResearch.researches[researchId]
    if (!research) {
      logger.warn(`research with id ${researchId} not exist.`)
      return
    }

    if (['succeeded', 'failed', 'aborted'].includes(research.status)) {
      logger.info(`Research with ID ${researchId} has already completed with status ${research.status}. Exiting...`)
      return
    }

    const assistant = research.assistant
    if (!assistant) {
      logger.error(`supervisorStepThunk: Assistant not found in research ID ${researchId}.`)
      return
    }

    const currentDepth = research.supervisor.iterations
    const maxDepth = research.config.maxResearchDepth
    if (currentDepth >= maxDepth) {
      // TODO: 决策：达到最大深度要不要利用现有findings生成报告
      logger.error(`Reached max research depth of ${maxDepth}`)
      await dispatch(finalReportStepThunk(researchId))
      return
    }

    dispatch(deepResearchActions.updateStatus({ researchId, status: 'supervising' }))
    dispatch(deepResearchActions.incrementSupervisorIterations({ researchId }))

    const placeholderMessage: Message = {
      id: uuid(),
      assistantId: assistant.id,
      role: 'user',
      topicId: researchId,
      blocks: [],
      status: UserMessageStatus.SUCCESS,
      createdAt: new Date().toISOString(),
      askId: research.messages[0]
    }

    const currentFindings = Object.values(research.researcherTasks)
      .filter(
        (t): t is ResearcherTask & { compressedResult: string } => t.status === 'completed' && !!t.compressedResult
      )
      .map((t) => t.compressedResult)

    const { tasks, fulfilled } = await api.getResearchTopics(
      research.researchBrief,
      currentFindings,
      currentDepth + 1,
      maxDepth,
      research.config.maxParallelResearchTasks,
      [placeholderMessage],
      assistant
    )

    if (fulfilled) {
      logger.info(`Supervisor determined research is fulfilled. proceeding to final report generation.`)
      await dispatch(finalReportStepThunk(researchId))
    } else {
      logger.info('Supervisor determined research not fulfilled, continuing to next depth.')
      const researchTasks: ResearcherTask[] = tasks.map((topic: string) => ({
        id: uuid(),
        topic,
        status: 'pending',
        infoSources: []
      }))

      dispatch(
        deepResearchActions.addResearcherTasks({
          researchId,
          tasks: researchTasks
        })
      )

      // TODO: 目前暂时串行执行任务，后续需要改成并行，block交替更新
      const queue = getTopicQueue(researchId, { concurrency: 1 })

      researchTasks
        .map((task) => async () => await dispatch(runResearcherTaskThunk(researchId, task.id)))
        .forEach((job) => queue.add(job))

      await queue.onIdle()

      await dispatch(supervisorStepThunk(researchId))
    }
  } catch (error: any) {
    logger.error('Error in supervisorStepThunk:', error)
    dispatch(deepResearchActions.setResearchError({ researchId, error: error.message }))
    dispatch(deepResearchActions.cleanupResearch({ researchId }))
  }
}

/**
 * [流程步骤 3.1] 执行研究任务
 */
const runResearcherTaskThunk =
  (researchId: string, taskId: string) => async (dispatch: AppDispatch, getState: () => RootState) => {
    try {
      const state = getState()
      const research = state.deepResearch.researches[researchId]
      if (!research) {
        logger.warn(`research with id ${researchId} not exist.`)
        return
      }
      if (['succeeded', 'failed', 'aborted'].includes(research.status)) {
        logger.info(`Research with ID ${researchId} has already completed with status ${research.status}. Exiting...`)
        return
      }

      const task = state.deepResearch.researches[researchId]?.researcherTasks[taskId]
      if (!task) {
        logger.warn(`task with id ${taskId} not exist in research ${researchId}.`)
        return
      }

      dispatch(deepResearchActions.updateResearcherTask({ researchId, taskId, updates: { status: 'running' } }))

      const placeholderMessage: Message = {
        id: uuid(),
        assistantId: research.assistant.id,
        role: 'user',
        topicId: researchId,
        blocks: [],
        status: UserMessageStatus.SUCCESS,
        createdAt: new Date().toISOString(),
        askId: research.messages[0]
      }

      const latestAssistantMessage = research.messages
        .map((mId) => state.messages.entities[mId])
        .findLast((m) => m.role === 'assistant')
      if (!latestAssistantMessage) {
        logger.error(`No assistant message found in research ID ${researchId}.`)
        return
      }

      const blockManager = new BlockManager({
        dispatch,
        getState,
        saveUpdatedBlockToDB,
        saveUpdatesToDB,
        assistantMsgId: latestAssistantMessage.id,
        topicId: researchId,
        throttledBlockUpdate,
        cancelThrottledBlockUpdate
      })

      const callbacks = createResearcherCallbacks(
        researchId,
        taskId,
        blockManager,
        dispatch,
        getState,
        latestAssistantMessage.topicId,
        latestAssistantMessage.id,
        saveUpdatesToDB,
        research.assistant
      )
      const streamProcessorCallbacks = createStreamProcessor(callbacks)

      await api.runSingleResearch(task.topic, [placeholderMessage], research.assistant, streamProcessorCallbacks)

      const updatedTask = getState().deepResearch.researches[researchId]?.researcherTasks[taskId]
      if (!updatedTask) {
        logger.warn(`task with id ${taskId} not exist in research ${researchId}.`)
        return
      }

      if (['succeeded', 'failed', 'aborted'].includes(research.status)) {
        logger.info(`Research with ID ${researchId} has already completed with status ${research.status}. Exiting...`)
        return
      }

      const { compressedResult } = await api.compressResearchResult(
        updatedTask.topic,
        updatedTask.rawResult || '',
        updatedTask.infoSources,
        [placeholderMessage],
        research.assistant
      )

      if (!compressedResult) {
        logger.error(`Compression failed for task ${taskId} in research ${researchId}.`)
        throw new Error('Compression of research result failed.')
      }

      // 更新任务为 'completed' 并附上结果
      dispatch(
        deepResearchActions.updateResearcherTask({
          researchId,
          taskId,
          updates: { status: 'completed', compressedResult }
        })
      )
    } catch (error: any) {
      dispatch(
        deepResearchActions.updateResearcherTask({
          researchId,
          taskId,
          updates: { status: 'failed', error: error.message }
        })
      )
    }
  }

/**
 * [流程步骤 4] 生成最终报告
 */
const finalReportStepThunk = (researchId: string) => async (dispatch: AppDispatch, getState: () => RootState) => {
  try {
    const state = getState()
    const research = state.deepResearch.researches[researchId]
    if (!research) {
      logger.warn(`research with id ${researchId} not exist.`)
      return
    }

    if (['succeeded', 'failed', 'aborted'].includes(research.status)) {
      logger.info(`Research with ID ${researchId} has already completed with status ${research.status}. Exiting...`)
      return
    }

    const assistant = research.assistant
    if (!assistant) {
      logger.error(`finalReportStepThunk: Assistant not found in research ID ${researchId}.`)
      return
    }
    dispatch(deepResearchActions.updateStatus({ researchId, status: 'generatingReport' }))

    const compressedReports = Object.values(research.researcherTasks)
      .filter(
        (t): t is ResearcherTask & { compressedResult: string } => t.status === 'completed' && !!t.compressedResult
      )
      .map((t) => t.compressedResult)

    const latestAssistantMessage = research.messages
      .map((mId) => state.messages.entities[mId])
      .findLast((m) => m.role === 'assistant')
    if (!latestAssistantMessage) {
      logger.error(`No assistant message found in research ID ${researchId}.`)
      return
    }

    const messages = research.messages
      .map((msgId) => getState().messages.entities[msgId])
      .filter((msg): msg is Message => !!msg)

    const blockManager = new BlockManager({
      dispatch,
      getState,
      saveUpdatedBlockToDB,
      saveUpdatesToDB,
      assistantMsgId: latestAssistantMessage.id,
      topicId: researchId,
      throttledBlockUpdate,
      cancelThrottledBlockUpdate
    })

    const callbacks = createCallbacks({
      blockManager,
      dispatch,
      getState,
      topicId: latestAssistantMessage.topicId,
      assistantMsgId: latestAssistantMessage.id,
      saveUpdatesToDB,
      assistant
    })

    const streamProcessorCallbacks = createStreamProcessor(callbacks)

    await api.generateFinalReport(
      research.researchBrief,
      compressedReports,
      messages,
      assistant,
      streamProcessorCallbacks
    )
    dispatch(deepResearchActions.updateStatus({ researchId, status: 'succeeded' }))
    dispatch(deepResearchActions.cleanupResearch({ researchId }))
  } catch (error: any) {
    logger.error('Error in finalReportStepThunk:', error)
    dispatch(deepResearchActions.setResearchError({ researchId, error: error.message }))
    dispatch(deepResearchActions.cleanupResearch({ researchId }))
  }
}

const createResearcherCallbacks = (
  researchId: string,
  taskId: string,
  blockManager: BlockManager,
  dispatch: any,
  getState: any,
  topicId: string,
  assistantMsgId: string,
  saveUpdatesToDB: any,
  assistant: Assistant
) => {
  const baseCallbacks = createBaseCallbacks({
    blockManager,
    dispatch,
    getState,
    topicId,
    assistantMsgId,
    saveUpdatesToDB,
    assistant
  })

  // 创建各类回调
  const thinkingCallbacks = createThinkingCallbacks({
    blockManager,
    assistantMsgId
  })

  const toolCallbacks = createDeepResearchToolCallbacks({
    blockManager,
    assistantMsgId,

    dispatch,
    researchId,
    taskId
  })

  const imageCallbacks = createImageCallbacks({
    blockManager,
    assistantMsgId
  })

  const citationCallbacks = createDeepResearchCitationCallbacks({
    dispatch,
    getState,
    researchId,
    taskId,
    blockManager,
    assistantMsgId
  })

  const textCallbacks = createDeepResearchTextCallbacks({
    blockManager,
    getState,
    assistantMsgId,
    getCitationBlockId: citationCallbacks.getCitationBlockId,

    dispatch,
    researchId,
    taskId
  })

  const originalCallbacks = {
    ...baseCallbacks,
    ...textCallbacks,
    ...thinkingCallbacks,
    ...toolCallbacks,
    ...imageCallbacks,
    ...citationCallbacks,
    // 清理资源的方法
    cleanup: () => {
      // 清理由 messageThunk 中的节流函数管理，这里不需要特别处理
      // 如果需要，可以调用 blockManager 的相关清理方法
    }
  }

  // 组合所有回调
  return {
    ...originalCallbacks
  }
}
