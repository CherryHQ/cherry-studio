import { OpenAICompatibleChatLanguageModel, OpenAICompatibleEmbeddingModel } from '@ai-sdk/openai-compatible'
import { type EmbeddingModelV3, type LanguageModelV3, NoSuchModelError, type ProviderV3 } from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import { loadApiKey, withoutTrailingSlash } from '@ai-sdk/provider-utils'
import { jsonSchema, tool } from 'ai'

export const MOONSHOT_PROVIDER_NAME = 'moonshot' as const

/** Kimi's reserved builtin-function name for server-side web search. */
export const KIMI_WEB_SEARCH_TOOL_NAME = '$web_search'

/**
 * Kimi's `$web_search` executes server-side but uses a client round-trip: the
 * model emits a tool call whose arguments must be echoed back verbatim as the
 * tool result, after which the server runs the search
 * (platform.kimi.com/docs/guide/use-web-search). Identity `execute` rides the
 * standard agent loop — tool-call limits and repair see a normal tool.
 */
export const kimiWebSearchEchoTool = tool({
  description: "Kimi's built-in web search; arguments are echoed back so the server executes the search.",
  inputSchema: jsonSchema<Record<string, unknown>>({ type: 'object', additionalProperties: true }),
  execute: async (input) => input
})

/**
 * The AI SDK serializes every tool as `{type:'function', function:{...}}`, but
 * Kimi declares builtins as `{type:'builtin_function', function:{name}}` (the
 * `$` prefix is reserved and rejected for normal functions). Rewrite the
 * declaration and any replayed assistant tool_calls to the builtin shape.
 */
export function transformMoonshotRequestBody(args: Record<string, any>): Record<string, any> {
  let next = args
  if (Array.isArray(next.tools) && next.tools.some((t: any) => t?.function?.name === KIMI_WEB_SEARCH_TOOL_NAME)) {
    next = {
      ...next,
      tools: next.tools.map((t: any) =>
        t?.function?.name === KIMI_WEB_SEARCH_TOOL_NAME
          ? { type: 'builtin_function', function: { name: KIMI_WEB_SEARCH_TOOL_NAME } }
          : t
      )
    }
  }
  if (Array.isArray(next.messages)) {
    let touched = false
    const messages = next.messages.map((message: any) => {
      if (message?.role !== 'assistant' || !Array.isArray(message.tool_calls)) return message
      if (!message.tool_calls.some((call: any) => call?.function?.name === KIMI_WEB_SEARCH_TOOL_NAME)) return message
      touched = true
      return {
        ...message,
        tool_calls: message.tool_calls.map((call: any) =>
          call?.function?.name === KIMI_WEB_SEARCH_TOOL_NAME ? { ...call, type: 'builtin_function' } : call
        )
      }
    })
    if (touched) next = { ...next, messages }
  }
  return next
}

export interface MoonshotProviderSettings {
  apiKey?: string
  baseURL?: string
  headers?: Record<string, string>
  fetch?: FetchFunction
  includeUsage?: boolean
}

export interface MoonshotProvider extends ProviderV3 {
  (modelId: string): LanguageModelV3
  languageModel(modelId: string): LanguageModelV3
  chatModel(modelId: string): LanguageModelV3
  embeddingModel(modelId: string): EmbeddingModelV3
  textEmbeddingModel(modelId: string): EmbeddingModelV3
}

export function createMoonshotProvider(settings: MoonshotProviderSettings = {}): MoonshotProvider {
  const { baseURL = 'https://api.moonshot.cn/v1', fetch: customFetch } = settings
  const url = ({ path }: { path: string; modelId: string }) => `${withoutTrailingSlash(baseURL)}${path}`
  const headers = () => ({
    Authorization: `Bearer ${loadApiKey({
      apiKey: settings.apiKey,
      environmentVariableName: 'MOONSHOT_API_KEY',
      description: 'Moonshot'
    })}`,
    ...settings.headers
  })

  const createChatModel = (modelId: string) =>
    new OpenAICompatibleChatLanguageModel(modelId, {
      provider: `${MOONSHOT_PROVIDER_NAME}.chat`,
      url,
      headers,
      fetch: customFetch,
      includeUsage: settings.includeUsage,
      transformRequestBody: transformMoonshotRequestBody
    })

  const createEmbeddingModel = (modelId: string) =>
    new OpenAICompatibleEmbeddingModel(modelId, {
      provider: `${MOONSHOT_PROVIDER_NAME}.embedding`,
      url,
      headers,
      fetch: customFetch
    })

  const provider = (modelId: string) => createChatModel(modelId)
  provider.specificationVersion = 'v3' as const
  provider.languageModel = createChatModel
  provider.chatModel = createChatModel
  provider.embeddingModel = createEmbeddingModel
  provider.textEmbeddingModel = createEmbeddingModel
  provider.imageModel = (modelId: string) => {
    throw new NoSuchModelError({ modelId, modelType: 'imageModel' })
  }

  return provider as MoonshotProvider
}
