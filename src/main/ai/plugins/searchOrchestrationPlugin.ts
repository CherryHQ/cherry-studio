/**
 * Search orchestration plugin (Main).
 *
 * Lifecycle:
 *   - `onRequestStart`: Run a single intent-extraction LLM call to figure out
 *     which queries (if any) the assistant should use to search the web /
 *     knowledge base. The answer is cached per `requestId`.
 *   - `transformParams`: Inject `builtin_web_search` and / or
 *     `builtin_knowledge_search` tools into the request, pre-baked with the
 *     extracted queries so the model does not need to re-derive them.
 *   - `onRequestEnd`: Drop the cache entries.
 *
 * Memory storage (`storeConversationMemory` in the renderer original) is
 * dropped — `MemoryProcessor` was deleted upstream and the v2 Assistant
 * schema no longer carries the `enableMemory` toggle.
 *
 * Source of truth for the renderer original: commit 188f25478
 * (`src/renderer/src/aiCore/plugins/searchOrchestrationPlugin.ts`).
 */

import {
  type AiPlugin,
  type AiRequestContext,
  definePlugin,
  type StreamTextParams,
  type StreamTextResult
} from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import {
  SEARCH_SUMMARY_PROMPT,
  SEARCH_SUMMARY_PROMPT_KNOWLEDGE_ONLY,
  SEARCH_SUMMARY_PROMPT_WEB_ONLY
} from '@shared/config/prompts'
import type { WebSearchProviderId } from '@shared/data/preference/preferenceTypes'
import type { Assistant } from '@shared/data/types/assistant'
import { generateText, type LanguageModel, type ModelMessage } from 'ai'

import { knowledgeSearchTool } from '../tools/builtin/KnowledgeSearchTool'
import { BUILTIN_WEB_SEARCH_TOOL_NAME, webSearchToolWithPreExtractedKeywords } from '../tools/builtin/WebSearchTool'
import { extractInfoFromXML, type ExtractResults } from '../utils/extract'

const logger = loggerService.withContext('SearchOrchestrationPlugin')

/** Concatenate text parts of a ModelMessage into a single string. */
const getMessageContent = (message: ModelMessage): string => {
  if (typeof message.content === 'string') return message.content
  return message.content.reduce((acc, part) => {
    if (part.type === 'text') return acc + part.text + '\n'
    return acc
  }, '')
}

interface SearchOrchestrationConfig {
  assistant: Assistant
  topicId: string
  /** External 3rd-party web search provider id (Tavily / Bocha / etc.). When
   *  unset, the web search tool is not injected — knowledge search may still
   *  fire if the assistant has knowledge bases. */
  webSearchProviderId?: WebSearchProviderId
}

interface IntentAnalysisOptions {
  shouldWebSearch: boolean
  shouldKnowledgeSearch: boolean
  lastAnswer?: ModelMessage
  context: AiRequestContext
  topicId: string
}

/**
 * Decide whether the user's latest message needs web / knowledge search and,
 * if so, which queries to run. Mirrors the renderer `analyzeSearchIntent`
 * (deleted with `aiCore`), simplified for Main: the model object is already
 * resolved by ai-core and lives on `context.model`, so there's no need to
 * re-derive provider config.
 */
async function analyzeSearchIntent(
  lastUserMessage: ModelMessage,
  options: IntentAnalysisOptions
): Promise<ExtractResults | undefined> {
  const { shouldWebSearch, shouldKnowledgeSearch, lastAnswer, context, topicId } = options

  if (!shouldWebSearch && !shouldKnowledgeSearch) return undefined

  const prompt =
    shouldWebSearch && !shouldKnowledgeSearch
      ? SEARCH_SUMMARY_PROMPT_WEB_ONLY
      : !shouldWebSearch && shouldKnowledgeSearch
        ? SEARCH_SUMMARY_PROMPT_KNOWLEDGE_ONLY
        : SEARCH_SUMMARY_PROMPT

  const chatHistory = lastAnswer ? `assistant: ${getMessageContent(lastAnswer)}` : ''
  const question = getMessageContent(lastUserMessage)
  const formattedPrompt = prompt.replace('{chat_history}', chatHistory).replace('{question}', question)

  try {
    logger.info('Starting intent analysis', {
      topicId,
      requestId: context.requestId,
      hasWebSearch: shouldWebSearch,
      hasKnowledgeSearch: shouldKnowledgeSearch
    })

    const { text } = await generateText({
      model: context.model as LanguageModel,
      prompt: formattedPrompt
    })

    const parsed = extractInfoFromXML(text)
    return {
      websearch: shouldWebSearch ? parsed?.websearch : undefined,
      knowledge: shouldKnowledgeSearch ? parsed?.knowledge : undefined
    }
  } catch (error) {
    logger.error('Intent analysis failed, falling back to raw user message', error as Error)
    const fallback = question || 'search'
    return {
      websearch: shouldWebSearch ? { question: [fallback] } : undefined,
      knowledge: shouldKnowledgeSearch ? { question: [fallback], rewrite: fallback } : undefined
    }
  }
}

