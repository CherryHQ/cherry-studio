import { createPaintingGenerateError } from '@renderer/aiCore/errors/paintingGenerateError'
import { readErrorMessage } from '@renderer/aiCore/errors/readErrorMessage'

import type { ImageGenerationSubmitInput, ImageGenerationTransport } from '../imageGenerationModel'
import { fileToDataUrl } from './transportUtils'

/**
 * DMXAPI transport — DMXAPI is a multi-backend gateway. Models route to:
 *   - OpenAI-flat `/v1/images/generations` (sync) for gpt-image / dall-e-3
 *   - OpenAI-flat (async, wrapped in `extra.output.results[].url`) for qwen-image
 *   - OpenAI multipart `/v1/images/edits` (legacy V2 edit/merge — except seededit-3.0)
 *   - Responses API `/v1/responses` (input as string OR DashScope-style messages)
 *     for doubao-seedream-5.0-lite and wan2.6-t2i
 *   - Google generateContent `/v1beta/models/{model}:generateContent` with the
 *     `x-goog-api-key` header (NOT Bearer) for gemini-3.1-flash-image-preview
 *
 * Dispatch is driven by `bagParams.modelDescriptor` (set by `paintingPipeline`
 * from the registry's `modes[mode].vendorTransport`); when no descriptor is
 * present the transport falls back to the legacy mode-based V1/V2 dispatch
 * preserved verbatim from the bespoke painting service (gpt-image-1
 * edit/merge, seededit-3.0, etc.).
 */

export const DEFAULT_DMXAPI_BASE_URL = 'https://www.dmxapi.com'

/** Edit/merge modes route to the V2 `/v1/images/edits` FormData endpoint. */
const EDIT_OR_MERGE_MODES = new Set(['edit', 'merge'])

interface NormalizedInput {
  modelId: string
  prompt: string
  n: number
  size: string | undefined
  seed: number | undefined
}

/**
 * DMXAPI painting fields forwarded through `providerOptions['dmxapi']`.
 * Mirrors the `DmxapiPaintingData` subset the legacy `prepare*Request`
 * consumed. `imageFiles` are the relocated `getDmxapiFileMap()` blobs (with
 * their original MIME type preserved so the V1 inline-base64 / V2 FormData
 * branches stay byte-identical to the bespoke service).
 */
export interface DmxapiTransportFile {
  mediaType: string
  data: Uint8Array
  name?: string
}

/**
 * Per-model descriptor injected by `paintingPipeline` from
 * `modes[mode].vendorTransport`. `endpoint` carries the path family the
 * transport dispatches on; `id` distinguishes between models inside the same
 * family (e.g. `input: "string"` vs `input: { messages }` under `/v1/responses`).
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
  mode?: string
  modelDescriptor?: DmxapiModelDescriptor
  extendParams?: Record<string, unknown>
  imageFiles?: DmxapiTransportFile[]
  /** doubao-seedream-5.0-lite multi-image options. */
  sequentialImageGeneration?: 'auto' | 'disabled'
  maxImages?: number
  outputFormat?: string
  webSearch?: boolean
  addWatermark?: boolean
  /** wan2.6-t2i extras (DashScope-passthrough). */
  promptExtend?: boolean
  /** gemini-3.1-flash-image-preview generationConfig. */
  aspectRatio?: string
  imageResolution?: string
  /** Snake-cased by `buildImageProviderOptions` default branch. */
  negative_prompt?: string
}

export interface DmxapiTransportSettings {
  apiKey: string
  baseURL?: string
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
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
    const params = input.providerParams as DmxapiProviderParams
    const descriptor = params.modelDescriptor
    const normalized: NormalizedInput = {
      modelId: input.modelId,
      prompt: input.prompt ?? '',
      n: input.n,
      size: input.size,
      seed: input.seed
    }

    if (descriptor) {
      return this.submitWithDescriptor(input, normalized, params, descriptor)
    }

    // Legacy path — no registry vendorTransport for this model; fall back to
    // the bespoke V1/V2 mode-based dispatch (gpt-image-1 edit, seededit-3.0).
    return this.submitLegacy(input, normalized, params)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Descriptor-driven dispatch (multi-backend gateway)
  // ──────────────────────────────────────────────────────────────────────────

