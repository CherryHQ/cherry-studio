import { createProviderToolFactoryWithOutputSchema, lazySchema, zodSchema } from '@ai-sdk/provider-utils'
import * as z from 'zod'

import {
  type PerplexityFetchUrlConfig,
  type PerplexityResultEntry,
  perplexityResultEntrySchema,
  type PerplexityWebSearchConfig
} from './perplexityAgentSchemas'

const emptyInputSchema = lazySchema(() => zodSchema(z.object({})))

export const perplexityWebSearchOutputSchema = z
  .object({
    type: z.enum(['search_results', 'people_search_results']),
    queries: z.array(z.string()).nullish(),
    results: z.array(perplexityResultEntrySchema).nullish()
  })
  .loose()

export const perplexityFetchUrlOutputSchema = z
  .object({
    type: z.literal('fetch_url_results'),
    contents: z.array(perplexityResultEntrySchema).nullish()
  })
  .loose()

export type PerplexityWebSearchOutput = {
  type: 'search_results' | 'people_search_results'
  queries?: string[] | null
  results?: PerplexityResultEntry[] | null
  [key: string]: unknown
}

export type PerplexityFetchUrlOutput = {
  type: 'fetch_url_results'
  contents?: PerplexityResultEntry[] | null
  [key: string]: unknown
}

const webSearchToolFactory = createProviderToolFactoryWithOutputSchema<
  Record<string, never>,
  PerplexityWebSearchOutput,
  PerplexityWebSearchConfig
>({
  id: 'perplexity.web_search',
  inputSchema: emptyInputSchema,
  outputSchema: lazySchema(() => zodSchema(perplexityWebSearchOutputSchema))
})

const fetchUrlToolFactory = createProviderToolFactoryWithOutputSchema<
  Record<string, never>,
  PerplexityFetchUrlOutput,
  PerplexityFetchUrlConfig
>({
  id: 'perplexity.fetch_url',
  inputSchema: emptyInputSchema,
  outputSchema: lazySchema(() => zodSchema(perplexityFetchUrlOutputSchema))
})

const webSearch = (config: PerplexityWebSearchConfig = {}) => webSearchToolFactory(config)
const fetchUrl = (config: PerplexityFetchUrlConfig = {}) => fetchUrlToolFactory(config)

export const perplexityTools = { webSearch, fetchUrl }
