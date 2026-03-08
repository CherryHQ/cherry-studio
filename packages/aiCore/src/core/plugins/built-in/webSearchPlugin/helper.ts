import { anthropic } from '@ai-sdk/anthropic'
import { google } from '@ai-sdk/google'
import { openai } from '@ai-sdk/openai'
import type { InferToolInput, InferToolOutput } from 'ai'
import { type Tool } from 'ai'

import { createOpenRouterOptions, createXaiOptions, mergeProviderOptions } from '../../../options'
import type { ProviderOptionsMap } from '../../../options/types'
import type { TypedProviderOptions } from '../../../options/types'
import type { AiRequestContext } from '../../'
import type { OpenRouterSearchConfig } from './openrouter'

/**
 * Moonshot built-in web search tool name.
 * Kept in sync with packages/shared/utils/moonshotBuiltinTools.ts
 */
const MOONSHOT_WEB_SEARCH_TOOL_NAME = '$web_search'

/**
 * Extract input config types from AI SDK tools for type safety.
 */
export type OpenAISearchConfig = NonNullable<Parameters<typeof openai.tools.webSearch>[0]>
export type OpenAISearchPreviewConfig = NonNullable<Parameters<typeof openai.tools.webSearchPreview>[0]>
export type AnthropicSearchConfig = NonNullable<Parameters<typeof anthropic.tools.webSearch_20250305>[0]>
export type GoogleSearchConfig = NonNullable<Parameters<typeof google.tools.googleSearch>[0]>
export type XAISearchConfig = NonNullable<ProviderOptionsMap['xai']['searchParameters']>

/**
 * Moonshot search configuration
 * Uses built-in function approach, no additional config needed
 */
export type MoonshotSearchConfig =
  | {
      type: 'builtin_function'
      function: { name: '$web_search' }
    }
  | boolean // true = use default config

type NormalizeTool<T> = T extends Tool<infer INPUT, infer OUTPUT> ? Tool<INPUT, OUTPUT> : Tool<any, any>

type AnthropicWebSearchTool = NormalizeTool<ReturnType<typeof anthropic.tools.webSearch_20250305>>
type OpenAIWebSearchTool = NormalizeTool<ReturnType<typeof openai.tools.webSearch>>
type OpenAIChatWebSearchTool = NormalizeTool<ReturnType<typeof openai.tools.webSearchPreview>>
type GoogleWebSearchTool = NormalizeTool<ReturnType<typeof google.tools.googleSearch>>

/**
 * Full plugin config accepted at initialization.
 * Shape is aligned with provider options for easier upstream management.
 */
export interface WebSearchPluginConfig {
  openai?: OpenAISearchConfig
  'openai-chat'?: OpenAISearchPreviewConfig
  anthropic?: AnthropicSearchConfig
  xai?: ProviderOptionsMap['xai']['searchParameters']
  google?: GoogleSearchConfig
  openrouter?: OpenRouterSearchConfig
  moonshot?: MoonshotSearchConfig
}

/**
 * Default plugin config.
 */
export const DEFAULT_WEB_SEARCH_CONFIG: WebSearchPluginConfig = {
  google: {},
  openai: {},
  'openai-chat': {},
  xai: {
    mode: 'on',
    returnCitations: true,
    maxSearchResults: 5,
    sources: [{ type: 'web' }, { type: 'x' }, { type: 'news' }]
  },
  anthropic: {
    maxUses: 5
  },
  openrouter: {
    plugins: [
      {
        id: 'web',
        max_results: 5
      }
    ]
  },
  moonshot: true
}

export type WebSearchToolOutputSchema = {
  // Anthropic tool (manually defined)
  anthropic: InferToolOutput<AnthropicWebSearchTool>

  // OpenAI tool output
  // TODO: upstream typing is unknown
  // openai: InferToolOutput<ReturnType<typeof openai.tools.webSearch>>
  openai: {
    status: 'completed' | 'failed'
  }
  'openai-chat': {
    status: 'completed' | 'failed'
  }
  // Google tool output
  // TODO: upstream typing is unknown
  // google: InferToolOutput<ReturnType<typeof google.tools.googleSearch>>
  google: {
    webSearchQueries?: string[]
    groundingChunks?: Array<{
      web?: { uri: string; title: string }
    }>
  }
}

export type WebSearchToolInputSchema = {
  anthropic: InferToolInput<AnthropicWebSearchTool>
  openai: InferToolInput<OpenAIWebSearchTool>
  google: InferToolInput<GoogleWebSearchTool>
  'openai-chat': InferToolInput<OpenAIChatWebSearchTool>
}

