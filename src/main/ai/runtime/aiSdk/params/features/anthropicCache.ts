/**
 * Anthropic Prompt Caching Middleware
 *
 * Adds `providerOptions.anthropic.cacheControl = { type: 'ephemeral' }` markers
 * on qualifying system / tool / trailing-message breakpoints so Anthropic-compatible
 * providers re-use stable prompt prefixes.
 *
 * @see https://ai-sdk.dev/providers/ai-sdk-providers/anthropic#cache-control
 */

import type { LanguageModelV3CallOptions, LanguageModelV3FunctionTool, LanguageModelV3Message } from '@ai-sdk/provider'
import { definePlugin } from '@cherrystudio/ai-core'
import { resolveAnthropicCacheSettings } from '@shared/ai/anthropicCache'
import type { Assistant } from '@shared/data/types/assistant'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { LanguageModelMiddleware } from 'ai'
import { estimateTokenCount } from 'tokenx'

import { VOLATILE_PROMPT_VARIABLES } from '../../../../../utils/prompt'
import type { RequestFeature } from '../feature'

const MAX_CACHE_BREAKPOINTS = 4
const cacheProviderOptions = {
  anthropic: { cacheControl: { type: 'ephemeral' } }
} as const

function hasVolatilePromptVariables(assistant: Assistant | undefined): boolean {
  const prompt = assistant?.prompt
  return Boolean(prompt && VOLATILE_PROMPT_VARIABLES.some((variable) => prompt.includes(variable)))
}

function estimateContentTokens(content: LanguageModelV3Message['content']): number {
  if (typeof content === 'string') return estimateTokenCount(content)
  if (Array.isArray(content)) {
    return content.reduce((acc, part) => {
      if (part.type === 'text') return acc + estimateTokenCount(part.text)

      const serializedPayload = JSON.stringify({
        input: 'input' in part ? part.input : undefined,
        output: 'output' in part ? part.output : undefined
      })
      return serializedPayload === '{}' ? acc : acc + estimateTokenCount(serializedPayload)
    }, 0)
  }
  return 0
}

function estimateToolTokens(tool: LanguageModelV3FunctionTool): number {
  return estimateTokenCount(
    JSON.stringify({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema
    })
  )
}

