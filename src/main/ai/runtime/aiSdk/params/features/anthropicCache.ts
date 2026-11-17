/**
 * Anthropic Prompt Caching Middleware
 *
 * Adds `providerOptions.anthropic.cacheControl` markers
 * on qualifying system / tool / trailing-message breakpoints so Anthropic-compatible
 * providers re-use stable prompt prefixes.
 *
 * @see https://ai-sdk.dev/providers/ai-sdk-providers/anthropic#cache-control
 */

import type { LanguageModelV3CallOptions, LanguageModelV3FunctionTool, LanguageModelV3Message } from '@ai-sdk/provider'
import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { LanguageModelMiddleware } from 'ai'
import { estimateTokenCount } from 'tokenx'

import { definePlugin } from '@cherrystudio/ai-core'
import { resolveAnthropicCacheSettings } from '@shared/ai/anthropicCache'
import type { Assistant } from '@shared/data/types/assistant'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { AnthropicCacheTtl, Provider } from '@shared/data/types/provider'

import { VOLATILE_PROMPT_VARIABLES } from '../../../../../utils/prompt'
import type { RequestFeature } from '../feature'

const MAX_CACHE_BREAKPOINTS = 4

function getCacheControl(ttl: AnthropicCacheTtl) {
  return ttl === '1h' ? ({ type: 'ephemeral', ttl } as const) : ({ type: 'ephemeral' } as const)
}

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

