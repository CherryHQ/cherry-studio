/**
 * 搜索编排插件
 *
 * 功能：
 * 1. onRequestStart: 智能意图识别 - 分析是否需要网络搜索、知识库搜索
 * 2. transformParams: 根据意图分析结果动态添加对应的工具
 * 3. onRequestEnd: 清理请求期缓存
 */
import {
  type AiPlugin,
  type AiRequestContext,
  definePlugin,
  type StreamTextParams,
  type StreamTextResult
} from '@cherrystudio/ai-core'
import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { getDefaultModel, getProviderByModel } from '@renderer/services/AssistantService'
import { autoRetainScheduler } from '@renderer/services/memory/AutoRetainScheduler'
import type { Assistant } from '@renderer/types'
import type { ExtractResults } from '@renderer/utils/extract'
import { extractInfoFromXML } from '@renderer/utils/extract'
// import { generateObject } from '@cherrystudio/ai-core'
import {
  SEARCH_SUMMARY_PROMPT,
  SEARCH_SUMMARY_PROMPT_KNOWLEDGE_ONLY,
  SEARCH_SUMMARY_PROMPT_WEB_ONLY
} from '@shared/config/prompts'
import type { LanguageModel, ModelMessage } from 'ai'
import { generateText } from 'ai'
import { isEmpty } from 'lodash'

import { knowledgeSearchTool } from '../tools/KnowledgeSearchTool'
import { memorySearchTool } from '../tools/MemorySearchTool'
import { webSearchToolWithPreExtractedKeywords } from '../tools/WebSearchTool'

const logger = loggerService.withContext('SearchOrchestrationPlugin')

export const getMessageContent = (message: ModelMessage) => {
  if (typeof message.content === 'string') return message.content
  return message.content.reduce((acc, part) => {
    if (part.type === 'text') {
      return acc + part.text + '\n'
    }
    return acc
  }, '')
}

// === Schema Definitions ===

// const WebSearchSchema = z.object({
//   question: z
//     .array(z.string())
//     .describe('Search queries for web search. Use "not_needed" if no web search is required.'),
//   links: z.array(z.string()).optional().describe('Specific URLs to search or summarize if mentioned in the query.')
// })

// const KnowledgeSearchSchema = z.object({
//   question: z
//     .array(z.string())
//     .describe('Search queries for knowledge base. Use "not_needed" if no knowledge search is required.'),
//   rewrite: z
//     .string()
//     .describe('Rewritten query with alternative phrasing while preserving original intent and meaning.')
// })

// const SearchIntentAnalysisSchema = z.object({
//   websearch: WebSearchSchema.optional().describe('Web search intent analysis results.'),
//   knowledge: KnowledgeSearchSchema.optional().describe('Knowledge base search intent analysis results.')
// })

// type SearchIntentResult = z.infer<typeof SearchIntentAnalysisSchema>

// let isAnalyzing = false
/**
 * 意图分析函数 - 使用 XML 解析
 */
