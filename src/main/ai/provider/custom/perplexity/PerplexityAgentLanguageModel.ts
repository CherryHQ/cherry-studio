/**
 * Perplexity Agent API language model (`POST /v1/agent`).
 *
 * A bespoke `LanguageModelV3` for Perplexity's OpenAI-Responses-shaped research
 * endpoint. Maps: `output_text` → text, `url_citation` annotations + web/finance/
 * people search + fetch-url results → AI SDK `source` parts, and `reasoning.*`
 * events → reasoning parts. Built-in web search is on unless disabled via
 * `providerOptions.perplexity.webSearch = false`.
 *
 * Scope: text + citations/search + reasoning. Function-calling / sandbox / MCP
 * items are accepted from the wire but not surfaced.
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
  perplexityAgentErrorSchema,
  perplexityAgentErrorToMessage,
  type PerplexityAgentEvent,
  perplexityAgentEventSchema,
  type PerplexityAgentProviderOptions,
  perplexityAgentProviderOptionsSchema,
  perplexityAgentResponseSchema,
  type PerplexityOutputItem,
  type PerplexityResultEntry
} from './perplexityAgentSchemas'

/** Single namespace shared with the Sonar chat model — one user-facing "perplexity" provider. */
const PERPLEXITY_PROVIDER = 'perplexity' as const

/** Default max output tokens for `anthropic/*` models, which require the field. */
const ANTHROPIC_DEFAULT_MAX_OUTPUT_TOKENS = 8192

export interface PerplexityAgentConfig {
  baseURL: string
  headers: () => Record<string, string | undefined>
  fetch?: FetchFunction
}

type AgentUsage = ReturnType<typeof perplexityAgentUsageSchema.parse>
type Source = { url: string; title?: string }

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

function mapStatusToFinishReason(status: string | null | undefined): LanguageModelV3FinishReason {
  switch (status) {
    case 'completed':
      return { unified: 'stop', raw: status }
    case 'incomplete':
      return { unified: 'length', raw: status }
    case 'failed':
      return { unified: 'error', raw: status }
    default:
      return { unified: 'other', raw: status ?? undefined }
  }
}

