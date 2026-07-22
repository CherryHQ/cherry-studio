/**
 * Zod wire schemas for the Perplexity Agent API (`POST /v1/agent`).
 *
 * The endpoint is OpenAI-Responses-shaped: an `output[]` of typed items and a
 * matching set of SSE events. We validate only the fields we consume and stay
 * tolerant of everything else — unknown output-item / event types fall through
 * to a permissive catch-all so a server-side addition never breaks a request.
 *
 * Scope: text + citations/search results + reasoning. Function-calling, sandbox
 * and native MCP items are accepted (and ignored) but not surfaced.
 */
import * as z from 'zod'

// ── shared ──

/** A single web/search/fetch result — url is what we turn into an AI SDK source. */
export const perplexityResultEntrySchema = z.looseObject({
  url: z.string().nullish(),
  title: z.string().nullish(),
  snippet: z.string().nullish(),
  date: z.string().nullish()
})
export type PerplexityResultEntry = z.infer<typeof perplexityResultEntrySchema>

export const perplexityAgentUsageSchema = z.object({
  input_tokens: z.number().nullish(),
  output_tokens: z.number().nullish(),
  total_tokens: z.number().nullish(),
  input_tokens_details: z
    .object({
      cache_creation_input_tokens: z.number().nullish(),
      cache_read_input_tokens: z.number().nullish()
    })
    .nullish(),
  cost: z.looseObject({ total_cost: z.number().nullish() }).nullish()
})
export type PerplexityAgentUsage = z.infer<typeof perplexityAgentUsageSchema>

// ── output items ──

const urlCitationSchema = z.object({
  type: z.literal('url_citation'),
  url: z.string(),
  title: z.string().nullish(),
  start_index: z.number().nullish(),
  end_index: z.number().nullish()
})

const annotationSchema = z.union([urlCitationSchema, z.looseObject({ type: z.string() })])

const outputTextSchema = z.object({
  type: z.literal('output_text'),
  text: z.string(),
  annotations: z.array(annotationSchema).nullish()
})

const messageItemSchema = z.object({
  type: z.literal('message'),
  id: z.string().nullish(),
  role: z.string().nullish(),
  status: z.string().nullish(),
  content: z.array(z.union([outputTextSchema, z.looseObject({ type: z.string() })])).nullish()
})

const searchResultsItemSchema = z.object({
  type: z.literal('search_results'),
  queries: z.array(z.string()).nullish(),
  results: z.array(perplexityResultEntrySchema).nullish()
})

const peopleSearchResultsItemSchema = z.object({
  type: z.literal('people_search_results'),
  queries: z.array(z.string()).nullish(),
  results: z.array(perplexityResultEntrySchema).nullish()
})

const fetchUrlResultsItemSchema = z.object({
  type: z.literal('fetch_url_results'),
  contents: z.array(perplexityResultEntrySchema).nullish()
})

/** Catch-all — any item type we don't consume (function_call, sandbox_results, mcp_*, …). */
const unknownItemSchema = z.looseObject({ type: z.string() })

export const perplexityOutputItemSchema = z.union([
  messageItemSchema,
  searchResultsItemSchema,
  peopleSearchResultsItemSchema,
  fetchUrlResultsItemSchema,
  unknownItemSchema
])
export type PerplexityOutputItem = z.infer<typeof perplexityOutputItemSchema>

// ── non-streaming response ──

export const perplexityAgentResponseSchema = z.object({
  id: z.string().nullish(),
  object: z.string().nullish(),
  created_at: z.number().nullish(),
  status: z.string().nullish(),
  model: z.string().nullish(),
  output: z.array(perplexityOutputItemSchema).nullish(),
  usage: perplexityAgentUsageSchema.nullish(),
  error: z.object({ message: z.string().nullish(), code: z.string().nullish(), type: z.string().nullish() }).nullish()
})
export type PerplexityAgentResponse = z.infer<typeof perplexityAgentResponseSchema>

// ── error body ──

// Tolerate both a wrapped `{ error: {…} }` body and a top-level `{ message, code, type }`.
export const perplexityAgentErrorSchema = z.looseObject({
  error: z
    .union([
      z.string(),
      z.looseObject({
        message: z.string().nullish(),
        code: z.union([z.string(), z.number()]).nullish(),
        type: z.string().nullish()
      })
    ])
    .nullish(),
  message: z.string().nullish(),
  code: z.union([z.string(), z.number()]).nullish(),
  type: z.string().nullish()
})

export const perplexityAgentErrorToMessage = (data: z.infer<typeof perplexityAgentErrorSchema>): string => {
  const error = data.error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') return error.message ?? error.type ?? 'unknown error'
  return data.message ?? data.type ?? 'unknown error'
}

// ── streaming events ──

