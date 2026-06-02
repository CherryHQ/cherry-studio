import { createPaintingGenerateError } from '@renderer/aiCore/errors/paintingGenerateError'
import { readErrorMessage } from '@renderer/aiCore/errors/readErrorMessage'

import type { ImageGenerationSubmitInput, ImageGenerationTransport } from '../imageGenerationModel'
import { fileToDataUrl } from '../transportUtils'

export const DEFAULT_DMXAPI_BASE_URL = 'https://www.dmxapi.com'

interface NormalizedInput {
  modelId: string
  prompt: string
  n: number
  size: string | undefined
  seed: number | undefined
}

/**
 * Per-model descriptor injected by `paintingPipeline` from
 * `modes[mode].vendorTransport`. `endpoint` carries the path the transport
 * POSTs to (with `{model}` substitution for the gemini family); `id` drives
 * `resolveDmxapiFamily` to pick the body builder + response parser.
 */
export interface DmxapiModelDescriptor {
  id: string
  endpoint: string
  isSync?: boolean
  mode?: string
}

/**
 * Vendor-specific fields forwarded through `providerOptions.dmxapi`. AI SDK
 * native fields (size / n / seed / prompt) source from `input.*` at submit
 * entry, not from this bag — canonicalGenerate's POSITIONAL_RENAME +
 * AI_SDK_NATIVE_KEYS partition puts them on the AI SDK call options instead.
 */
export interface DmxapiProviderParams {
  model?: string
  modelDescriptor?: DmxapiModelDescriptor
  /** doubao-seedream multi-image options. */
  sequentialImageGeneration?: 'auto' | 'disabled'
  maxImages?: number
  outputFormat?: string
  webSearch?: boolean
  addWatermark?: boolean
  /** wan family extras (DashScope-passthrough). */
  promptExtend?: boolean
  /** Snake-cased by `buildImageProviderOptions` default branch. */
  negative_prompt?: string
}

export interface DmxapiTransportSettings {
  apiKey: string
  baseURL?: string
}

export type DmxapiFamily =
  | 'openai-flat' // gpt-image / dall-e / seededit — handled by OpenAICompatibleImageModel
  | 'responses-string' // doubao-seedream family — `/v1/responses` with `input: "<prompt>"`
  | 'responses-messages' // alibaba wan family — `/v1/responses` with DashScope-style messages
  | 'openai-flat-async' // qwen-image family — `/v1/images/generations` body, wrapped `extra.output.results[].url` response

interface DmxapiFamilyMatcher {
  family: Exclude<DmxapiFamily, 'openai-flat'>
  match: (modelId: string) => boolean
}

const DMXAPI_FAMILY_TABLE: DmxapiFamilyMatcher[] = [
  { family: 'responses-string', match: (id) => id.startsWith('doubao-seedream') },
  { family: 'responses-messages', match: (id) => /^wan\d/i.test(id) },
  { family: 'openai-flat-async', match: (id) => id.startsWith('qwen-image') }
]

export function resolveDmxapiFamily(modelId: string): DmxapiFamily {
  return DMXAPI_FAMILY_TABLE.find((entry) => entry.match(modelId))?.family ?? 'openai-flat'
}

/**
 * Markdown image syntax `![alt](url)` + plain URL fallback. Seedream's
 * Responses-API answers carry one or more image URLs inside
 * `output[0].content[0].text` as markdown links; this extracts them.
 */
const MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g
const PLAIN_URL_RE = /https?:\/\/[^\s,'"<>)]+/g

function extractUrlsFromText(text: string): string[] {
  const urls = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = MARKDOWN_IMAGE_RE.exec(text)) !== null) urls.add(match[1])
  if (urls.size === 0) {
    while ((match = PLAIN_URL_RE.exec(text)) !== null) urls.add(match[0])
  }
  return Array.from(urls)
}

class DmxapiTransport implements ImageGenerationTransport {
  private apiKey: string
  private baseURL: string

  constructor(settings: DmxapiTransportSettings) {
    this.apiKey = settings.apiKey
    this.baseURL = settings.baseURL || DEFAULT_DMXAPI_BASE_URL
  }

  async submit(input: ImageGenerationSubmitInput): Promise<{ taskId?: string; imageUrls?: string[] }> {
    const params = (input.providerParams ?? {}) as DmxapiProviderParams
    const normalized: NormalizedInput = {
      modelId: input.modelId,
      prompt: input.prompt ?? '',
      n: input.n,
      size: input.size,
      seed: input.seed
    }
    switch (resolveDmxapiFamily(input.modelId)) {
      case 'responses-string':
        return this.submitResponsesStringInput(input, normalized, params)
      case 'responses-messages':
        return this.submitResponsesMessages(input, normalized, params)
      case 'openai-flat-async':
        return this.submitAsyncOpenAIFlat(input, normalized)
      default:
        return this.submitOpenAIFlatFallback(input, normalized)
    }
  }

  /** Async qwen-image — POSTs to `/v1/images/generations`, response is wrapped
   *  in `extra.output.{task_status, results[].url}`. DMXAPI returns SUCCEEDED
   *  on the single call (gateway handles polling upstream). */
  private async submitAsyncOpenAIFlat(
    input: ImageGenerationSubmitInput,
    normalized: NormalizedInput
  ): Promise<{ imageUrls?: string[] }> {
    const body: Record<string, unknown> = {
      model: normalized.modelId,
      prompt: normalized.prompt,
      n: normalized.n
    }
    if (normalized.size) body.size = normalized.size

    const data = await this.requestJson('/v1/images/generations', body, input.signal)
    return { imageUrls: parseDmxapiAsyncResults(data) }
  }