type ToolBasedParams = {
  tools?: unknown
  providerOptions?: unknown
  [key: string]: unknown
}

type ToolBasedSearchInstance = Tool<unknown, unknown> | Record<string, unknown>

function getToolsObject(tools: unknown): Record<string, unknown> {
  if (tools && typeof tools === 'object' && !Array.isArray(tools)) {
    return tools as Record<string, unknown>
  }
  return {}
}

/**
 * Applies tool-based web search configuration.
 */
const applyToolBasedSearch = (params: ToolBasedParams, toolName: string, toolInstance: ToolBasedSearchInstance) => {
  const currentTools = getToolsObject(params.tools)
  params.tools = {
    ...currentTools,
    [toolName]: toolInstance
  }
}

/**
 * Applies provider-options-based web search configuration.
 */
const applyProviderOptionsSearch = (params: ToolBasedParams, searchOptions: unknown) => {
  const currentProviderOptions = (params.providerOptions ?? {}) as Partial<TypedProviderOptions>
  params.providerOptions = mergeProviderOptions(currentProviderOptions, searchOptions as Partial<TypedProviderOptions>)
}

export const switchWebSearchTool = <T extends ToolBasedParams>(
  config: WebSearchPluginConfig,
  params: T,
  context?: AiRequestContext
) => {
  const providerId = context?.providerId

  // Provider-specific configuration map
  const providerHandlers: Record<string, () => void> = {
    openai: () => {
      const cfg = config.openai ?? DEFAULT_WEB_SEARCH_CONFIG.openai
      applyToolBasedSearch(params, 'web_search', openai.tools.webSearch(cfg))
    },
    'openai-chat': () => {
      const cfg = (config['openai-chat'] ?? DEFAULT_WEB_SEARCH_CONFIG['openai-chat']) as OpenAISearchPreviewConfig
      applyToolBasedSearch(params, 'web_search_preview', openai.tools.webSearchPreview(cfg))
    },
    anthropic: () => {
      const cfg = config.anthropic ?? DEFAULT_WEB_SEARCH_CONFIG.anthropic
      applyToolBasedSearch(params, 'web_search', anthropic.tools.webSearch_20250305(cfg))
    },
    google: () => {
      const cfg = (config.google ?? DEFAULT_WEB_SEARCH_CONFIG.google) as GoogleSearchConfig
      applyToolBasedSearch(params, 'web_search', google.tools.googleSearch(cfg))
    },
    xai: () => {
      const cfg = config.xai ?? DEFAULT_WEB_SEARCH_CONFIG.xai
      const searchOptions = createXaiOptions({ searchParameters: { ...cfg, mode: 'on' } })
      applyProviderOptionsSearch(params, searchOptions)
    },
    openrouter: () => {
      const cfg = (config.openrouter ?? DEFAULT_WEB_SEARCH_CONFIG.openrouter) as OpenRouterSearchConfig
      const searchOptions = createOpenRouterOptions(cfg)
      applyProviderOptionsSearch(params, searchOptions)
    },
    moonshot: () => {
      const cfg = config.moonshot ?? DEFAULT_WEB_SEARCH_CONFIG.moonshot

      if (cfg === false) return // Explicitly disabled

      // Moonshot uses builtin_function at outbound payload level.
      const builtInTool = {
        type: 'provider',
        toolType: 'builtin_function',
        description: 'Moonshot built-in web search',
        isBuiltin: true,
        definition: {
          type: 'builtin_function',
          function: {
            name: MOONSHOT_WEB_SEARCH_TOOL_NAME
          }
        },
        execute: async (argumentsPayload: unknown) => {
          // Built-in tools are executed on provider side.
          // Keep local fallback as arguments passthrough for recursive loops.
          return argumentsPayload ?? {}
        }
      }

      applyToolBasedSearch(params, MOONSHOT_WEB_SEARCH_TOOL_NAME, builtInTool)
    }
  }

  // Try provider-specific handler first
  const handler = providerId && providerHandlers[providerId]
  if (handler) {
    handler()
    return params
  }

  // Fallback: apply based on available config keys (prioritized order)
  const fallbackOrder: Array<keyof WebSearchPluginConfig> = [
    'openai',
    'openai-chat',
    'anthropic',
    'google',
    'xai',
    'openrouter',
    'moonshot'
  ]

  for (const key of fallbackOrder) {
    if (config[key]) {
      providerHandlers[key]()
      break
    }
  }

  return params
}
