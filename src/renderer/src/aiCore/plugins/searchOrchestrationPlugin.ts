/**
 * 搜索编排插件
 *
 * 功能：
 * 1. onRequestStart: 智能意图识别 - 分析是否需要网络搜索、知识库搜索、记忆搜索
 * 2. transformParams: 根据意图分析结果动态添加对应的工具
 * 3. onRequestEnd: 自动记忆存储
 */
import {
  type AiPlugin,
  type AiRequestContext,
  definePlugin,
  type StreamTextParams,
  type StreamTextResult
} from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
// import { generateObject } from '@cherrystudio/ai-core'
import { SEARCH_SUMMARY_PROMPT_WEB_ONLY } from '@renderer/config/prompts'
import { getDefaultModel, getProviderByModel } from '@renderer/services/AssistantService'
import type { Assistant } from '@renderer/types'
import type { ExtractResults } from '@renderer/utils/extract'
import { extractInfoFromXML } from '@renderer/utils/extract'
import type { LanguageModel, ModelMessage } from 'ai'
import { generateText } from 'ai'
import { isEmpty } from 'lodash'

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
 * 🧠 意图分析函数 - 使用 XML 解析
 */
async function analyzeSearchIntent(
  lastUserMessage: ModelMessage,
  assistant: Assistant,
  options: {
    shouldWebSearch?: boolean
    lastAnswer?: ModelMessage
    context: AiRequestContext
    topicId: string
  }
): Promise<ExtractResults | undefined> {
  const { shouldWebSearch = false, lastAnswer, context } = options

  if (!lastUserMessage) return undefined
  if (!shouldWebSearch) return undefined

  const prompt = SEARCH_SUMMARY_PROMPT_WEB_ONLY

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
      hasWebSearch: shouldWebSearch
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

    return {
      websearch: parsedResult?.websearch,
      knowledge: undefined
    }
  } catch (e: any) {
    logger.error('Intent analysis failed', e as Error)
    return getFallbackResult()
  }

  function getFallbackResult(): ExtractResults {
    const fallbackContent = getMessageContent(lastUserMessage)
    return {
      websearch: shouldWebSearch ? { question: [fallbackContent || 'search'] } : undefined,
      knowledge: undefined
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

  return definePlugin<StreamTextParams, StreamTextResult>({
    name: 'search-orchestration',
    enforce: 'pre', // 确保在其他插件之前执行
    /**
     * 🔍 Step 1: 意图识别阶段
     */
    onRequestStart: async (context) => {
      // 没开启任何搜索则不进行意图分析
      if (!assistant.webSearchProviderId) return

      try {
        const messages = context.originalParams.messages
        if (!messages || messages.length === 0) {
          return
        }

        const lastUserMessage = messages[messages.length - 1]
        const lastAssistantMessage = messages.length >= 2 ? messages[messages.length - 2] : undefined

        const shouldWebSearch = !!assistant.webSearchProviderId

        // 执行意图分析
        if (shouldWebSearch) {
          const analysisResult = await analyzeSearchIntent(lastUserMessage, assistant, {
            shouldWebSearch,
            lastAnswer: lastAssistantMessage,
            context,
            topicId
          })

          if (analysisResult) {
            intentAnalysisResults[context.requestId] = analysisResult
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
    transformParams: async (params, _context) => {
      // logger.info('🔧 Configuring tools based on intent...', context.requestId)

      try {
        // if (!intentAnalysisResults[context.requestId] || !assistant) {
        //   logger.info('🔧 No analysis result or assistant, skipping tool configuration')
        //   return params
        // }

        // 确保 tools 对象存在
        if (!params.tools) {
          params.tools = {}
        }

        // logger.info('🔧 Tools configured:', Object.keys(params.tools))
        return params
      } catch (error) {
        logger.error('🔧 Tool configuration failed:', error as Error)
        return params
      }
    },

    /**
     * 💾 Step 3: 记忆存储阶段
     */

    onRequestEnd: async (context) => {
      // context.isAnalyzing = false
      // logger.info('context.isAnalyzing', context, result)
      // logger.info('💾 Starting memory storage...', context.requestId)
      try {
        // ✅ 类型安全访问：context.originalParams 已通过泛型正确类型化
        // 清理缓存
        delete intentAnalysisResults[context.requestId]
      } catch (error) {
        logger.error('💾 Memory storage failed:', error as Error)
        // 不抛出错误，避免影响主流程
      }
    }
  })
}

export default searchOrchestrationPlugin