/**
 * Build the `search-orchestration` plugin. Returned plugin is stateful per
 * call — cached `intentAnalysisResults` and `userMessages` are keyed by
 * `requestId` and torn down in `onRequestEnd`.
 */
export const searchOrchestrationPlugin = (
  config: SearchOrchestrationConfig
): AiPlugin<StreamTextParams, StreamTextResult> => {
  const { assistant, topicId, webSearchProviderId } = config

  const intentAnalysisResults: Record<string, ExtractResults> = {}
  const userMessages: Record<string, ModelMessage> = {}

  const hasWebSearch = !!webSearchProviderId
  const knowledgeBaseIds = assistant.knowledgeBaseIds ?? []
  const hasKnowledgeBase = knowledgeBaseIds.length > 0

  return definePlugin<StreamTextParams, StreamTextResult>({
    name: 'search-orchestration',
    enforce: 'pre',

    onRequestStart: async (context) => {
      // Bail early if neither search source is available — saves an LLM round-trip.
      if (!hasWebSearch && !hasKnowledgeBase) return

      const messages = context.originalParams.messages
      if (!messages || messages.length === 0) return

      const lastUserMessage = messages[messages.length - 1]
      const lastAssistantMessage = messages.length >= 2 ? messages[messages.length - 2] : undefined

      userMessages[context.requestId] = lastUserMessage

      try {
        const result = await analyzeSearchIntent(lastUserMessage, {
          shouldWebSearch: hasWebSearch,
          shouldKnowledgeSearch: hasKnowledgeBase,
          lastAnswer: lastAssistantMessage,
          context,
          topicId
        })

        if (result) {
          intentAnalysisResults[context.requestId] = result
        }
      } catch (error) {
        logger.error('onRequestStart: intent analysis threw', error as Error)
        // Swallow — main flow must continue even if intent analysis fails.
      }
    },

    transformParams: async (params, context) => {
      const analysis = intentAnalysisResults[context.requestId]
      if (!analysis) return params

      params.tools = params.tools ?? {}

      // Web search: only if external provider is configured.
      if (hasWebSearch && webSearchProviderId && analysis.websearch) {
        const queries = analysis.websearch.question
        const needsSearch = queries && queries.length > 0 && queries[0] !== 'not_needed'
        if (needsSearch) {
          params.tools[BUILTIN_WEB_SEARCH_TOOL_NAME] = webSearchToolWithPreExtractedKeywords(
            webSearchProviderId,
            analysis.websearch,
            context.requestId
          )

          // Disable the builtin web search tool on later tool-loop steps
          // once it has been called. Without this gate, models that keep
          // re-invoking `builtin_web_search` across steps blow up token
          // usage with duplicated citation payloads (upstream #14466).
          const prepareStep = params.prepareStep
          params.prepareStep = async (options) => {
            const stepConfig = await prepareStep?.(options)
            const alreadySearched = options.steps.some((step) =>
              step.toolCalls.some((toolCall) => toolCall.toolName === BUILTIN_WEB_SEARCH_TOOL_NAME)
            )
            if (!alreadySearched) return stepConfig

            const allowed = stepConfig?.activeTools ?? Object.keys(params.tools!)
            return {
              ...stepConfig,
              activeTools: allowed.filter((toolName) => toolName !== BUILTIN_WEB_SEARCH_TOOL_NAME)
            }
          }
        }
      }

      // Knowledge search: only if assistant has knowledge bases attached.
      if (hasKnowledgeBase && analysis.knowledge) {
        const queries = analysis.knowledge.question
        const needsKnowledgeSearch = queries && queries.length > 0 && queries[0] !== 'not_needed'
        if (needsKnowledgeSearch) {
          const userMessage = userMessages[context.requestId]
          params.tools['builtin_knowledge_search'] = knowledgeSearchTool(
            assistant,
            analysis.knowledge,
            topicId,
            userMessage ? getMessageContent(userMessage) : undefined
          )
        }
      }

      return params
    },

    onRequestEnd: async (context) => {
      delete intentAnalysisResults[context.requestId]
      delete userMessages[context.requestId]
    }
  })
}

export default searchOrchestrationPlugin