function compareCacheKeys(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function isFunctionTool(
  tool: NonNullable<LanguageModelV3CallOptions['tools']>[number]
): tool is LanguageModelV3FunctionTool {
  return tool.type === 'function'
}

function withCacheProviderOptions<T extends { providerOptions?: unknown }>(value: T): T {
  return {
    ...value,
    providerOptions: {
      ...(value.providerOptions && typeof value.providerOptions === 'object' ? value.providerOptions : {}),
      anthropic: {
        ...(value.providerOptions as { anthropic?: object } | undefined)?.anthropic,
        cacheControl: cacheProviderOptions.anthropic.cacheControl
      }
    }
  }
}

interface CacheBreakpointBudget {
  remaining: number
  use(): boolean
}

function createCacheBreakpointBudget(): CacheBreakpointBudget {
  return {
    remaining: MAX_CACHE_BREAKPOINTS,
    use() {
      if (this.remaining <= 0) return false
      this.remaining--
      return true
    }
  }
}

function hasCacheableContent(msg: LanguageModelV3Message): boolean {
  return msg.content.length > 0
}

function sortToolsForCache(tools: LanguageModelV3CallOptions['tools']): LanguageModelV3CallOptions['tools'] {
  if (!tools?.length) return tools
  return [...tools].sort((a, b) => {
    const aName = isFunctionTool(a) ? a.name : a.id
    const bName = isFunctionTool(b) ? b.name : b.id
    return compareCacheKeys(aName, bName)
  })
}

function estimateToolsPrefix(sortedTools: LanguageModelV3CallOptions['tools']): {
  totalTokens: number
  markerIndex: number
} {
  let totalTokens = 0
  let markerIndex = -1
  for (let i = 0; i < (sortedTools?.length ?? 0); i++) {
    const tool = sortedTools?.[i]
    if (!tool) continue
    if (!isFunctionTool(tool)) continue
    totalTokens += estimateToolTokens(tool)
    markerIndex = i
  }
  return { totalTokens, markerIndex }
}

function applyToolCacheMarker(
  sortedTools: LanguageModelV3CallOptions['tools'],
  markerIndex: number,
  toolPrefixTokens: number,
  tokenThreshold: number,
  budget: CacheBreakpointBudget
): LanguageModelV3CallOptions['tools'] {
  if (!sortedTools?.length || markerIndex === -1 || toolPrefixTokens < tokenThreshold || !budget.use())
    return sortedTools

  const markedTools = [...sortedTools]
  markedTools[markerIndex] = withCacheProviderOptions(markedTools[markerIndex] as LanguageModelV3FunctionTool)
  return markedTools
}

export async function transformAnthropicCacheParams(
  params: LanguageModelV3CallOptions,
  provider: Provider,
  assistant: Assistant | undefined
): Promise<LanguageModelV3CallOptions> {
  const settings = resolveAnthropicCacheSettings(provider)
  if (!settings.enabled) return params
  if (!Array.isArray(params.prompt) || params.prompt.length === 0) return params

  const messages = [...params.prompt]
  const budget = createCacheBreakpointBudget()
  const volatileSystemPrompt = hasVolatilePromptVariables(assistant)
  const sortedTools = sortToolsForCache(params.tools)
  const toolPrefix = estimateToolsPrefix(sortedTools)

  if (settings.cacheSystemMessage && !volatileSystemPrompt) {
    let systemPrefixTokens = toolPrefix.totalTokens
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      systemPrefixTokens += estimateContentTokens(msg.content)
      if (msg.role === 'system' && systemPrefixTokens >= settings.tokenThreshold && budget.use()) {
        messages[i] = withCacheProviderOptions(msg)
        break
      }
    }
  }

  const tools = applyToolCacheMarker(
    sortedTools,
    toolPrefix.markerIndex,
    toolPrefix.totalTokens,
    settings.tokenThreshold,
    budget
  )

  if (settings.cacheLastNMessages > 0 && !volatileSystemPrompt) {
    const cumsumTokens: number[] = []
    let tokenSum = toolPrefix.totalTokens
    for (let i = 0; i < messages.length; i++) {
      tokenSum += estimateContentTokens(messages[i].content)
      cumsumTokens.push(tokenSum)
    }

    let cachedCount = 0
    for (let i = messages.length - 1; i >= 0 && cachedCount < settings.cacheLastNMessages; i--) {
      const msg = messages[i]
      if (msg.role === 'system' || cumsumTokens[i] < settings.tokenThreshold || !hasCacheableContent(msg)) {
        continue
      }
      if (!budget.use()) break

      if (typeof msg.content === 'string') {
        messages[i] = withCacheProviderOptions(msg)
      } else {
        const newContent = [...msg.content]
        const lastIndex = newContent.length - 1
        newContent[lastIndex] = withCacheProviderOptions(newContent[lastIndex])
        messages[i] = { ...msg, content: newContent } as LanguageModelV3Message
      }
      cachedCount++
    }
  }

  return { ...params, prompt: messages, tools }
}

function anthropicCacheMiddleware(provider: Provider, assistant: Assistant | undefined): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => transformAnthropicCacheParams(params, provider, assistant)
  }
}

function createAnthropicCachePlugin(provider: Provider, assistant: Assistant | undefined) {
  return definePlugin({
    name: 'anthropic-cache',
    enforce: 'pre',
    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(anthropicCacheMiddleware(provider, assistant))
    }
  })
}

export const anthropicCacheFeature: RequestFeature = {
  name: 'anthropic-cache',
  applies: (scope) =>
    scope.endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES && resolveAnthropicCacheSettings(scope.provider).enabled,
  contributeModelAdapters: (scope) => [createAnthropicCachePlugin(scope.provider, scope.assistant)]
}