async function analyzeSearchIntent(
  lastUserMessage: ModelMessage,
  assistant: Assistant,
  options: {
    shouldWebSearch?: boolean
    shouldKnowledgeSearch?: boolean
    lastAnswer?: ModelMessage
    context: AiRequestContext
    topicId: string
  }
): Promise<ExtractResults | undefined> {
  const { shouldWebSearch = false, shouldKnowledgeSearch = false, lastAnswer, context } = options

  if (!lastUserMessage) return undefined

  // 根据配置决定是否需要提取
  const needWebExtract = shouldWebSearch
  const needKnowledgeExtract = shouldKnowledgeSearch

  if (!needWebExtract && !needKnowledgeExtract) return undefined

  // 选择合适的提示词
  let prompt: string
  // let schema: z.Schema

  if (needWebExtract && !needKnowledgeExtract) {
    prompt = SEARCH_SUMMARY_PROMPT_WEB_ONLY
    // schema = z.object({ websearch: WebSearchSchema })
  } else if (!needWebExtract && needKnowledgeExtract) {
    prompt = SEARCH_SUMMARY_PROMPT_KNOWLEDGE_ONLY
    // schema = z.object({ knowledge: KnowledgeSearchSchema })
  } else {
    prompt = SEARCH_SUMMARY_PROMPT
    // schema = SearchIntentAnalysisSchema
  }

  // 构建消息上下文 - 简化逻辑
  const chatHistory = lastAnswer ? `assistant: ${getMessageContent(lastAnswer)}` : ''
  const question = getMessageContent(lastUserMessage) || ''

  // 使用模板替换变量
  const formattedPrompt = prompt.replace('{chat_history}', chatHistory).replace('{question}', question)

  // 获取模型和provider信息
  const model = assistant.model || getDefaultModel()
  const provider = getProviderByModel(model)

  if (!provider || isEmpty(provider.apiKey)) {
    logger.error('Provider not found or missing API key')
    return getFallbackResult()
  }
  try {
    logger.info('Starting intent analysis generateText call', {
      modelId: model.id,
      topicId: options.topicId,
      requestId: context.requestId,
      hasWebSearch: needWebExtract,
      hasKnowledgeSearch: needKnowledgeExtract
    })

    const { text: result } = await generateText({
      model: context.model as LanguageModel,
      prompt: formattedPrompt
    }).finally(() => {
      logger.info('Intent analysis generateText call completed', {
        modelId: model.id,
        topicId: options.topicId,
        requestId: context.requestId
      })
    })
    const parsedResult = extractInfoFromXML(result)
    logger.debug('Intent analysis result', { parsedResult })

    // 根据需求过滤结果
    return {
      websearch: needWebExtract ? parsedResult?.websearch : undefined,
      knowledge: needKnowledgeExtract ? parsedResult?.knowledge : undefined
    }
  } catch (e: any) {
    logger.error('Intent analysis failed', e as Error)
    return getFallbackResult()
  }

  function getFallbackResult(): ExtractResults {
    const fallbackContent = getMessageContent(lastUserMessage)
    return {
      websearch: shouldWebSearch ? { question: [fallbackContent || 'search'] } : undefined,
      knowledge: shouldKnowledgeSearch
        ? {
            question: [fallbackContent || 'search'],
            rewrite: fallbackContent || 'search'
          }
        : undefined
    }
  }
}

/**
 * 🎯 搜索编排插件
 */
