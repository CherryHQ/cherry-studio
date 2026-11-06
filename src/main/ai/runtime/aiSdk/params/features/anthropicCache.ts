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
type RecordValue = Record<string, unknown>
interface EmittedCacheSlot {
  path: HolderPath
  kind: string
  identity: unknown
  candidates: HolderPath[]
  eligible: boolean
  emittedPath?: string
}
interface EmittedCachePlan {
  tools?: EmittedCacheSlot[]
  system?: EmittedCacheSlot[]
  messages: { role: string; content: EmittedCacheSlot[] }[]
  slots: EmittedCacheSlot[]
  dead: HolderPath[][]
  root: HolderPath[]
  endpoint?: EmittedCacheSlot
}

function record(value: unknown): RecordValue {
  return value && typeof value === 'object' ? (value as RecordValue) : {}
}

function atPath(value: unknown, path: HolderPath): unknown {
  return path.reduce<unknown>((node, key) => record(node)[key], value)
}

function markerAt(value: unknown, path: HolderPath): unknown {
  const options = record(record(atPath(value, path)).providerOptions)
  const anthropic = record(options.anthropic)
  return anthropic.cacheControl ?? anthropic.cache_control
}

/** Returns undefined for the excluded advanced adapter domain, not for requests without markers.
 * Toolsets, hosted MCP, advanced provider tools, system controls and JSON schemas are excluded. */
