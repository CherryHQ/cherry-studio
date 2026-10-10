/**
 * Shared helpers for a creator's `fetchModels()` — built on `@ai-sdk/provider-utils`. The connection
 * host comes from the typed `src/providers` registry (the single source of truth for endpoints): a
 * first-party creator passes its Cherry provider id and we reuse that provider's `baseUrl` — no duplicated
 * URLs. Reading the source (not the generated `data/providers.json`) keeps the generator buildable from
 * a clean checkout where `data/` hasn't been generated yet. Creators with no Cherry provider pass a full
 * `https://…` base instead. Runs at generation time only.
 */
import { createJsonResponseHandler, createStatusCodeErrorResponseHandler, getFromApi } from '@ai-sdk/provider-utils'
import * as z from 'zod'

import { PROVIDERS } from '../providers'
import type { CreatorModel } from './types'

const errorHandler = createStatusCodeErrorResponseHandler()

function requireKey(env: string): string {
  const k = process.env[env]
  if (!k) throw new Error(`${env} not set — generator falls back to models.dev`)
  return k
}

/** Resolve a connection host: a full `https://…` base, or a Cherry provider id → its baseUrl. */
function hostBase(providerOrUrl: string): string {
  if (/^https?:\/\//.test(providerOrUrl)) return providerOrUrl.replace(/\/+$/, '')
  const ec = PROVIDERS.find((p) => p.id === providerOrUrl)?.endpointConfigs ?? {}
  const base =
    ec['openai-chat-completions']?.baseUrl ??
    ec['openai-responses']?.baseUrl ??
    ec['anthropic-messages']?.baseUrl ??
    ec['google-generate-content']?.baseUrl
  if (!base) throw new Error(`no baseUrl for provider '${providerOrUrl}' in src/providers`)
  return base.replace(/\/+$/, '')
}

/** OpenAI-compatible `/models` lives under a version segment — append `/v1` when the base has none. */
const oaiModelsUrl = (base: string) =>
  /\/(?:v\d+|paas\/v\d+|compatible-mode\/v\d+)$/i.test(base) ? `${base}/models` : `${base}/v1/models`

/** GET a JSON model list and map it to `CreatorModel[]`. */
export async function listModels<T>(opts: {
  url: string
  headers?: Record<string, string | undefined>
  schema: z.ZodType<T>
  pick: (r: T) => string[]
}): Promise<CreatorModel[]> {
  const { value } = await getFromApi({
    url: opts.url,
    headers: opts.headers,
    successfulResponseHandler: createJsonResponseHandler(opts.schema),
    failedResponseHandler: errorHandler
  })
  return opts.pick(value).map((id) => ({ id }))
}

const OPENAI_SHAPE = z.object({ data: z.array(z.object({ id: z.string() })) })

/** OpenAI-compatible `GET {base}/models`. `providerOrUrl` = a Cherry provider id or a full base. */
export function openaiCompatible(providerOrUrl: string, keyEnv: string) {
  return () =>
    listModels({
      url: oaiModelsUrl(hostBase(providerOrUrl)),
      headers: { authorization: `Bearer ${requireKey(keyEnv)}` },
      schema: OPENAI_SHAPE,
      pick: (r) => r.data.map((m) => m.id)
    })
}

/** Anthropic `GET /v1/models` — `x-api-key` + version header. */
export function anthropicModels(providerOrUrl = 'anthropic', keyEnv = 'ANTHROPIC_API_KEY') {
  return () =>
    listModels({
      url: `${hostBase(providerOrUrl)}/v1/models?limit=1000`,
      headers: { 'x-api-key': requireKey(keyEnv), 'anthropic-version': '2023-06-01' },
      schema: OPENAI_SHAPE,
      pick: (r) => r.data.map((m) => m.id)
    })
}

/** Google Generative Language `GET /v1beta/models?key=` → `{ models: [{ name: "models/…" }] }`. */
export function googleModels(providerOrUrl = 'gemini', keyEnv = 'GEMINI_API_KEY') {
  return () =>
    listModels({
      url: `${hostBase(providerOrUrl)}/v1beta/models?pageSize=1000&key=${requireKey(keyEnv)}`,
      schema: z.object({ models: z.array(z.object({ name: z.string() })) }),
      pick: (r) => r.models.map((m) => m.name.replace(/^models\//, ''))
    })
}

/** Cohere `GET /v1/models` → `{ models: [{ name }] }`. */
export function cohereModels(keyEnv = 'COHERE_API_KEY') {
  return () =>
    listModels({
      url: 'https://api.cohere.com/v1/models?page_size=1000',
      headers: { authorization: `Bearer ${requireKey(keyEnv)}` },
      schema: z.object({ models: z.array(z.object({ name: z.string() })) }),
      pick: (r) => r.models.map((m) => m.name)
    })
}
