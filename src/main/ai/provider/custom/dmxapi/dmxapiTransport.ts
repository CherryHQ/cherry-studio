import { APICallError } from '@ai-sdk/provider'
import { createJsonResponseHandler, type FetchFunction, postJsonToApi } from '@ai-sdk/provider-utils'
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
import { combineImageTransportHeaders, createImageTransportErrorResponseHandler } from '../imageTransportHttp'
import { fileToDataUrl } from '../transportUtils'
import type { DmxapiCustomImageBinding } from './dmxapiImageRouting'

export const DEFAULT_DMXAPI_BASE_URL = 'https://www.dmxapi.com'

type NormalizedInput = Pick<ImageGenerationSubmitInput<DmxapiProviderParams>, 'modelId' | 'n' | 'size' | 'seed'> & {
  prompt: string
}

/** Canonical vendor parameters consumed by the bound DMXAPI custom protocols. */
export type DmxapiProviderParams = Pick<
  VendorBag,
  'sequentialImageGeneration' | 'maxImages' | 'outputFormat' | 'addWatermark' | 'promptExtend' | 'negativePrompt'
>

export interface DmxapiTransportSettings {
  binding: DmxapiCustomImageBinding
  apiKey: string
  baseURL?: string
  headers?: Record<string, string | undefined>
  fetch?: FetchFunction
}

const MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g

function extractMarkdownImages(text: string): string[] {
  const urls = new Set<string>()
  for (const match of text.matchAll(MARKDOWN_IMAGE_RE)) urls.add(match[1])
  return Array.from(urls)
}

const dmxapiAsyncResultSchema = z
  .object({
    extra: z
      .object({
        output: z
          .object({
            task_status: z.literal('SUCCEEDED'),
            results: z.array(z.object({ url: z.string().min(1) }).passthrough()).min(1)
          })
          .passthrough()
      })
      .passthrough()
  })
  .passthrough()
const seedreamTextSchema = z
  .string()
  .min(1)
  .transform((text, ctx) => {
    const urls = extractMarkdownImages(text)
    if (urls.length > 0) return urls
    ctx.addIssue({ code: 'custom', message: 'Seedream output requires a Markdown image link' })
    return z.NEVER
  })
const dmxapiSeedreamResponseSchema = z.object({
  status: z.literal('completed'),
  output: z
    .array(
      z.object({
        type: z.literal('message'),
        status: z.literal('completed'),
        content: z.array(z.object({ type: z.literal('output_text'), text: seedreamTextSchema })).min(1)
      })
    )
    .min(1)
})
const dmxapiWanResponseSchema = z.object({
  output: z
    .array(
      z.object({
        type: z.literal('message'),
        content: z.array(z.object({ type: z.literal('image'), text: z.url({ protocol: /^https?$/ }) })).min(1)
      })
    )
    .min(1)
})
class DmxapiTransport implements ImmediateImageGenerationTransport<DmxapiProviderParams> {
  private readonly apiKey: string
  private readonly baseURL: string
  private readonly headers: Record<string, string | undefined> | undefined
  private readonly fetch: FetchFunction | undefined

  private readonly binding: DmxapiCustomImageBinding

  readonly task = { kind: 'unsupported' as const }

  constructor(settings: DmxapiTransportSettings) {
    this.apiKey = settings.apiKey
    this.baseURL = settings.baseURL || DEFAULT_DMXAPI_BASE_URL
    this.headers = settings.headers
    this.fetch = settings.fetch
    this.binding = { ...settings.binding }
  }

  supportsInput(): ImageTransportInputSupport {
    return { files: this.binding.family === 'responses-messages', mask: false }
  }

  async submit(input: ImageGenerationSubmitInput<DmxapiProviderParams>) {
    const params = input.providerParams
    const normalized: NormalizedInput = {
      modelId: this.binding.modelId,
      prompt: input.prompt ?? '',
      n: input.n,
      size: input.size,
      seed: input.seed
    }
    try {
      switch (this.binding.family) {
        case 'responses-string':
          return await this.submitResponsesStringInput(input, normalized, params)
        case 'responses-messages':
          return await this.submitResponsesMessages(input, normalized, params)
        case 'openai-flat-async':
          return await this.submitAsyncOpenAIFlat(input, normalized)
      }
    } catch (error) {
      if (!APICallError.isInstance(error)) throw error
      if (error.statusCode === 401) throw createPaintingGenerateError('REQ_ERROR_TOKEN')
      if (error.statusCode === 403) throw createPaintingGenerateError('REQ_ERROR_NO_BALANCE')
      throw createPaintingGenerateError('REMOTE_ERROR', { message: error.message || t('paintings.generate_failed') })
    }
  }