  private async submitWithDescriptor(
    input: ImageGenerationSubmitInput,
    normalized: NormalizedInput,
    params: DmxapiProviderParams,
    descriptor: DmxapiModelDescriptor
  ): Promise<{ imageUrls?: string[]; taskId?: string }> {
    switch (descriptor.id) {
      case 'doubao-seedream-5.0-lite':
        return this.submitResponsesStringInput(input, normalized, params, descriptor)
      case 'wan2.6-t2i':
        return this.submitResponsesMessages(input, normalized, params, descriptor)
      case 'gemini-3.1-flash-image-preview':
        return this.submitGeminiGenerateContent(input, normalized, params, descriptor)
      case 'qwen-image':
        return this.submitAsyncOpenAIFlat(input, normalized, params, descriptor)
      default:
        // OpenAI-flat models (gpt-image-1.5, dall-e-3, gpt-image-1, …) are
        // routed by the provider factory to AI SDK's OpenAICompatibleImageModel
        // before they reach this transport; landing here means a registry
        // override declared a vendorTransport for an unsupported custom model.
        throw new Error(`Unsupported DMXAPI custom-backend model: ${descriptor.id}`)
    }
  }

  /** Async qwen-image via DMXAPI — same OpenAI-flat endpoint, response is
   *  wrapped in `extra.output.{task_status, results[].url}`. DMXAPI returns
   *  SUCCEEDED on the single call (gateway handles polling upstream). */
  private async submitAsyncOpenAIFlat(
    input: ImageGenerationSubmitInput,
    normalized: NormalizedInput,
    params: DmxapiProviderParams,
    descriptor: DmxapiModelDescriptor
  ): Promise<{ imageUrls?: string[] }> {
    const body: Record<string, unknown> = {
      model: normalized.modelId,
      prompt: normalized.prompt,
      n: normalized.n,
      // Pinned to 'url' because the async parser reads
      // `extra.output.results[].url` — b64 would land on a different field
      // and break extraction.
      response_format: 'url',
      ...params.extendParams
    }
    if (normalized.size) body.size = normalized.size

    const data = await this.requestJson(descriptor.endpoint, body, input.signal)
    return { imageUrls: parseDmxapiAsyncResults(data) }
  }

  /** Responses API with `input` as a prompt string (doubao-seedream-5.0-lite).
   *  Response carries markdown-encoded image URLs inside
   *  `output[0].content[0].text`. */
  private async submitResponsesStringInput(
    input: ImageGenerationSubmitInput,
    normalized: NormalizedInput,
    params: DmxapiProviderParams,
    descriptor: DmxapiModelDescriptor
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

    const data = await this.requestJson(descriptor.endpoint, body, input.signal)
    return { imageUrls: parseResponsesApiOutput(data) }
  }

  /** Responses API with DashScope-style `input.messages` (wan2.6-t2i). */
  private async submitResponsesMessages(
    input: ImageGenerationSubmitInput,
    normalized: NormalizedInput,
    params: DmxapiProviderParams,
    descriptor: DmxapiModelDescriptor
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

    const data = await this.requestJson(descriptor.endpoint, body, input.signal)
    return { imageUrls: parseResponsesApiOutput(data) }
  }