function withCacheProviderOptions<T extends { providerOptions?: unknown }>(
  value: T,
  cacheControl: ReturnType<typeof getCacheControl>
): T {
  return {
    ...value,
    providerOptions: {
      ...(value.providerOptions && typeof value.providerOptions === 'object' ? value.providerOptions : {}),
      anthropic: {
        ...((value as Holder).providerOptions as { anthropic?: object } | undefined)?.anthropic,
        cacheControl
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
  budget: CacheBreakpointBudget,
  cacheControl: ReturnType<typeof getCacheControl>
): LanguageModelV3CallOptions['tools'] {
  if (!sortedTools?.length || markerIndex === -1 || toolPrefixTokens < tokenThreshold || !budget.use())
    return sortedTools

  const markedTools = [...sortedTools]
  markedTools[markerIndex] = withCacheProviderOptions(
    markedTools[markerIndex] as LanguageModelV3FunctionTool,
    cacheControl
  )
  return markedTools
}

type Holder = { providerOptions?: unknown }
type HolderPath = (string | number)[]

function clampCacheMarkers(params: LanguageModelV3CallOptions, selected: Set<string>): LanguageModelV3CallOptions {
  const holders: { path: HolderPath; key: string; rank: number }[] = []
  const inspect = (value: unknown, path: HolderPath): boolean => {
    const anthropic = (
      (value as Holder).providerOptions as
        | { anthropic?: { cacheControl?: { ttl?: string }; cache_control?: { ttl?: string } } }
        | undefined
    )?.anthropic
    const marker = anthropic?.cacheControl ?? anthropic?.cache_control
    if (!marker) return false
    holders.push({ path, key: path.join('.'), rank: marker.ttl === '1h' ? 1 : 0 })
    return true
  }
  const toolIndexes = (params.tools ?? [])
    .map((_, i) => i)
    .sort((a, b) => {
      const left = params.tools![a]
      const right = params.tools![b]
      return compareCacheKeys(isFunctionTool(left) ? left.name : left.id, isFunctionTool(right) ? right.name : right.id)
    })
  for (const i of toolIndexes) inspect(params.tools![i], ['tools', i])
  params.prompt.forEach((message, i) => {
    const messagePath: HolderPath = ['prompt', i]
    if (message.role === 'system') {
      inspect(message, messagePath)
      return
    }
    const contentIndexes: number[] = []
    const toolCallIndexes: number[] = []
    const useEmittedOrder =
      message.role === 'assistant' &&
      message.content.every((part) => part.type === 'text' || (part.type === 'tool-call' && !part.providerExecuted))
    // The adapter moves tool_use blocks to the end of each thinking-delimited segment.
    message.content.forEach((part, j) => {
      if (useEmittedOrder && part.type === 'tool-call' && !part.providerExecuted) {
        toolCallIndexes.push(j)
        return
      }
      if (useEmittedOrder && part.type === 'reasoning') {
        contentIndexes.push(...toolCallIndexes)
        toolCallIndexes.length = 0
      }
      contentIndexes.push(j)
    })
    contentIndexes.push(...toolCallIndexes)
    contentIndexes.forEach((j) => {
      const part = message.content[j]
      if (part.type === 'tool-approval-response') return
      const path: HolderPath = [...messagePath, 'content', j]
      if (inspect(part, path)) return
      if (message.role === 'tool' && part.type === 'tool-result') {
        const outputPath = [...path, 'output']
        if ('providerOptions' in part.output) {
          if (inspect(part.output, outputPath)) return
        } else if (part.output.type === 'content') {
          const index = part.output.value.findIndex((item) => item.providerOptions != null)
          if (index !== -1 && inspect(part.output.value[index], [...outputPath, 'value', index])) return
        }
      }
      if (j === message.content.length - 1) inspect(message, messagePath)
    })
  })
  let remaining = MAX_CACHE_BREAKPOINTS - holders.filter(({ key }) => selected.has(key)).length
  let rank = 1
  const lastLongSelection = holders.findLastIndex((holder) => selected.has(holder.key) && holder.rank === 1)
  let result: unknown = params
  for (const [index, holder] of holders.entries()) {
    const { path, key } = holder
    const invalidOrder = !selected.has(key) && (holder.rank > rank || (holder.rank === 0 && index < lastLongSelection))
    if (selected.has(key) || (!invalidOrder && remaining > 0)) {
      if (!selected.has(key)) remaining--
      rank = holder.rank
      continue
    }
    const remove = (node: unknown, depth: number): unknown => {
      if (depth === path.length) {
        const holder = node as { providerOptions: { anthropic: Record<string, unknown> } }
        const anthropic = { ...holder.providerOptions.anthropic }
        delete anthropic.cacheControl
        delete anthropic.cache_control
        return { ...holder, providerOptions: { ...holder.providerOptions, anthropic } }
      }
      const copy = Array.isArray(node) ? [...node] : { ...(node as Record<string, unknown>) }
      const index = path[depth]
      ;(copy as Record<string | number, unknown>)[index] = remove(
        (node as Record<string | number, unknown>)[index],
        depth + 1
      )
      return copy
    }
    result = remove(result, 0)
  }
  // Removing a higher-precedence hint can expose a previously shadowed fallback.
  return result === params ? params : clampCacheMarkers(result as LanguageModelV3CallOptions, selected)
}

function hasExplicitCacheControl(value: { providerOptions?: ProviderOptions }): boolean {
  const options = value.providerOptions?.anthropic
  return options?.cacheControl != null || options?.cache_control != null
}

export async function transformAnthropicCacheParams(
  params: LanguageModelV3CallOptions,
  provider: Provider,
  assistant: Assistant | undefined,
  callerOwned = false
): Promise<LanguageModelV3CallOptions> {
  if (
    callerOwned &&
    (hasExplicitCacheControl(params) ||
      params.tools?.some((tool) => isFunctionTool(tool) && hasExplicitCacheControl(tool)) ||
      params.prompt.some(
        (message) =>
          hasExplicitCacheControl(message) ||
          (Array.isArray(message.content) && message.content.some(hasExplicitCacheControl))
      ))
  )
    return params
  const settings = resolveAnthropicCacheSettings(provider)
  if (!settings.enabled) return params
  if (!Array.isArray(params.prompt)) return params
  const selected = new Set<string>()
  if (params.prompt.length === 0) return clampCacheMarkers(params, selected)

  const messages = [...params.prompt]
  const budget = createCacheBreakpointBudget()
  const cacheControl = getCacheControl(settings.ttl)
  const volatileSystemPrompt = hasVolatilePromptVariables(assistant)
  const sortedTools = sortToolsForCache(params.tools)
  const toolPrefix = estimateToolsPrefix(sortedTools)

  if (settings.cacheSystemMessage && !volatileSystemPrompt) {
    let systemPrefixTokens = toolPrefix.totalTokens
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      systemPrefixTokens += estimateContentTokens(msg.content)
      if (msg.role === 'system' && systemPrefixTokens >= settings.tokenThreshold && budget.use()) {
        messages[i] = withCacheProviderOptions(msg, cacheControl)
        selected.add(`prompt.${i}`)
        break
      }
    }
  }

  const tools = applyToolCacheMarker(
    sortedTools,
    toolPrefix.markerIndex,
    toolPrefix.totalTokens,
    settings.tokenThreshold,
    budget,
    cacheControl
  )

  if (tools !== sortedTools) selected.add(`tools.${toolPrefix.markerIndex}`)

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
        messages[i] = withCacheProviderOptions(msg, cacheControl)
        selected.add(`prompt.${i}`)
      } else {
        const newContent = [...msg.content]
        const lastIndex = newContent.length - 1
        newContent[lastIndex] = withCacheProviderOptions(newContent[lastIndex], cacheControl)
        selected.add(`prompt.${i}.content.${lastIndex}`)
        messages[i] = { ...msg, content: newContent } as LanguageModelV3Message
      }
      cachedCount++
    }
  }

  const toolsReordered = tools?.some((tool, i) => tool !== params.tools?.[i])
  return clampCacheMarkers(
    selected.size === 0 && !toolsReordered ? params : { ...params, prompt: messages, tools },
    selected
  )
}

function anthropicCacheMiddleware(
  provider: Provider,
  assistant: Assistant | undefined,
  callerOwned: boolean
): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => transformAnthropicCacheParams(params, provider, assistant, callerOwned)
  }
}

function createAnthropicCachePlugin(provider: Provider, assistant: Assistant | undefined, callerOwned: boolean) {
  return definePlugin({
    name: 'anthropic-cache',
    enforce: 'pre',
    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(anthropicCacheMiddleware(provider, assistant, callerOwned))
    }
  })
}

export const anthropicCacheFeature: RequestFeature = {
  name: 'anthropic-cache',
  applies: (scope) =>
    scope.endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES && resolveAnthropicCacheSettings(scope.provider).enabled,
  contributeModelAdapters: (scope) => [
    createAnthropicCachePlugin(scope.provider, scope.assistant, scope.request.contextOwner === 'caller')
  ]
}