  /** Async qwen-image — POSTs to `/v1/images/generations`, response is wrapped
   *  in `extra.output.{task_status, results[].url}`. DMXAPI returns SUCCEEDED
   *  on the single call (gateway handles polling upstream). */
  private async submitAsyncOpenAIFlat(
    input: ImageGenerationSubmitInput<DmxapiProviderParams>,
    normalized: NormalizedInput
  ) {
    const body = {
      model: normalized.modelId,
      prompt: normalized.prompt,
      n: normalized.n,
      ...(normalized.size !== undefined && { size: normalized.size })
    }
    const response = await postJsonToApi({
      url: `${this.baseURL}/v1/images/generations`,
      headers: this.requestHeaders(input.headers),
      body,
      abortSignal: input.signal,
      fetch: this.fetch,
      failedResponseHandler: createImageTransportErrorResponseHandler(),
      successfulResponseHandler: createJsonResponseHandler(dmxapiAsyncResultSchema)
    })
    return completedImageTransportSubmission(parseDmxapiAsyncResults(response.value), 'DMXAPI async image')
  }

  /** Responses API with `input` as a prompt string (doubao-seedream family).
   *  Response carries markdown-encoded image URLs inside
   *  `output[0].content[0].text`. */
  private async submitResponsesStringInput(
    input: ImageGenerationSubmitInput<DmxapiProviderParams>,
    normalized: NormalizedInput,
    params: DmxapiProviderParams
  ) {
    const body = {
      model: normalized.modelId,
      input: normalized.prompt,
      stream: false,
      ...(normalized.size !== undefined && { size: normalized.size }),
      ...(normalized.seed !== undefined && { seed: normalized.seed }),
      ...(params.sequentialImageGeneration !== undefined && {
        sequential_image_generation: params.sequentialImageGeneration,
        ...(params.maxImages !== undefined && { sequential_image_generation_options: { max_images: params.maxImages } })
      }),
      ...(params.outputFormat !== undefined && { output_format: params.outputFormat }),
      ...(params.addWatermark !== undefined && { watermark: params.addWatermark })
    }
    const response = await postJsonToApi({
      url: `${this.baseURL}/v1/responses`,
      headers: this.requestHeaders(input.headers),
      body,
      abortSignal: input.signal,
      fetch: this.fetch,
      failedResponseHandler: createImageTransportErrorResponseHandler(),
      successfulResponseHandler: createJsonResponseHandler(dmxapiSeedreamResponseSchema)
    })
    return completedImageTransportSubmission(
      response.value.output.flatMap((entry) => entry.content.flatMap((part) => part.text)),
      'DMXAPI Seedream image'
    )
  }

  /** Responses API with DashScope-style `input.messages` (alibaba wan family). */
  private async submitResponsesMessages(
    input: ImageGenerationSubmitInput<DmxapiProviderParams>,
    normalized: NormalizedInput,
    params: DmxapiProviderParams
  ) {
    const content: Array<{ text: string } | { image: string }> = []
    if (normalized.prompt) content.push({ text: normalized.prompt })
    for (const file of input.files ?? []) content.push({ image: fileToDataUrl(file) })

    const parameters = {
      ...(normalized.size !== undefined && { size: normalized.size.replace(/x/i, '*') }),
      ...(normalized.n > 1 && { n: normalized.n }),
      ...(normalized.seed !== undefined && { seed: normalized.seed }),
      ...(params.negativePrompt !== undefined && { negative_prompt: params.negativePrompt }),
      ...(params.promptExtend !== undefined && { prompt_extend: params.promptExtend }),
      ...(params.addWatermark !== undefined && { watermark: params.addWatermark })
    }

    const body = {
      model: normalized.modelId,
      input: { messages: [{ role: 'user', content }] },
      ...(Object.keys(parameters).length > 0 && { parameters })
    }

    const response = await postJsonToApi({
      url: `${this.baseURL}/v1/responses`,
      headers: this.requestHeaders(input.headers),
      body,
      abortSignal: input.signal,
      fetch: this.fetch,
      failedResponseHandler: createImageTransportErrorResponseHandler(),
      successfulResponseHandler: createJsonResponseHandler(dmxapiWanResponseSchema)
    })
    return completedImageTransportSubmission(
      response.value.output.flatMap((entry) => entry.content.map((part) => part.text)),
      'DMXAPI Wan image'
    )
  }

  private requestHeaders(headers: ImageGenerationSubmitInput<DmxapiProviderParams>['headers']) {
    return combineImageTransportHeaders(
      {
        Accept: 'application/json',
        'User-Agent': 'DMXAPI/1.0.0 (https://www.dmxapi.com)',
        Authorization: `Bearer ${this.apiKey}`
      },
      this.headers,
      headers
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Response parsers (one per backend family)
// ──────────────────────────────────────────────────────────────────────────────

function parseDmxapiAsyncResults(data: z.infer<typeof dmxapiAsyncResultSchema>): string[] {
  return data.extra.output.results.map((result) => result.url)
}

export function createDmxapiTransport(settings: DmxapiTransportSettings): DmxapiTransport {
  return new DmxapiTransport(settings)
}

export type { DmxapiTransport }