  /** Gemini-native generateContent. Endpoint path embeds `{modelId}`; auth
   *  header is `x-goog-api-key` (NOT `Authorization: Bearer`). */
  private async submitGeminiGenerateContent(
    input: ImageGenerationSubmitInput,
    normalized: NormalizedInput,
    params: DmxapiProviderParams,
    descriptor: DmxapiModelDescriptor
  ): Promise<{ imageUrls?: string[] }> {
    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = []
    if (normalized.prompt) parts.push({ text: normalized.prompt })
    for (const file of input.files ?? []) {
      const dataUrl = fileToDataUrl(file)
      const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl)
      if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } })
    }

    const imageConfig: Record<string, unknown> = {}
    if (params.aspectRatio) imageConfig.aspectRatio = params.aspectRatio
    if (params.imageResolution) imageConfig.imageSize = params.imageResolution

    const body: Record<string, unknown> = {
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        ...(Object.keys(imageConfig).length > 0 && { imageConfig })
      }
    }

    const endpoint = descriptor.endpoint.includes('{model}')
      ? descriptor.endpoint.replace('{model}', normalized.modelId)
      : `${descriptor.endpoint}/${normalized.modelId}:generateContent`

    const data = await this.requestJson(endpoint, body, input.signal, {
      authHeader: 'x-goog-api-key',
      authValue: this.apiKey
    })
    return { imageUrls: parseGeminiInlineData(data) }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Legacy V1/V2 mode-based dispatch (preserved for gpt-image-1 edit/merge etc.)
  // ──────────────────────────────────────────────────────────────────────────

  private prepareV1Request(input: NormalizedInput, params: DmxapiProviderParams) {
    const body: Record<string, any> = {
      prompt: input.prompt,
      model: input.modelId,
      n: input.n,
      ...params.extendParams
    }

    if (input.size) body.size = input.size
    if (input.seed !== undefined) {
      body.seed = Number.isFinite(input.seed) && input.seed >= -1 ? input.seed : -1
    }

    const files = params.imageFiles ?? []
    if (files.length > 0) {
      const file = files[0]
      body.image = `data:${file.mediaType || 'application/octet-stream'};base64,${uint8ToBase64(file.data)}`
    }

    return {
      body: JSON.stringify(body),
      headerExpand: { 'Content-Type': 'application/json' } as Record<string, string>,
      endpoint: `${this.baseURL}/v1/images/generations`
    }
  }

  private prepareV2Request(input: NormalizedInput, params: DmxapiProviderParams) {
    const body: Record<string, any> = {
      prompt: input.prompt,
      n: input.n,
      model: input.modelId,
      ...params.extendParams
    }

    if (input.size) body.size = input.size

    const formData = new FormData()
    for (const key in body) {
      formData.append(key, body[key])
    }

    const files = params.imageFiles ?? []
    files.forEach((file) => {
      const blob = new Blob([file.data as BlobPart], { type: file.mediaType || 'application/octet-stream' })
      formData.append('image', blob, file.name)
    })

    return {
      body: formData as unknown as BodyInit,
      headerExpand: undefined,
      endpoint: `${this.baseURL}/v1/images/edits`
    }
  }

  private async submitLegacy(
    input: ImageGenerationSubmitInput,
    normalized: NormalizedInput,
    params: DmxapiProviderParams
  ): Promise<{ imageUrls?: string[] }> {
    const isEditOrMerge = EDIT_OR_MERGE_MODES.has(params.mode ?? '')
    const config =
      isEditOrMerge && normalized.modelId !== 'seededit-3.0'
        ? this.prepareV2Request(normalized, params)
        : this.prepareV1Request(normalized, params)

    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      'User-Agent': 'DMXAPI/1.0.0 (https://www.dmxapi.com)',
      ...config.headerExpand
    }

    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers,
      body: config.body,
      signal: input.signal
    })

    if (!response.ok) {
      if (response.status === 401) throw createPaintingGenerateError('REQ_ERROR_TOKEN')
      if (response.status === 403) throw createPaintingGenerateError('REQ_ERROR_NO_BALANCE')
      const message = await readErrorMessage(response, 'paintings.generate_failed')
      throw createPaintingGenerateError('REMOTE_ERROR', { message })
    }

    const data = await response.json()
    return { imageUrls: parseOpenAIImageList(data) }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Shared HTTP helper
  // ──────────────────────────────────────────────────────────────────────────

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

function parseOpenAIImageList(data: unknown): string[] {
  const items = (data as { data?: Array<{ url?: string; b64_json?: string }> })?.data ?? []
  return items
    .map((item) => {
      if (item.b64_json) return `data:image/png;base64,${item.b64_json}`
      if (item.url) return item.url
      return ''
    })
    .filter((url) => url.length > 0)
}

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

function parseGeminiInlineData(data: unknown): string[] {
  const candidates = (
    data as {
      candidates?: Array<{
        content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> }
      }>
    }
  )?.candidates
  if (!Array.isArray(candidates)) return []
  const urls: string[] = []
  for (const candidate of candidates) {
    for (const part of candidate.content?.parts ?? []) {
      const inline = part.inlineData
      if (inline?.data) urls.push(`data:${inline.mimeType || 'image/png'};base64,${inline.data}`)
    }
  }
  return urls
}

export function createDmxapiTransport(settings: DmxapiTransportSettings): DmxapiTransport {
  return new DmxapiTransport(settings)
}

export type { DmxapiTransport }
