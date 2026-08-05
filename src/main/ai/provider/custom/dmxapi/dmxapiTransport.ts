import { APICallError } from '@ai-sdk/provider'
import { combineHeaders, createJsonResponseHandler, type FetchFunction, postJsonToApi } from '@ai-sdk/provider-utils'
import type { VendorBag } from '@main/ai/utils/imageOptions'
import { t } from '@main/i18n'
import { createPaintingGenerateError } from '@shared/ai/paintingGenerateError'
import * as z from 'zod'

import type { ImageGenerationSubmitInput } from '../imageTransport'
import {
  completedImageTransportSubmission,
  type ImageTransportInputSupport,
  type ImmediateImageGenerationTransport
} from '../imageTransport'
import { createImageTransportErrorResponseHandler } from '../imageTransportHttp'
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
 * Vendor-specific fields forwarded through `providerOptions.dmxapi`. AI SDK native
 * fields (size / n / seed / prompt) source from `input.*` at submit entry; DMXAPI
 * dispatches by `resolveDmxapiFamily(input.modelId)`, so it needs no `modelDescriptor`.
 *
 * The vendor bag as this transport reads it — canonical camelCase, straight from
 * `splitParamValues`.
 *
 * Derived from {@link ParamValues} so every key is CHECKED to be a catalog key. A
 * hand-declared name that isn't one can never arrive: the IPC boundary strips it. That
 * is what `webSearch` was — read here to emit `tools: [{type:'web_search'}]`, never
 * delivered, and declared by no model in the registry either, so the branch was dead
 * on both ends and has been removed.
 *
 * Groups: doubao-seedream multi-image options; wan family extras (DashScope-passthrough).
 */
export type DmxapiProviderParams = Pick<
  VendorBag,
  'sequentialImageGeneration' | 'maxImages' | 'outputFormat' | 'addWatermark' | 'promptExtend' | 'negativePrompt'
>

export interface DmxapiTransportSettings {
  apiKey: string
  baseURL?: string
  headers?: Record<string, string | undefined>
  fetch?: FetchFunction
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

const dmxapiAsyncResultSchema = z
  .object({
    extra: z
      .object({
        output: z.object({ results: z.array(z.object({ url: z.string().min(1) }).passthrough()) }).passthrough()
      })
      .passthrough()
  })
  .passthrough()
const responseContentSchema = z
  .object({ text: z.string().optional(), image: z.string().min(1).optional(), type: z.string().optional() })
  .passthrough()
const responseOutputSchema = z
  .object({
    content: z.array(responseContentSchema).optional(),
    message: z
      .object({ content: z.array(responseContentSchema).optional() })
      .passthrough()
      .optional()
  })
  .passthrough()
const dmxapiResponsesSchema = z
  .object({ output: z.union([responseOutputSchema, z.array(responseOutputSchema)]) })
  .passthrough()
const dmxapiOpenAIResultSchema = z
  .object({
    data: z.array(z.object({ url: z.string().min(1).optional(), b64_json: z.string().min(1).optional() }).passthrough())
  })
  .passthrough()

class DmxapiTransport implements ImmediateImageGenerationTransport<DmxapiProviderParams> {
  private readonly apiKey: string
  private readonly baseURL: string
  private readonly headers: Record<string, string | undefined> | undefined
  private readonly fetch: FetchFunction | undefined

  readonly task = { kind: 'unsupported' as const }

  constructor(settings: DmxapiTransportSettings) {
    this.apiKey = settings.apiKey
    this.baseURL = settings.baseURL || DEFAULT_DMXAPI_BASE_URL
    this.headers = settings.headers
    this.fetch = settings.fetch
  }

  /** Only the `responses-messages` family (Wan) puts images in its message content;
   *  Seedream's `responses-string` body is a bare prompt string, and both flat
   *  families are prompt-only. Mirrors the `resolveDmxapiFamily` dispatch below. */
  supportsInput(input: ImageGenerationSubmitInput<DmxapiProviderParams>): ImageTransportInputSupport {
    return { files: resolveDmxapiFamily(input.modelId) === 'responses-messages', mask: false }
  }

  async submit(input: ImageGenerationSubmitInput<DmxapiProviderParams>) {
    const params = input.providerParams
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
    input: ImageGenerationSubmitInput<DmxapiProviderParams>,
    normalized: NormalizedInput
  ) {
    const body: Record<string, unknown> = {
      model: normalized.modelId,
      prompt: normalized.prompt,
      n: normalized.n
    }
    if (normalized.size) body.size = normalized.size

    const data = await this.requestJson('/v1/images/generations', body, dmxapiAsyncResultSchema, input)
    return completedImageTransportSubmission(parseDmxapiAsyncResults(data), 'DMXAPI async image')
  }

