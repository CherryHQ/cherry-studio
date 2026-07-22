/**
 * Perplexity Agent API language model (`POST /v1/agent`).
 *
 * A bespoke `LanguageModelV3` for Perplexity's OpenAI-Responses-shaped research
 * endpoint. Maps: `output_text` → text, `url_citation` annotations + web/finance/
 * people search + fetch-url results → AI SDK `source` parts, and `reasoning.*`
 * events → reasoning parts. Built-in tools are exposed as AI SDK
 * provider-defined tools and their results are preserved across client steps.
 *
 * Scope: text + citations/search + reasoning + provider/client-executed tools.
 * Sandbox and native MCP output items are accepted from the wire but not surfaced.
 */
import {
  APICallError,
  type JSONObject,
  type LanguageModelV3,
  type LanguageModelV3CallOptions,
  type LanguageModelV3Content,
  type LanguageModelV3FinishReason,
  type LanguageModelV3StreamPart,
  type LanguageModelV3Usage,
  type SharedV3Warning
} from '@ai-sdk/provider'
import {
  combineHeaders,
  createEventSourceResponseHandler,
  createJsonErrorResponseHandler,
  createJsonResponseHandler,
  type FetchFunction,
  generateId,
  parseProviderOptions,
  postJsonToApi
} from '@ai-sdk/provider-utils'

import { convertToPerplexityAgentInput } from './convertToPerplexityAgentInput'
import type { perplexityAgentUsageSchema } from './perplexityAgentSchemas'
import {
  isPerplexityKnownAgentEvent,
  perplexityAgentErrorSchema,
  perplexityAgentErrorToMessage,
  type PerplexityAgentEvent,
  perplexityAgentEventSchema,
  perplexityAgentProviderOptionsSchema,
  perplexityAgentResponseSchema,
  perplexityFetchUrlConfigSchema,
  type PerplexityFunctionCallItem,
  perplexityFunctionCallItemSchema,
  perplexityFunctionToolSchema,
  type PerplexityOutputItem,
  type PerplexityResultEntry,
  perplexityWebSearchConfigSchema
} from './perplexityAgentSchemas'

/** Single namespace shared with the Sonar chat model — one user-facing "perplexity" provider. */
const PERPLEXITY_PROVIDER = 'perplexity' as const

/** Perplexity requires this field for Anthropic models; all currently exposed models support 128K. */
const ANTHROPIC_MAX_OUTPUT_TOKENS = 128_000

export interface PerplexityAgentConfig {
  baseURL: string
  headers: () => Record<string, string | undefined>
  fetch?: FetchFunction
}

type AgentUsage = ReturnType<typeof perplexityAgentUsageSchema.parse>
type Source = { url: string; title?: string }
type ServerToolResultType = 'search_results' | 'people_search_results' | 'fetch_url_results'
type ToolMetadata = {
  itemId?: string | null
  thoughtSignature?: string | null
  serverToolType?: ServerToolResultType
}
type ServerToolDescriptor = { name: string; dynamic: boolean }
type ServerToolNames = { webSearch: ServerToolDescriptor; fetchUrl: ServerToolDescriptor }

// ── helpers ──

const EMPTY_USAGE: LanguageModelV3Usage = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
  raw: undefined
}

function convertAgentUsage(usage: AgentUsage | null | undefined): LanguageModelV3Usage {
  if (usage == null) return EMPTY_USAGE
  const cacheRead = usage.input_tokens_details?.cache_read_input_tokens ?? undefined
  const cacheWrite = usage.input_tokens_details?.cache_creation_input_tokens ?? undefined
  const inputTotal = usage.input_tokens ?? undefined
  return {
    inputTokens: {
      total: inputTotal,
      noCache: inputTotal != null && cacheRead != null ? inputTotal - cacheRead : inputTotal,
      cacheRead,
      cacheWrite
    },
    outputTokens: {
      total: usage.output_tokens ?? undefined,
      text: usage.output_tokens ?? undefined,
      reasoning: undefined
    },
    raw: usage as unknown as JSONObject
  }
}