const responseEnvelopeSchema = z.looseObject({
  id: z.string().nullish(),
  model: z.string().nullish(),
  status: z.string().nullish(),
  usage: perplexityAgentUsageSchema.nullish(),
  output: z.array(perplexityOutputItemSchema).nullish()
})

export const perplexityAgentEventSchema = z.union([
  z.object({ type: z.literal('response.created'), response: responseEnvelopeSchema.nullish() }),
  z.object({ type: z.literal('response.in_progress'), response: responseEnvelopeSchema.nullish() }),
  z.object({ type: z.literal('response.completed'), response: responseEnvelopeSchema.nullish() }),
  z.object({
    type: z.literal('response.failed'),
    error: z.looseObject({ message: z.string().nullish() }).nullish()
  }),
  z.object({ type: z.literal('response.output_item.added'), item: perplexityOutputItemSchema.nullish() }),
  z.object({ type: z.literal('response.output_item.done'), item: perplexityOutputItemSchema.nullish() }),
  z.object({ type: z.literal('response.output_text.delta'), item_id: z.string().nullish(), delta: z.string() }),
  z.object({ type: z.literal('response.output_text.done'), item_id: z.string().nullish(), text: z.string().nullish() }),
  z.object({ type: z.literal('response.reasoning.started'), thought: z.string().nullish() }),
  z.object({
    type: z.literal('response.reasoning.search_queries'),
    thought: z.string().nullish(),
    queries: z.array(z.string()).nullish()
  }),
  z.object({
    type: z.literal('response.reasoning.search_results'),
    thought: z.string().nullish(),
    results: z.array(perplexityResultEntrySchema).nullish()
  }),
  z.object({
    type: z.literal('response.reasoning.fetch_url_queries'),
    thought: z.string().nullish(),
    urls: z.array(z.string()).nullish()
  }),
  z.object({
    type: z.literal('response.reasoning.fetch_url_results'),
    thought: z.string().nullish(),
    contents: z.array(perplexityResultEntrySchema).nullish()
  }),
  z.object({ type: z.literal('response.reasoning.stopped'), thought: z.string().nullish() }),
  // catch-all for any event type we don't act on
  z.looseObject({ type: z.string() })
])
export type PerplexityAgentEvent = z.infer<typeof perplexityAgentEventSchema>

// ── server-side tools (`web_search`, `fetch_url`) ──

export const perplexityUserLocationSchema = z.object({
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  country: z.string().optional()
})

/** `web_search` tool config — https://docs.perplexity.ai/docs/agent-api/tools/web-search */
export const perplexityWebSearchConfigSchema = z.object({
  maxResults: z.number().int().optional(),
  maxTokens: z.number().int().optional(),
  maxTokensPerPage: z.number().int().optional(),
  searchContextSize: z.enum(['low', 'medium', 'high']).optional(),
  searchDomainFilter: z.array(z.string()).optional(),
  searchRecencyFilter: z.enum(['hour', 'day', 'week', 'month', 'year']).optional(),
  searchAfterDateFilter: z.string().optional(),
  searchBeforeDateFilter: z.string().optional(),
  lastUpdatedAfterFilter: z.string().optional(),
  lastUpdatedBeforeFilter: z.string().optional(),
  userLocation: perplexityUserLocationSchema.optional()
})
export type PerplexityWebSearchConfig = z.infer<typeof perplexityWebSearchConfigSchema>

/** `fetch_url` tool config — https://docs.perplexity.ai/docs/agent-api/tools/fetch-url-content */
export const perplexityFetchUrlConfigSchema = z.object({
  maxUrls: z.number().int().min(1).max(10).optional()
})
export type PerplexityFetchUrlConfig = z.infer<typeof perplexityFetchUrlConfigSchema>

// ── provider options (`providerOptions.perplexity`) ──

export const perplexityAgentProviderOptionsSchema = z.object({
  /** Preset config name: fast | low | medium | high | xhigh (sent alongside model). */
  preset: z.string().optional(),
  /** Extra model fallback chain (max 5). */
  models: z.array(z.string()).optional(),
  /** Max research-loop iterations (1–100). */
  maxSteps: z.number().int().optional(),
  /** Reasoning effort for the underlying model. */
  reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
  /** `web_search` tool: `true`/config enables (default ON), `false` disables. */
  webSearch: z.union([z.boolean(), perplexityWebSearchConfigSchema]).optional(),
  /** `fetch_url` tool: `true`/config enables (default OFF). */
  fetchUrl: z.union([z.boolean(), perplexityFetchUrlConfigSchema]).optional(),
  languagePreference: z.string().optional(),
  previousResponseId: z.string().optional(),
  store: z.boolean().optional()
})
export type PerplexityAgentProviderOptions = z.infer<typeof perplexityAgentProviderOptionsSchema>