  /** Responses API with `input` as a prompt string (doubao-seedream family).
   *  Response carries markdown-encoded image URLs inside
   *  `output[0].content[0].text`. */
  private async submitResponsesStringInput(
    input: ImageGenerationSubmitInput<DmxapiProviderParams>,
    normalized: NormalizedInput,
    params: DmxapiProviderParams
  ) {
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

    const data = await this.requestJson('/v1/responses', body, dmxapiResponsesSchema, input)
    return completedImageTransportSubmission(parseResponsesApiOutput(data), 'DMXAPI responses image')
  }

  /** Responses API with DashScope-style `input.messages` (alibaba wan family). */
  private async submitResponsesMessages(
    input: ImageGenerationSubmitInput<DmxapiProviderParams>,
    normalized: NormalizedInput,
    params: DmxapiProviderParams
  ) {
    const content: Array<{ text?: string; image?: string }> = []
    if (normalized.prompt) content.push({ text: normalized.prompt })
    for (const file of input.files ?? []) content.push({ image: fileToDataUrl(file) })

    const parameters: Record<string, unknown> = {}
    if (normalized.size) parameters.size = normalized.size.replace(/x/i, '*')
    if (normalized.n && normalized.n > 1) parameters.n = normalized.n
    if (typeof normalized.seed === 'number') parameters.seed = normalized.seed
    if (params.negativePrompt) parameters.negative_prompt = params.negativePrompt
    if (params.promptExtend !== undefined) parameters.prompt_extend = params.promptExtend
    if (params.addWatermark !== undefined) parameters.watermark = params.addWatermark

    const body: Record<string, unknown> = {
      model: normalized.modelId,
      input: { messages: [{ role: 'user', content }] },
      ...(Object.keys(parameters).length > 0 && { parameters })
    }

    const data = await this.requestJson('/v1/responses', body, dmxapiResponsesSchema, input)
    return completedImageTransportSubmission(parseResponsesApiOutput(data), 'DMXAPI responses image')
  }

  /** Safety-net OpenAI-flat call for unrecognized models that somehow bypass
   *  the provider factory's family dispatch. Mirrors the OpenAI-compat body
   *  shape so DMXAPI's gateway can translate to whatever upstream it routes
   *  to. Response is parsed as the standard OpenAI `data[].url|b64_json`. */
  private async submitOpenAIFlatFallback(
    input: ImageGenerationSubmitInput<DmxapiProviderParams>,
    normalized: NormalizedInput
  ) {
    const body: Record<string, unknown> = {
      model: normalized.modelId,
      prompt: normalized.prompt,
      n: normalized.n,
      response_format: 'url'
    }
    if (normalized.size) body.size = normalized.size

    const data = await this.requestJson('/v1/images/generations', body, dmxapiOpenAIResultSchema, input)
    return completedImageTransportSubmission(parseOpenAIFlatResults(data), 'DMXAPI image')
  }

  private async requestJson<T>(
    path: string,
    body: Record<string, unknown>,
    schema: z.ZodType<T>,
    input: ImageGenerationSubmitInput<DmxapiProviderParams>
  ): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.baseURL}${path}`
    try {
      const response = await postJsonToApi({
        url,
        headers: combineHeaders(
          {
            Accept: 'application/json',
            'User-Agent': 'DMXAPI/1.0.0 (https://www.dmxapi.com)',
            Authorization: `Bearer ${this.apiKey}`
          },
          this.headers,
          input.headers
        ),
        body,
        abortSignal: input.signal,
        fetch: this.fetch,
        failedResponseHandler: createImageTransportErrorResponseHandler(),
        successfulResponseHandler: createJsonResponseHandler(schema)
      })
      return response.value
    } catch (error) {
      if (APICallError.isInstance(error)) {
        if (error.statusCode === 401) throw createPaintingGenerateError('REQ_ERROR_TOKEN')
        if (error.statusCode === 403) throw createPaintingGenerateError('REQ_ERROR_NO_BALANCE')
        throw createPaintingGenerateError('REMOTE_ERROR', {
          message: error.message || t('paintings.generate_failed')
        })
      }
      throw error
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Response parsers (one per backend family)
// ──────────────────────────────────────────────────────────────────────────────

function parseDmxapiAsyncResults(data: z.infer<typeof dmxapiAsyncResultSchema>): string[] {
  return data.extra.output.results.map((result) => result.url)
}

function parseResponsesApiOutput(data: z.infer<typeof dmxapiResponsesSchema>): string[] {
  const list = Array.isArray(data.output) ? data.output : [data.output]
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

function parseOpenAIFlatResults(data: z.infer<typeof dmxapiOpenAIResultSchema>): string[] {
  return data.data
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