function mapFinishReason(
  incompleteReason: string | null | undefined,
  hasFunctionCall: boolean
): LanguageModelV3FinishReason {
  let unified: LanguageModelV3FinishReason['unified']
  switch (incompleteReason) {
    case undefined:
    case null:
      unified = hasFunctionCall ? 'tool-calls' : 'stop'
      break
    case 'max_output_tokens':
      unified = 'length'
      break
    case 'content_filter':
      unified = 'content-filter'
      break
    default:
      unified = hasFunctionCall ? 'tool-calls' : 'other'
  }
  return { unified, raw: incompleteReason ?? undefined }
}

function resultEntriesToSources(entries: PerplexityResultEntry[] | null | undefined): Source[] {
  return (entries ?? []).flatMap((entry) => (entry.url ? [{ url: entry.url, title: entry.title ?? undefined }] : []))
}

/** Pull citation/search sources out of any output item (unknown types yield none). */
function extractSources(item: PerplexityOutputItem): Source[] {
  const out: Source[] = []
  const pushEntries = (entries?: PerplexityResultEntry[] | null) => {
    out.push(...resultEntriesToSources(entries))
  }
  switch (item.type) {
    case 'search_results':
    case 'people_search_results':
      pushEntries((item as { results?: PerplexityResultEntry[] | null }).results)
      break
    case 'fetch_url_results':
      pushEntries((item as { contents?: PerplexityResultEntry[] | null }).contents)
      break
    case 'message': {
      const content = (
        item as {
          content?: Array<{
            type: string
            annotations?: Array<{ type: string; url?: string; title?: string | null }> | null
          }> | null
        }
      ).content
      for (const part of content ?? []) {
        if (part.type === 'output_text') {
          for (const annotation of part.annotations ?? []) {
            if ((annotation.type === 'url_citation' || annotation.type === 'citation') && annotation.url) {
              out.push({ url: annotation.url, title: annotation.title ?? undefined })
            }
          }
        }
      }
      break
    }
  }
  return out
}

function messageText(item: PerplexityOutputItem): string {
  if (item.type !== 'message') return ''
  const content = (item as { content?: Array<{ type: string; text?: string }> | null }).content
  return (content ?? [])
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text ?? '')
    .join('')
}

function asFunctionCall(item: PerplexityOutputItem): PerplexityFunctionCallItem | undefined {
  if (item.type !== 'function_call') return undefined
  const parsed = perplexityFunctionCallItemSchema.safeParse(item)
  return parsed.success ? parsed.data : undefined
}

function buildToolProviderMetadata(item: PerplexityFunctionCallItem) {
  return {
    [PERPLEXITY_PROVIDER]: {
      itemId: item.id ?? null,
      thoughtSignature: item.thought_signature ?? null
    } satisfies ToolMetadata
  }
}

function buildServerToolProviderMetadata(serverToolType: ServerToolResultType) {
  return { [PERPLEXITY_PROVIDER]: { serverToolType } satisfies ToolMetadata }
}

function getServerToolNames(tools: LanguageModelV3CallOptions['tools']): ServerToolNames {
  const names: ServerToolNames = {
    webSearch: { name: 'webSearch', dynamic: true },
    fetchUrl: { name: 'urlContext', dynamic: true }
  }
  for (const tool of tools ?? []) {
    if (tool.type !== 'provider') continue
    if (tool.id === 'perplexity.web_search') names.webSearch = { name: tool.name, dynamic: false }
    if (tool.id === 'perplexity.fetch_url') names.fetchUrl = { name: tool.name, dynamic: false }
  }
  return names
}

function toJsonObject(value: object): JSONObject {
  return JSON.parse(JSON.stringify(value)) as JSONObject
}