  /** Responses API with `input` as a prompt string (doubao-seedream family).
   *  Response carries markdown-encoded image URLs inside
   *  `output[0].content[0].text`. */
  private async submitResponsesStringInput(
    input: ImageGenerationSubmitInput,
    normalized: NormalizedInput,
    params: DmxapiProviderParams
  ): Promise<{ imageUrls?: string[] }> {
    const body: Record<string, unknown> = {
      model: normalized.modelId,
      input: normalized.prompt,
      stream: false
    }
    if (normalized.size) body.size = normalized.size
    if (typeof normalized.seed === 'number') body.seed = normalized.seed
    if (params.sequentialImageGeneration) {
      body.sequential_image_generation = params.sequentialImageGeneration
      if (typeof params.maxImages === 'number') {
        body.sequential_image_generation_options = { max_images: params.maxImages }
      }
    }
    if (params.outputFormat) body.output_format = params.outputFormat
    if (params.addWatermark !== undefined) body.watermark = params.addWatermark
    if (params.webSearch) body.tools = [{ type: 'web_search' }]

    const data = await this.requestJson('/v1/responses', body, input.signal)
    return { imageUrls: parseResponsesApiOutput(data) }
  }

  /** Responses API with DashScope-style `input.messages` (alibaba wan family). */
  private async submitResponsesMessages(
    input: ImageGenerationSubmitInput,
    normalized: NormalizedInput,
    params: DmxapiProviderParams
  ): Promise<{ imageUrls?: string[] }> {
    const content: Array<{ text?: string; image?: string }> = []
    if (normalized.prompt) content.push({ text: normalized.prompt })
    for (const file of input.files ?? []) content.push({ image: fileToDataUrl(file) })

    const parameters: Record<string, unknown> = {}
    if (normalized.size) parameters.size = normalized.size.replace(/x/i, '*')
    if (normalized.n && normalized.n > 1) parameters.n = normalized.n
    if (typeof normalized.seed === 'number') parameters.seed = normalized.seed
    if (params.negative_prompt) parameters.negative_prompt = params.negative_prompt
    if (params.promptExtend !== undefined) parameters.prompt_extend = params.promptExtend
    if (params.addWatermark !== undefined) parameters.watermark = params.addWatermark

    const body: Record<string, unknown> = {
      model: normalized.modelId,
      input: { messages: [{ role: 'user', content }] },
      ...(Object.keys(parameters).length > 0 && { parameters })
    }

    const data = await this.requestJson('/v1/responses', body, input.signal)
    return { imageUrls: parseResponsesApiOutput(data) }
  }

  /** Safety-net OpenAI-flat call for unrecognized models that somehow bypass
   *  the provider factory's family dispatch. Mirrors the OpenAI-compat body
   *  shape so DMXAPI's gateway can translate to whatever upstream it routes
   *  to. Response is parsed as the standard OpenAI `data[].url|b64_json`. */
  private async submitOpenAIFlatFallback(
    input: ImageGenerationSubmitInput,
    normalized: NormalizedInput
  ): Promise<{ imageUrls?: string[] }> {
    const body: Record<string, unknown> = {
      model: normalized.modelId,
      prompt: normalized.prompt,
      n: normalized.n,
      response_format: 'url'
    }
    if (normalized.size) body.size = normalized.size

    const data = await this.requestJson('/v1/images/generations', body, input.signal)
    return { imageUrls: parseOpenAIFlatResults(data) }
  }

  private async requestJson(
    path: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
    opts?: { authHeader?: string; authValue?: string }
  ): Promise<unknown> {
    const url = path.startsWith('http') ? path : `${this.baseURL}${path}`
    const authHeader = opts?.authHeader ?? 'Authorization'
    const authValue = opts?.authValue ?? `Bearer ${this.apiKey}`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'DMXAPI/1.0.0 (https://www.dmxapi.com)',
        [authHeader]: authValue
      },
      body: JSON.stringify(body),
      signal
    })

    if (!response.ok) {
      if (response.status === 401) throw createPaintingGenerateError('REQ_ERROR_TOKEN')
      if (response.status === 403) throw createPaintingGenerateError('REQ_ERROR_NO_BALANCE')
      const message = await readErrorMessage(response, 'paintings.generate_failed')
      throw createPaintingGenerateError('REMOTE_ERROR', { message })
    }

    return response.json()
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Response parsers (one per backend family)
// ──────────────────────────────────────────────────────────────────────────────

function parseDmxapiAsyncResults(data: unknown): string[] {
  const output = (data as { extra?: { output?: { results?: Array<{ url?: string }> } } })?.extra?.output
  return (output?.results ?? []).map((r) => r.url ?? '').filter((url): url is string => !!url)
}

function parseResponsesApiOutput(data: unknown): string[] {
  type Content = { text?: string; image?: string; type?: string }
  type Output = { content?: Content[]; message?: { content?: Content[] } }
  const outputs = (data as { output?: Output | Output[] })?.output
  const list: Output[] = Array.isArray(outputs) ? outputs : outputs ? [outputs] : []
  const urls: string[] = []
  for (const entry of list) {
    const parts = entry.content ?? entry.message?.content ?? []
    for (const part of parts) {
      if (part.image) urls.push(part.image)
      else if (typeof part.text === 'string') urls.push(...extractUrlsFromText(part.text))
    }
  }
  return urls
}

function parseOpenAIFlatResults(data: unknown): string[] {
  const items = (data as { data?: Array<{ url?: string; b64_json?: string }> })?.data ?? []
  return items
    .map((item) => {
      if (item.url) return item.url
      if (item.b64_json) return `data:image/png;base64,${item.b64_json}`
      return ''
    })
    .filter((url) => url.length > 0)
}

export function createDmxapiTransport(settings: DmxapiTransportSettings): DmxapiTransport {
  return new DmxapiTransport(settings)
}

export type { DmxapiTransport }