export const searchOrchestrationPlugin = (
  assistant: Assistant,
  topicId: string
): AiPlugin<StreamTextParams, StreamTextResult> => {
  // 存储意图分析结果
  const intentAnalysisResults: { [requestId: string]: ExtractResults } = {}
  const userMessages: { [requestId: string]: ModelMessage } = {}

  return definePlugin<StreamTextParams, StreamTextResult>({
    name: 'search-orchestration',
    enforce: 'pre', // 确保在其他插件之前执行
    /**
     * 🔍 Step 1: 意图识别阶段
     */
    onRequestStart: async (context) => {
      // 没开启任何搜索则不进行意图分析
      if (!(assistant.webSearchProviderId || assistant.knowledge_bases?.length)) return

      try {
        const messages = context.originalParams.messages
        if (!messages || messages.length === 0) {
          return
        }

        const lastUserMessage = messages[messages.length - 1]
        const lastAssistantMessage = messages.length >= 2 ? messages[messages.length - 2] : undefined

        // 存储用户消息用于后续记忆存储
        userMessages[context.requestId] = lastUserMessage

        // 判断是否需要各种搜索
        const knowledgeBaseIds = assistant.knowledge_bases?.map((base) => base.id)
        const hasKnowledgeBase = !isEmpty(knowledgeBaseIds)
        const knowledgeRecognition = assistant.knowledgeRecognition || 'off'
        const shouldWebSearch = !!assistant.webSearchProviderId
        const shouldKnowledgeSearch = hasKnowledgeBase && knowledgeRecognition === 'on'

        // 执行意图分析
        if (shouldWebSearch || shouldKnowledgeSearch) {
          const analysisResult = await analyzeSearchIntent(lastUserMessage, assistant, {
            shouldWebSearch,
            shouldKnowledgeSearch,
            lastAnswer: lastAssistantMessage,
            context,
            topicId
          })

          if (analysisResult) {
            intentAnalysisResults[context.requestId] = analysisResult
            // logger.info('🧠 Intent analysis completed:', analysisResult)
          }
        }
      } catch (error) {
        logger.error('🧠 Intent analysis failed:', error as Error)
        // 不抛出错误，让流程继续
      }
    },

    /**
     * 🔧 Step 2: 工具配置阶段
     */
    transformParams: async (params, context) => {
      // logger.info('🔧 Configuring tools based on intent...', context.requestId)

      try {
        const analysisResult = intentAnalysisResults[context.requestId]
        // if (!analysisResult || !assistant) {
        //   logger.info('🔧 No analysis result or assistant, skipping tool configuration')
        //   return params
        // }

        // 确保 tools 对象存在
        if (!params.tools) {
          params.tools = {}
        }

        // 🌐 网络搜索工具配置
        if (analysisResult?.websearch && assistant.webSearchProviderId) {
          const needsSearch = analysisResult.websearch.question && analysisResult.websearch.question[0] !== 'not_needed'

          if (needsSearch) {
            // onChunk({ type: ChunkType.EXTERNEL_TOOL_IN_PROGRESS })
            // logger.info('🌐 Adding web search tool with pre-extracted keywords')
            params.tools['builtin_web_search'] = webSearchToolWithPreExtractedKeywords(
              assistant.webSearchProviderId,
              analysisResult.websearch,
              context.requestId
            )
          }
        }

        // 📚 知识库搜索工具配置
        const knowledgeBaseIds = assistant.knowledge_bases?.map((base) => base.id)
        const hasKnowledgeBase = !isEmpty(knowledgeBaseIds)
        const knowledgeRecognition = assistant.knowledgeRecognition || 'off'
        const shouldKnowledgeSearch = hasKnowledgeBase && knowledgeRecognition === 'on'

        if (shouldKnowledgeSearch) {
          // on 模式：根据意图识别结果决定是否添加工具
          const needsKnowledgeSearch =
            analysisResult?.knowledge &&
            analysisResult.knowledge.question &&
            analysisResult.knowledge.question[0] !== 'not_needed'

          if (needsKnowledgeSearch && analysisResult.knowledge) {
            // logger.info('📚 Adding knowledge search tool (intent-based)')
            const userMessage = userMessages[context.requestId]
            params.tools['builtin_knowledge_search'] = knowledgeSearchTool(
              assistant,
              analysisResult.knowledge,
              topicId,
              getMessageContent(userMessage)
            )
          }
        }

        // 🧠 Memory search tool configuration
        const memoryEnabled = await preferenceService.get('feature.memory.enabled')
        const memoryProvider = await preferenceService.get('feature.memory.provider')
        const shouldMemorySearch = memoryEnabled && memoryProvider !== 'off' && assistant.settings?.enableMemory

        if (shouldMemorySearch) {
          const userId = await preferenceService.get('feature.memory.current_user_id')
          params.tools['builtin_memory_search'] = memorySearchTool(userId, assistant.id, topicId)
        }

        // logger.info('🔧 Tools configured:', Object.keys(params.tools))
        return params
      } catch (error) {
        logger.error('🔧 Tool configuration failed:', error as Error)
        return params
      }
    },

    onRequestEnd: async (context) => {
      try {
        // 🧠 Memory auto-retain: schedule conversation turn for storage.
        const memoryEnabled = await preferenceService.get('feature.memory.enabled')
        const memoryProvider = await preferenceService.get('feature.memory.provider')
        const assistantSettings = assistant.settings

        if (memoryEnabled && memoryProvider !== 'off' && assistantSettings?.enableMemory) {
          const lastUserMsg = userMessages[context.requestId]
          if (lastUserMsg) {
            const content = getMessageContent(lastUserMsg)
            const debounceMs = (await preferenceService.get('feature.memory.auto_retain_debounce_ms')) ?? 1500
            const batchSize = (await preferenceService.get('feature.memory.auto_retain_batch_size')) ?? 8
            const userId = await preferenceService.get('feature.memory.current_user_id')

            autoRetainScheduler.schedule(content, { userId, agentId: assistant.id, topicId }, debounceMs, batchSize)
          }
        }

        // 清理缓存
        delete intentAnalysisResults[context.requestId]
        delete userMessages[context.requestId]
      } catch (error) {
        logger.error('Request cleanup failed:', error as Error)
        // 不抛出错误，避免影响主流程
      }
    }
  })
}

export default searchOrchestrationPlugin