function getServerToolResult(
  item: PerplexityOutputItem,
  toolNames: ServerToolNames
): { serverToolType: ServerToolResultType; toolName: string; dynamic: boolean; result: JSONObject } | undefined {
  switch (item.type) {
    case 'search_results':
    case 'people_search_results': {
      return {
        serverToolType: item.type,
        toolName: toolNames.webSearch.name,
        dynamic: toolNames.webSearch.dynamic,
        result: toJsonObject(item)
      }
    }
    case 'fetch_url_results': {
      return {
        serverToolType: item.type,
        toolName: toolNames.fetchUrl.name,
        dynamic: toolNames.fetchUrl.dynamic,
        result: toJsonObject(item)
      }
    }
    default:
      return undefined
  }
}

function getServerToolCallId(
  responseId: string | null | undefined,
  item: PerplexityOutputItem,
  outputIndex: number
): string {
  const itemId = (item as { id?: string | null }).id
  return itemId ?? `${responseId ?? 'response'}:${item.type}:${outputIndex}`
}

// ── model ──

export class PerplexityAgentLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = 'v3'
  readonly provider = PERPLEXITY_PROVIDER
  readonly supportedUrls = { 'image/*': [/^https?:\/\/.*$/], 'application/pdf': [/^https?:\/\/.*$/] }

  constructor(
    readonly modelId: string,
    private readonly config: PerplexityAgentConfig
  ) {}

  private buildTools(
    callTools: LanguageModelV3CallOptions['tools'],
    toolChoice: LanguageModelV3CallOptions['toolChoice'],
    warnings: SharedV3Warning[]
  ): Array<Record<string, unknown>> | undefined {
    const tools: Array<{ name: string; value: Record<string, unknown> }> = []

    for (const tool of callTools ?? []) {
      if (tool.type === 'function') {
        tools.push({
          name: tool.name,
          value: perplexityFunctionToolSchema.parse({
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
            strict: tool.strict
          })
        })
        continue
      }

      if (tool.id === 'perplexity.web_search') {
        const cfg = perplexityWebSearchConfigSchema.parse(tool.args)
        const webSearch: Record<string, unknown> = { type: 'web_search' }
        if (cfg.maxResults != null) webSearch.max_results = cfg.maxResults
        if (cfg.maxTokens != null) webSearch.max_tokens = cfg.maxTokens
        if (cfg.maxTokensPerPage != null) webSearch.max_tokens_per_page = cfg.maxTokensPerPage
        if (cfg.searchContextSize) webSearch.search_context_size = cfg.searchContextSize
        const filters: Record<string, unknown> = {}
        if (cfg.searchDomainFilter) filters.search_domain_filter = cfg.searchDomainFilter
        if (cfg.searchRecencyFilter) filters.search_recency_filter = cfg.searchRecencyFilter
        if (cfg.searchAfterDateFilter) filters.search_after_date_filter = cfg.searchAfterDateFilter
        if (cfg.searchBeforeDateFilter) filters.search_before_date_filter = cfg.searchBeforeDateFilter
        if (cfg.lastUpdatedAfterFilter) filters.last_updated_after_filter = cfg.lastUpdatedAfterFilter
        if (cfg.lastUpdatedBeforeFilter) filters.last_updated_before_filter = cfg.lastUpdatedBeforeFilter
        if (Object.keys(filters).length > 0) webSearch.filters = filters
        if (cfg.userLocation) webSearch.user_location = cfg.userLocation
        tools.push({ name: tool.name, value: webSearch })
        continue
      }

      if (tool.id === 'perplexity.fetch_url') {
        const cfg = perplexityFetchUrlConfigSchema.parse(tool.args)
        tools.push({
          name: tool.name,
          value: { type: 'fetch_url', ...(cfg.maxUrls != null ? { max_urls: cfg.maxUrls } : {}) }
        })
        continue
      }

      warnings.push({ type: 'unsupported', feature: `provider-defined tool ${tool.id}` })
    }

    if (toolChoice?.type === 'none') return undefined
    if (toolChoice?.type === 'required') {
      warnings.push({ type: 'unsupported', feature: 'required tool choice' })
    } else if (toolChoice?.type === 'tool') {
      warnings.push({ type: 'unsupported', feature: 'forced tool choice' })
      const selected = tools.find((tool) => tool.name === toolChoice.toolName)
      return selected ? [selected.value] : undefined
    }

    return tools.length > 0 ? tools.map((tool) => tool.value) : undefined
  }

  private async getArgs(options: LanguageModelV3CallOptions) {
    const {
      prompt,
      maxOutputTokens,
      temperature,
      topP,
      topK,
      frequencyPenalty,
      presencePenalty,
      stopSequences,
      seed,
      responseFormat,
      tools,
      toolChoice
    } = options
    const warnings: SharedV3Warning[] = []
    if (topK != null) warnings.push({ type: 'unsupported', feature: 'topK' })
    if (frequencyPenalty != null) warnings.push({ type: 'unsupported', feature: 'frequencyPenalty' })
    if (presencePenalty != null) warnings.push({ type: 'unsupported', feature: 'presencePenalty' })
    if (stopSequences != null) warnings.push({ type: 'unsupported', feature: 'stopSequences' })
    if (seed != null) warnings.push({ type: 'unsupported', feature: 'seed' })
    // The Agent API's json_schema response_format requires a schema; JSON mode
    // without one can't be enforced, so we skip it rather than send an invalid body.
    if (responseFormat?.type === 'json' && !responseFormat.schema) {
      warnings.push({ type: 'unsupported', feature: 'JSON response format without a schema' })
    }

    const opts =
      (await parseProviderOptions({
        provider: PERPLEXITY_PROVIDER,
        providerOptions: options.providerOptions,
        schema: perplexityAgentProviderOptionsSchema
      })) ?? {}

    const {
      input,
      instructions,
      warnings: inputWarnings
    } = convertToPerplexityAgentInput(prompt, {
      previousResponseId: opts.previousResponseId,
      store: opts.store
    })
    warnings.push(...inputWarnings)

    const resolvedMaxOutputTokens =
      maxOutputTokens ?? (this.modelId.startsWith('anthropic/') ? ANTHROPIC_MAX_OUTPUT_TOKENS : undefined)

    const args: Record<string, unknown> = {
      model: this.modelId,
      input,
      instructions,
      max_output_tokens: resolvedMaxOutputTokens,
      max_steps: opts.maxSteps,
      temperature,
      top_p: topP,
      reasoning: opts.reasoningEffort && opts.reasoningEffort !== 'none' ? { effort: opts.reasoningEffort } : undefined,
      response_format:
        responseFormat?.type === 'json' && responseFormat.schema
          ? {
              type: 'json_schema',
              json_schema: { name: responseFormat.name ?? 'response', schema: responseFormat.schema, strict: true }
            }
          : undefined,
      tools: this.buildTools(tools, toolChoice, warnings),
      preset: opts.preset,
      models: opts.models,
      previous_response_id: opts.previousResponseId,
      language_preference: opts.languagePreference,
      store: opts.store
    }

    return { args, warnings }
  }

  async doGenerate(options: LanguageModelV3CallOptions) {
    const { args, warnings } = await this.getArgs(options)
    const {
      responseHeaders,
      value: response,
      rawValue: rawResponse
    } = await postJsonToApi({
      url: `${this.config.baseURL}/v1/agent`,
      headers: combineHeaders(this.config.headers(), options.headers),
      body: args,
      failedResponseHandler: createJsonErrorResponseHandler({
        errorSchema: perplexityAgentErrorSchema,
        errorToMessage: perplexityAgentErrorToMessage
      }),
      successfulResponseHandler: createJsonResponseHandler(perplexityAgentResponseSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch
    })

    // A 200 body can still report `status: failed` — surface it as an AI SDK error
    // (not empty content) so the app serializes a real message.
    if (response.status === 'failed') {
      throw new APICallError({
        message: response.error?.message ?? 'Perplexity Agent request failed',
        url: `${this.config.baseURL}/v1/agent`,
        requestBodyValues: args,
        responseBody: JSON.stringify(rawResponse ?? {}),
        isRetryable: false,
        data: response.error
      })
    }

    const content: LanguageModelV3Content[] = []
    const seenUrls = new Set<string>()
    const serverToolNames = getServerToolNames(options.tools)
    let text = ''
    let hasFunctionCall = false
    for (const [outputIndex, item] of (response.output ?? []).entries()) {
      const functionCall = asFunctionCall(item)
      if (functionCall) {
        hasFunctionCall = true
        content.push({
          type: 'tool-call',
          toolCallId: functionCall.call_id,
          toolName: functionCall.name,
          input: functionCall.arguments,
          providerMetadata: buildToolProviderMetadata(functionCall)
        })
        continue
      }
      const serverToolResult = getServerToolResult(item, serverToolNames)
      if (serverToolResult) {
        const toolCallId = getServerToolCallId(response.id, item, outputIndex)
        const providerMetadata = buildServerToolProviderMetadata(serverToolResult.serverToolType)
        content.push({
          type: 'tool-call',
          toolCallId,
          toolName: serverToolResult.toolName,
          input: '{}',
          providerExecuted: true,
          ...(serverToolResult.dynamic ? { dynamic: true } : {}),
          providerMetadata
        })
        content.push({
          type: 'tool-result',
          toolCallId,
          toolName: serverToolResult.toolName,
          result: serverToolResult.result,
          ...(serverToolResult.dynamic ? { dynamic: true } : {}),
          providerMetadata
        })
      }
      text += messageText(item)
      for (const source of extractSources(item)) {
        if (seenUrls.has(source.url)) continue
        seenUrls.add(source.url)
        content.push({ type: 'source', sourceType: 'url', id: generateId(), url: source.url, title: source.title })
      }
    }
    if (text.length > 0) content.unshift({ type: 'text', text })
    const finishReason = mapFinishReason(response.incomplete_details?.reason, hasFunctionCall)

    return {
      content,
      finishReason,
      usage: convertAgentUsage(response.usage),
      request: { body: args },
      response: {
        id: response.id ?? undefined,
        modelId: response.model ?? undefined,
        timestamp: response.created_at ? new Date(response.created_at * 1000) : undefined,
        headers: responseHeaders,
        body: rawResponse
      },
      warnings,
      providerMetadata: buildProviderMetadata(response.id, response.usage)
    }
  }

  async doStream(options: LanguageModelV3CallOptions) {
    const { args, warnings } = await this.getArgs(options)
    const body = { ...args, stream: true }
    const agentUrl = `${this.config.baseURL}/v1/agent`
    const { responseHeaders, value: response } = await postJsonToApi({
      url: agentUrl,
      headers: combineHeaders(this.config.headers(), options.headers),
      body,
      failedResponseHandler: createJsonErrorResponseHandler({
        errorSchema: perplexityAgentErrorSchema,
        errorToMessage: perplexityAgentErrorToMessage
      }),
      successfulResponseHandler: createEventSourceResponseHandler(perplexityAgentEventSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch
    })

    type EventResult =
      | { success: true; value: PerplexityAgentEvent; rawValue: unknown }
      | { success: false; error: unknown; rawValue: unknown }

    const REASONING_ID = 'reasoning'
    let finishReason: LanguageModelV3FinishReason = { unified: 'other', raw: undefined }
    let usage: AgentUsage | undefined
    let responseId: string | undefined
    const serverToolNames = getServerToolNames(options.tools)
    const seenUrls = new Set<string>()
    const openTextIds = new Set<string>()
    const pendingToolCalls = new Map<string, PerplexityFunctionCallItem>()
    const emittedToolCallIds = new Set<string>()
    const emittedServerToolCallIds = new Set<string>()
    let reasoningOpen = false

    return {
      stream: response.pipeThrough(
        new TransformStream<EventResult, LanguageModelV3StreamPart>({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings })
          },
          transform(chunk, controller) {
            if (options.includeRawChunks) controller.enqueue({ type: 'raw', rawValue: chunk.rawValue })
            if (!chunk.success) {
              controller.enqueue({ type: 'error', error: chunk.error })
              return
            }

            const emitSources = (sources: Source[]) => {
              for (const source of sources) {
                if (seenUrls.has(source.url)) continue
                seenUrls.add(source.url)
                controller.enqueue({
                  type: 'source',
                  sourceType: 'url',
                  id: generateId(),
                  url: source.url,
                  title: source.title
                })
              }
            }
            const emitThought = (thought: string | null | undefined) => {
              if (!thought) return
              if (!reasoningOpen) {
                controller.enqueue({ type: 'reasoning-start', id: REASONING_ID })
                reasoningOpen = true
              }
              controller.enqueue({ type: 'reasoning-delta', id: REASONING_ID, delta: `${thought}\n` })
            }
            const startFunctionCall = (item: PerplexityFunctionCallItem) => {
              if (pendingToolCalls.has(item.call_id) || emittedToolCallIds.has(item.call_id)) return
              pendingToolCalls.set(item.call_id, item)
              controller.enqueue({ type: 'tool-input-start', id: item.call_id, toolName: item.name })
            }
            const emitFunctionCall = (item: PerplexityFunctionCallItem) => {
              if (emittedToolCallIds.has(item.call_id)) return
              startFunctionCall(item)
              if (item.arguments) {
                controller.enqueue({ type: 'tool-input-delta', id: item.call_id, delta: item.arguments })
              }
              controller.enqueue({ type: 'tool-input-end', id: item.call_id })
              controller.enqueue({
                type: 'tool-call',
                toolCallId: item.call_id,
                toolName: item.name,
                input: item.arguments,
                providerMetadata: buildToolProviderMetadata(item)
              })
              pendingToolCalls.delete(item.call_id)
              emittedToolCallIds.add(item.call_id)
              finishReason = { unified: 'tool-calls', raw: 'function_call' }
            }
            const emitServerToolResult = (item: PerplexityOutputItem, outputIndex: number) => {
              const serverToolResult = getServerToolResult(item, serverToolNames)
              if (!serverToolResult) return
              const toolCallId = getServerToolCallId(responseId, item, outputIndex)
              if (emittedServerToolCallIds.has(toolCallId)) return
              const providerMetadata = buildServerToolProviderMetadata(serverToolResult.serverToolType)
              controller.enqueue({
                type: 'tool-input-start',
                id: toolCallId,
                toolName: serverToolResult.toolName,
                providerExecuted: true,
                ...(serverToolResult.dynamic ? { dynamic: true } : {}),
                providerMetadata
              })
              controller.enqueue({ type: 'tool-input-end', id: toolCallId, providerMetadata })
              controller.enqueue({
                type: 'tool-call',
                toolCallId,
                toolName: serverToolResult.toolName,
                input: '{}',
                providerExecuted: true,
                ...(serverToolResult.dynamic ? { dynamic: true } : {}),
                providerMetadata
              })
              controller.enqueue({
                type: 'tool-result',
                toolCallId,
                toolName: serverToolResult.toolName,
                result: serverToolResult.result,
                ...(serverToolResult.dynamic ? { dynamic: true } : {}),
                providerMetadata
              })
              emittedServerToolCallIds.add(toolCallId)
            }

            const event = chunk.value
            if (!isPerplexityKnownAgentEvent(event)) return

            switch (event.type) {
              case 'response.created':
              case 'response.in_progress': {
                const envelope = event.response
                if (envelope?.id) responseId = envelope.id
                if (event.type === 'response.created') {
                  controller.enqueue({
                    type: 'response-metadata',
                    id: envelope?.id ?? undefined,
                    modelId: envelope?.model ?? undefined
                  })
                }
                break
              }
              case 'response.output_text.delta': {
                const id = event.item_id ?? '0'
                if (!openTextIds.has(id)) {
                  controller.enqueue({ type: 'text-start', id })
                  openTextIds.add(id)
                }
                controller.enqueue({ type: 'text-delta', id, delta: event.delta })
                break
              }
              case 'response.output_text.done': {
                const id = event.item_id ?? '0'
                if (openTextIds.has(id)) {
                  controller.enqueue({ type: 'text-end', id })
                  openTextIds.delete(id)
                }
                break
              }
              case 'response.output_item.added':
              case 'response.output_item.done': {
                const item = event.item
                if (!item) break
                const functionCall = asFunctionCall(item)
                if (functionCall) {
                  if (event.type === 'response.output_item.added') startFunctionCall(functionCall)
                  else emitFunctionCall(functionCall)
                } else {
                  if (event.type === 'response.output_item.done') {
                    emitServerToolResult(item, event.output_index ?? 0)
                  }
                  emitSources(extractSources(item))
                }
                break
              }
              case 'response.reasoning.started':
                emitThought(event.thought)
                break
              case 'response.reasoning.search_queries':
              case 'response.reasoning.fetch_url_queries':
                emitThought(event.thought)
                break
              case 'response.reasoning.search_results': {
                emitThought(event.thought)
                emitSources(resultEntriesToSources(event.results))
                break
              }
              case 'response.reasoning.fetch_url_results': {
                emitThought(event.thought)
                emitSources(resultEntriesToSources(event.contents))
                break
              }
              case 'response.reasoning.stopped':
                emitThought(event.thought)
                if (reasoningOpen) {
                  controller.enqueue({ type: 'reasoning-end', id: REASONING_ID })
                  reasoningOpen = false
                }
                break
              case 'response.completed':
              case 'response.incomplete': {
                const envelope = event.response
                if (envelope?.id) responseId = envelope.id
                usage = envelope?.usage ?? usage
                for (const [outputIndex, item] of (envelope?.output ?? []).entries()) {
                  const functionCall = asFunctionCall(item)
                  if (functionCall) emitFunctionCall(functionCall)
                  else {
                    emitServerToolResult(item, outputIndex)
                    emitSources(extractSources(item))
                  }
                }
                finishReason = mapFinishReason(envelope?.incomplete_details?.reason, emittedToolCallIds.size > 0)
                break
              }
              case 'response.failed': {
                const errData = event.error
                // Wrap in an AI SDK error so the app's serializeError extracts a real
                // message instead of stringifying a plain object to "[object Object]".
                controller.enqueue({
                  type: 'error',
                  error: new APICallError({
                    message: errData?.message ?? 'Perplexity Agent request failed',
                    url: agentUrl,
                    requestBodyValues: body,
                    responseBody: JSON.stringify(errData ?? {}),
                    isRetryable: false,
                    data: errData
                  })
                })
                finishReason = { unified: 'error', raw: 'failed' }
                break
              }
              default:
                break
            }
          },
          flush(controller) {
            for (const id of openTextIds) controller.enqueue({ type: 'text-end', id })
            for (const item of pendingToolCalls.values()) {
              if (item.arguments)
                controller.enqueue({ type: 'tool-input-delta', id: item.call_id, delta: item.arguments })
              controller.enqueue({ type: 'tool-input-end', id: item.call_id })
              controller.enqueue({
                type: 'tool-call',
                toolCallId: item.call_id,
                toolName: item.name,
                input: item.arguments,
                providerMetadata: buildToolProviderMetadata(item)
              })
              emittedToolCallIds.add(item.call_id)
            }
            if (emittedToolCallIds.size > 0) finishReason = { unified: 'tool-calls', raw: 'function_call' }
            if (reasoningOpen) controller.enqueue({ type: 'reasoning-end', id: REASONING_ID })
            controller.enqueue({
              type: 'finish',
              finishReason,
              usage: convertAgentUsage(usage),
              providerMetadata: buildProviderMetadata(responseId, usage)
            })
          }
        })
      ),
      request: { body },
      response: { headers: responseHeaders }
    }
  }
}

function buildProviderMetadata(responseId: string | null | undefined, usage: AgentUsage | null | undefined) {
  return {
    [PERPLEXITY_PROVIDER]: {
      responseId: responseId ?? null,
      totalCost: usage?.cost?.total_cost ?? null
    }
  }
}