/** Pull citation/search sources out of any output item (unknown types yield none). */
function extractSources(item: PerplexityOutputItem): Source[] {
  const out: Source[] = []
  const pushEntries = (entries?: PerplexityResultEntry[] | null) => {
    for (const entry of entries ?? []) if (entry?.url) out.push({ url: entry.url, title: entry.title ?? undefined })
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
            if (annotation.type === 'url_citation' && annotation.url) {
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

// ── model ──

export class PerplexityAgentLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = 'v3'
  readonly provider = PERPLEXITY_PROVIDER
  readonly supportedUrls = { 'image/*': [/^https?:\/\/.*$/], 'application/pdf': [/^https?:\/\/.*$/] }

  constructor(
    readonly modelId: string,
    private readonly config: PerplexityAgentConfig
  ) {}

  private buildTools(opts: PerplexityAgentProviderOptions): Array<Record<string, unknown>> | undefined {
    const tools: Array<Record<string, unknown>> = []

    // web_search: on unless explicitly disabled (`webSearch: false`).
    if (opts.webSearch !== false) {
      const cfg = typeof opts.webSearch === 'object' ? opts.webSearch : undefined
      const webSearch: Record<string, unknown> = { type: 'web_search' }
      if (cfg?.maxResults != null) webSearch.max_results = cfg.maxResults
      if (cfg?.maxTokens != null) webSearch.max_tokens = cfg.maxTokens
      if (cfg?.maxTokensPerPage != null) webSearch.max_tokens_per_page = cfg.maxTokensPerPage
      if (cfg?.searchContextSize) webSearch.search_context_size = cfg.searchContextSize
      const filters: Record<string, unknown> = {}
      if (cfg?.searchDomainFilter) filters.search_domain_filter = cfg.searchDomainFilter
      if (cfg?.searchRecencyFilter) filters.search_recency_filter = cfg.searchRecencyFilter
      if (cfg?.searchAfterDateFilter) filters.search_after_date_filter = cfg.searchAfterDateFilter
      if (cfg?.searchBeforeDateFilter) filters.search_before_date_filter = cfg.searchBeforeDateFilter
      if (cfg?.lastUpdatedAfterFilter) filters.last_updated_after_filter = cfg.lastUpdatedAfterFilter
      if (cfg?.lastUpdatedBeforeFilter) filters.last_updated_before_filter = cfg.lastUpdatedBeforeFilter
      if (Object.keys(filters).length > 0) webSearch.filters = filters
      if (cfg?.userLocation) webSearch.user_location = cfg.userLocation
      tools.push(webSearch)
    }

    // fetch_url: opt-in.
    if (opts.fetchUrl) {
      const cfg = typeof opts.fetchUrl === 'object' ? opts.fetchUrl : undefined
      const fetchUrl: Record<string, unknown> = { type: 'fetch_url' }
      if (cfg?.maxUrls != null) fetchUrl.max_urls = cfg.maxUrls
      tools.push(fetchUrl)
    }

    return tools.length > 0 ? tools : undefined
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
      responseFormat
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

    const { input, instructions, warnings: inputWarnings } = convertToPerplexityAgentInput(prompt)
    warnings.push(...inputWarnings)

    const isAnthropic = this.modelId.startsWith('anthropic/')
    // ponytail: anthropic/* requires max_output_tokens; default when unset so the
    // request doesn't 400. Bump via maxOutputTokens or the model config if it truncates.
    const resolvedMaxOutputTokens = maxOutputTokens ?? (isAnthropic ? ANTHROPIC_DEFAULT_MAX_OUTPUT_TOKENS : undefined)

    const args: Record<string, unknown> = {
      model: this.modelId,
      input,
      instructions,
      max_output_tokens: resolvedMaxOutputTokens,
      max_steps: opts.maxSteps,
      temperature,
      top_p: topP,
      reasoning: opts.reasoningEffort ? { effort: opts.reasoningEffort } : undefined,
      response_format:
        responseFormat?.type === 'json' && responseFormat.schema
          ? {
              type: 'json_schema',
              json_schema: { name: responseFormat.name ?? 'response', schema: responseFormat.schema, strict: true }
            }
          : undefined,
      tools: this.buildTools(opts),
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
    let text = ''
    for (const item of response.output ?? []) {
      text += messageText(item)
      for (const source of extractSources(item)) {
        if (seenUrls.has(source.url)) continue
        seenUrls.add(source.url)
        content.push({ type: 'source', sourceType: 'url', id: generateId(), url: source.url, title: source.title })
      }
    }
    if (text.length > 0) content.unshift({ type: 'text', text })

    return {
      content,
      finishReason: mapStatusToFinishReason(response.status),
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
    const seenUrls = new Set<string>()
    const openTextIds = new Set<string>()
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

            const event = chunk.value as PerplexityAgentEvent & Record<string, unknown>
            switch (event.type) {
              case 'response.created':
              case 'response.in_progress': {
                const envelope = (event as { response?: { id?: string; model?: string } }).response
                if (envelope?.id) responseId = envelope.id
                if (event.type === 'response.created') {
                  controller.enqueue({ type: 'response-metadata', id: envelope?.id, modelId: envelope?.model })
                }
                break
              }
              case 'response.output_text.delta': {
                const id = (event as { item_id?: string }).item_id ?? '0'
                if (!openTextIds.has(id)) {
                  controller.enqueue({ type: 'text-start', id })
                  openTextIds.add(id)
                }
                controller.enqueue({ type: 'text-delta', id, delta: (event as { delta: string }).delta })
                break
              }
              case 'response.output_text.done': {
                const id = (event as { item_id?: string }).item_id ?? '0'
                if (openTextIds.has(id)) {
                  controller.enqueue({ type: 'text-end', id })
                  openTextIds.delete(id)
                }
                break
              }
              case 'response.output_item.added':
              case 'response.output_item.done': {
                const item = (event as { item?: PerplexityOutputItem }).item
                if (item) emitSources(extractSources(item))
                break
              }
              case 'response.reasoning.started':
                emitThought((event as { thought?: string }).thought)
                break
              case 'response.reasoning.search_queries':
              case 'response.reasoning.fetch_url_queries':
                emitThought((event as { thought?: string }).thought)
                break
              case 'response.reasoning.search_results': {
                emitThought((event as { thought?: string }).thought)
                emitSources(
                  extractSources({
                    type: 'search_results',
                    results: (event as { results?: PerplexityResultEntry[] }).results
                  } as PerplexityOutputItem)
                )
                break
              }
              case 'response.reasoning.fetch_url_results': {
                emitThought((event as { thought?: string }).thought)
                emitSources(
                  extractSources({
                    type: 'fetch_url_results',
                    contents: (event as { contents?: PerplexityResultEntry[] }).contents
                  } as PerplexityOutputItem)
                )
                break
              }
              case 'response.reasoning.stopped':
                emitThought((event as { thought?: string }).thought)
                if (reasoningOpen) {
                  controller.enqueue({ type: 'reasoning-end', id: REASONING_ID })
                  reasoningOpen = false
                }
                break
              case 'response.completed': {
                const envelope = (
                  event as {
                    response?: { id?: string; status?: string; usage?: AgentUsage; output?: PerplexityOutputItem[] }
                  }
                ).response
                if (envelope?.id) responseId = envelope.id
                usage = envelope?.usage ?? usage
                finishReason = mapStatusToFinishReason(envelope?.status ?? 'completed')
                for (const item of envelope?.output ?? []) emitSources(extractSources(item))
                break
              }
              case 'response.failed': {
                const errData = (event as { error?: { message?: string } }).error
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