export function deriveEmittedCacheSlots(
  params: LanguageModelV3CallOptions,
  modelProvider = 'anthropic.messages'
): EmittedCachePlan | undefined {
  if (!Array.isArray(params.prompt)) return undefined
  const namespace = modelProvider.split('.')[0]
  const options = record(params.providerOptions)
  const effective = { ...record(options.anthropic), ...record(options[namespace]) }
  if (Array.isArray(effective.mcpServers) && effective.mcpServers.length) return undefined
  if (params.responseFormat?.type === 'json' && params.responseFormat.schema) return undefined
  const advancedIds = new Set([
    'anthropic.code_execution_20250522',
    'anthropic.code_execution_20250825',
    'anthropic.code_execution_20260120',
    'anthropic.computer_20250124',
    'anthropic.computer_20251124',
    'anthropic.computer_20241022',
    'anthropic.computer_toolset_20260801',
    'anthropic.text_editor_20250124',
    'anthropic.text_editor_20241022',
    'anthropic.text_editor_20250429',
    'anthropic.text_editor_20250728',
    'anthropic.bash_20250124',
    'anthropic.bash_20241022',
    'anthropic.tool_search_regex_20251119',
    'anthropic.tool_search_bm25_20251119',
    'anthropic.advisor_20260301'
  ])
  const nativeIds = new Set([
    'anthropic.web_fetch_20250910',
    'anthropic.web_fetch_20260209',
    'anthropic.web_search_20250305',
    'anthropic.web_search_20260209',
    'anthropic.memory_20250818'
  ])
  const advancedNames = new Set(['code_execution', 'tool_search_tool_regex', 'tool_search_tool_bm25', 'advisor'])
  for (const tool of params.tools ?? []) {
    if (tool.type === 'provider' && advancedIds.has(tool.id)) {
      advancedNames.add(tool.name)
      return undefined
    }
  }
  for (const message of params.prompt) {
    const meta = record(record(message.providerOptions).anthropic)
    if (message.role === 'system') {
      if (meta.toolChanges != null || meta.clearAt != null || meta.effort != null) return undefined
    } else {
      if (!Array.isArray(message.content)) return undefined
      for (const part of message.content) {
        const data = record(part)
        const partMeta = record(record(data.providerOptions).anthropic)
        if (message.role === 'assistant') {
          if (part.type === 'text' && partMeta.type === 'compaction') return undefined
          if (
            part.type === 'tool-call' &&
            (typeof partMeta.toolsetName === 'string' ||
              (data.providerExecuted && (partMeta.type === 'mcp-tool-use' || advancedNames.has(String(data.toolName)))))
          )
            return undefined
          if (
            part.type === 'tool-result' &&
            (typeof partMeta.toolsetName === 'string' || advancedNames.has(String(data.toolName)))
          )
            return undefined
          if (
            part.type === 'reasoning' &&
            effective.sendReasoning !== false &&
            ((partMeta.signature != null && typeof partMeta.signature !== 'string') ||
              (partMeta.redactedData != null && typeof partMeta.redactedData !== 'string'))
          )
            return undefined
        } else if (message.role === 'tool' && part.type === 'tool-result' && typeof partMeta.toolsetName === 'string')
          return undefined
      }
    }
  }
  const plan: EmittedCachePlan = { messages: [], slots: [], dead: [], root: [] }
  if (params.tools?.length) {
    plan.tools = params.tools.flatMap((tool, i) =>
      tool.type === 'function' || nativeIds.has(tool.id)
        ? [
            {
              path: ['tools', i],
              kind: tool.type === 'function' ? 'tool' : tool.id.slice('anthropic.'.length),
              identity: tool.type === 'function' ? tool.name : tool.id.slice('anthropic.'.length).replace(/_\d+$/, ''),
              candidates: tool.type === 'function' ? [['tools', i]] : [],
              eligible: true
            }
          ]
        : []
    )
  }
  const nativeTools = new Map([
    ['web_search', 'web_search'],
    ['web_fetch', 'web_fetch']
  ])
  for (const tool of params.tools ?? []) {
    if (tool.type === 'provider' && nativeIds.has(tool.id) && tool.id !== 'anthropic.memory_20250818')
      nativeTools.set(tool.name, tool.id.includes('web_search') ? 'web_search' : 'web_fetch')
  }
  const groups: { role: string; indexes: number[] }[] = []
  params.prompt.forEach((message, i) => {
    const role = message.role === 'tool' ? 'user' : message.role
    if (groups.at(-1)?.role !== role) groups.push({ role, indexes: [] })
    groups.at(-1)!.indexes.push(i)
  })
  let systemAssigned = false
  for (const [groupIndex, group] of groups.entries()) {
    let content: EmittedCacheSlot[] = []
    for (const i of group.indexes) {
      const message = params.prompt[i]
      const messagePath: HolderPath = ['prompt', i]
      if (message.role === 'system') {
        content.push({
          path: messagePath,
          kind: 'text',
          identity: message.content,
          candidates: [messagePath],
          eligible: !!message.content
        })
        continue
      }
      for (const [j, part] of message.content.entries()) {
        if (part.type === 'tool-approval-response') continue
        const data = record(part)
        const path: HolderPath = [...messagePath, 'content', j]
        const candidates: HolderPath[] = [path]
        if (message.role === 'tool' && part.type === 'tool-result') {
          const output = record(part.output)
          if ('providerOptions' in output) candidates.push([...path, 'output'])
          else if (output.type === 'content' && Array.isArray(output.value)) {
            const index = output.value.findIndex((item: unknown) => record(item).providerOptions != null)
            if (index >= 0) candidates.push([...path, 'output', 'value', index])
          }
        }
        if (j === message.content.length - 1) candidates.push(messagePath)
        let kind = part.type as string
        let dead = false
        if (message.role === 'user' && part.type === 'file')
          kind = part.mediaType.startsWith('image/') ? 'image' : 'document'
        if (message.role === 'tool' && part.type === 'tool-result') kind = 'tool_result'
        if (message.role === 'assistant') {
          if (part.type === 'reasoning') {
            const meta = record(record(part.providerOptions).anthropic)
            kind =
              effective.sendReasoning !== false && meta.signature != null
                ? 'thinking'
                : effective.sendReasoning !== false && meta.redactedData != null
                  ? 'redacted_thinking'
                  : 'dropped'
            dead = true
          } else if (part.type === 'file') dead = true
          else if (part.type === 'tool-call') {
            kind = data.providerExecuted
              ? nativeTools.has(String(data.toolName))
                ? 'server_tool_use'
                : 'dropped'
              : 'tool_use'
            dead = kind === 'dropped'
          } else if (part.type === 'tool-result') {
            kind =
              nativeTools.has(String(data.toolName)) &&
              ['json', 'error-json'].includes(String(record(data.output).type))
                ? `${nativeTools.get(String(data.toolName))}_tool_result`
                : 'dropped'
            dead = kind === 'dropped'
          }
        }
        if (dead) plan.dead.push(candidates)
        if (dead && kind !== 'thinking' && kind !== 'redacted_thinking') continue
        content.push({
          path,
          kind,
          identity:
            kind === 'image' || kind === 'document'
              ? data.data instanceof URL || (typeof data.data === 'string' && /^https?:\/\//.test(data.data))
                ? data.data.toString()
                : kind === 'document' && data.mediaType === 'text/plain'
                  ? (typeof data.data === 'string'
                      ? Buffer.from(data.data, 'base64')
                      : Buffer.from(data.data as Uint8Array)
                    ).toString('utf8')
                  : typeof data.data === 'string'
                    ? data.data
                    : Buffer.from(data.data as Uint8Array).toString('base64')
              : kind === 'redacted_thinking'
                ? record(record(data.providerOptions).anthropic).redactedData
                : kind === 'tool_use' || kind === 'server_tool_use'
                  ? [
                      kind === 'server_tool_use' ? nativeTools.get(String(data.toolName)) : data.toolName,
                      data.toolCallId
                    ]
                  : (data.toolCallId ??
                    (kind === 'text' &&
                    message.role === 'assistant' &&
                    groupIndex === groups.length - 1 &&
                    i === group.indexes.at(-1) &&
                    j === message.content.length - 1
                      ? String(data.text ?? '').trim()
                      : data.text)),
          candidates: dead ? [] : candidates,
          eligible:
            !dead &&
            (kind !== 'text' ||
              !!(message.role === 'assistant' &&
              groupIndex === groups.length - 1 &&
              i === group.indexes.at(-1) &&
              j === message.content.length - 1
                ? String(data.text ?? '').trim()
                : String(data.text ?? '')))
        })
      }
    }
    if (group.role === 'assistant') {
      const ordered: EmittedCacheSlot[] = []
      let segment: EmittedCacheSlot[] = []
      const flush = () => {
        ordered.push(
          ...segment.filter((slot) => slot.kind !== 'tool_use'),
          ...segment.filter((slot) => slot.kind === 'tool_use')
        )
        segment = []
      }
      for (const slot of content) {
        if (slot.kind === 'thinking' || slot.kind === 'redacted_thinking') {
          flush()
          ordered.push(slot)
        } else segment.push(slot)
      }
      flush()
      content = ordered
    }
    if (group.role === 'system' && (groupIndex === 0 || !systemAssigned)) {
      plan.system = content
      systemAssigned = true
    } else if (group.role === 'system') {
      for (const slot of content) plan.messages.push({ role: group.role, content: [slot] })
    } else plan.messages.push({ role: group.role, content })
  }
  plan.tools?.forEach((slot, i) => {
    slot.emittedPath = `tools.${i}`
  })
  plan.system?.forEach((slot, i) => {
    slot.emittedPath = `system.${i}`
  })
  plan.messages.forEach((message, i) =>
    message.content.forEach((slot, j) => {
      slot.emittedPath = `messages.${i}.content.${j}`
    })
  )
  plan.slots = [...(plan.tools ?? []), ...(plan.system ?? []), ...plan.messages.flatMap((message) => message.content)]
  plan.endpoint = plan.slots.findLast((slot) => slot.eligible)
  if (namespace !== 'anthropic' && 'cacheControl' in record(options[namespace]))
    plan.root.push(['providerOptions', namespace])
  if ('cacheControl' in record(options.anthropic)) plan.root.push(['providerOptions', 'anthropic'])
  return plan
}

function clampCacheMarkers(
  params: LanguageModelV3CallOptions,
  selected: Set<string>,
  modelProvider: string
): LanguageModelV3CallOptions {
  const plan = deriveEmittedCacheSlots(params, modelProvider)
  if (!plan) return params
  const deletions = new Map<string, { path: HolderPath; root: boolean }>()
  const keyOf = (path: HolderPath, root = false) => JSON.stringify([root, path])
  const remove = (path: HolderPath, root = false) => {
    const target = root
      ? record(atPath(params, path))
      : record(record(record(atPath(params, path)).providerOptions).anthropic)
    if (root ? !('cacheControl' in target) : !('cacheControl' in target || 'cache_control' in target)) return
    deletions.set(keyOf(path, root), { path: root ? path : [...path, 'providerOptions', 'anthropic'], root })
  }
  const currentMarker = (path: HolderPath) => (deletions.has(keyOf(path)) ? undefined : markerAt(params, path))
  for (const chain of plan.dead) for (const path of chain) remove(path)
  const effective = (slot: EmittedCacheSlot) => slot.candidates.find((path) => !!currentMarker(path))
  const rankOf = (marker: unknown) => (record(marker).ttl === '1h' ? 1 : 0)
  const selectedSlots = plan.slots.filter((slot) => {
    const path = effective(slot)
    return path && selected.has(path.join('.'))
  })
  let remaining = MAX_CACHE_BREAKPOINTS - selectedSlots.length
  let rank = 1
  let endpointRank: number | undefined
  for (const [index, slot] of plan.slots.entries()) {
    let path = effective(slot)
    while (path) {
      const valueRank = rankOf(currentMarker(path))
      const isSelected = selected.has(path.join('.'))
      const laterLong = plan.slots.slice(index + 1).some((next) => {
        const candidate = effective(next)
        return candidate && selected.has(candidate.join('.')) && rankOf(currentMarker(candidate)) === 1
      })
      if (isSelected || (remaining > 0 && valueRank <= rank && !(valueRank === 0 && laterLong))) {
        if (!isSelected) remaining--
        rank = valueRank
        if (slot === plan.endpoint) endpointRank = valueRank
        break
      }
      remove(path)
      path = effective(slot)
    }
  }
  for (const path of plan.root) {
    const value = record(atPath(params, path)).cacheControl
    if (!value) break
    const valueRank = rankOf(value)
    if (remaining > 0 && valueRank <= rank && (endpointRank === undefined || endpointRank === valueRank)) break
    remove(path, true)
  }
  if (!deletions.size) return params
  const copy = (node: unknown, entries: { path: HolderPath; root: boolean }[], depth: number): unknown => {
    const clone = Array.isArray(node) ? [...node] : { ...record(node) }
    for (const entry of entries.filter((item) => item.path.length === depth)) {
      delete (clone as RecordValue).cacheControl
      if (!entry.root) delete (clone as RecordValue).cache_control
    }
    const keys = new Set(entries.filter((item) => item.path.length > depth).map((item) => item.path[depth]))
    for (const key of keys) {
      ;(clone as Record<string | number, unknown>)[key] = copy(
        record(node)[key],
        entries.filter((item) => item.path[depth] === key),
        depth + 1
      )
    }
    return clone
  }
  return copy(params, [...deletions.values()], 0) as LanguageModelV3CallOptions
}

export async function transformAnthropicCacheParams(
  params: LanguageModelV3CallOptions,
  provider: Provider,
  assistant: Assistant | undefined,
  modelProvider = 'anthropic.messages'
): Promise<LanguageModelV3CallOptions> {
  const settings = resolveAnthropicCacheSettings(provider)
  if (!settings.enabled) return params
  if (!Array.isArray(params.prompt)) return params
  const selected = new Set<string>()
  if (params.prompt.length === 0) return clampCacheMarkers(params, selected, modelProvider)

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
    selected,
    modelProvider
  )
}

function anthropicCacheMiddleware(provider: Provider, assistant: Assistant | undefined): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params, model }) =>
      transformAnthropicCacheParams(params, provider, assistant, model.provider)
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
