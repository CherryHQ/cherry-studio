import { DEFAULT_TIMEOUT } from '@shared/config/constant'

import type { ImageGenerationSubmitInput, ImageGenerationTransport } from '../imageGenerationModel'
import { createAbortError, fileToDataUrl, isTerminalHttpStatus, waitWithSignal } from '../transportUtils'

/**
 * Aliyun DashScope (Bailian) async image-generation transport.
 *
 * Models served via DashScope's native `/api/v1/services/aigc/*` HTTP API:
 *   - text2image/image-synthesis (qwen-image / wanx t2i family — Family C)
 *   - multimodal-generation/generation (z-image / qwen-image-edit — Family A, sync)
 *   - image-generation/generation (wan v2 chat-shape async — Family B)
 *   - image2image/image-synthesis (wan2.5 i2i, qwen-mt-image, wanx imageedit — Family D)
 *
 * `modes[mode].vendorTransport.{endpoint,isSync}` carries the per-model routing
 * hint; the transport branches body shape by `descriptor.id` (per-model dispatch
 * mirrors `ppio.ts`). Async submits set `X-DashScope-Async: enable` and return
 * `{ taskId }`; the shared poll loop GETs `/api/v1/tasks/{taskId}` and extracts
 * image URLs from a family-specific response shape recorded at submit time.
 *
 * DashScope has no public task-cancel endpoint — on abort we stop polling; the
 * server-side task continues but its result is discarded.
 */

export const DEFAULT_DASHSCOPE_IMAGE_BASE_URL = 'https://dashscope.aliyuncs.com'

export class DashScopeApiError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message)
    this.name = 'DashScopeApiError'
  }
}

export class DashScopeTaskFailedError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'DashScopeTaskFailedError'
  }
}

export type DashScopeTaskStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'UNKNOWN'

interface DashScopeTaskOutput {
  task_id?: string
  task_status: DashScopeTaskStatus
  message?: string
  code?: string
  results?: Array<{ url?: string; image_url?: string }>
  choices?: Array<{ message?: { content?: Array<{ image?: string; text?: string }> } }>
  image_url?: string
}

export interface DashScopeTaskResult {
  output: DashScopeTaskOutput
  request_id?: string
  usage?: Record<string, unknown>
}

/**
 * Per-model descriptor injected by `paintingPipeline.ts` from the registry's
 * `modes[mode].vendorTransport`. `id` is the wire model id; `endpoint` is the
 * full path under `imageBaseURL`. `isSync` toggles the `X-DashScope-Async`
 * header and the sync-vs-task-polling control flow.
 */
export interface DashScopeModelDescriptor {
  id: string
  endpoint: string
  isSync?: boolean
  mode?: string
}

export interface DashScopeProviderParams {
  model?: string
  modelDescriptor?: DashScopeModelDescriptor
  /** Coerced to number by `buildImageProviderOptions` dashscope branch. */
  seed?: number
  /** Snake-cased by `buildImageProviderOptions` dashscope branch. */
  negative_prompt?: string
  /** Routed through `buildImageProviderOptions` dashscope branch (wanx-v1). */
  style?: string
  promptExtend?: boolean
  addWatermark?: boolean
  thinkingMode?: boolean
  /** wan2.6-image mode toggle: true = text+image mixed output (default for
   *  Cherry's generate tab — no input image required); false = edit mode
   *  (1–4 input images required). Maps to `parameters.enable_interleave`. */
  enableInterleave?: boolean
  /** wan v2 1K / 2K / 4K resolution enum — maps to `parameters.size`. */
  imageResolution?: string
  /** wanx-v1 reference-image controls. */
  refStrength?: number
  refMode?: string
  /** qwen-mt-image (Family D2) translation directions. */
  sourceLang?: string
  targetLang?: string
  /** wanx2.1-imageedit (Family D3) function-driven edit controls. */
  function?: string
  strength?: number
  upscaleFactor?: number
  topScale?: number
  bottomScale?: number
  leftScale?: number
  rightScale?: number
  isSketch?: boolean
  onSubmitTaskId?: (taskId: string) => void
}

export interface DashScopeTransportSettings {
  apiKey: string
  imageBaseURL?: string
}

type ResponseFamily = 'choices' | 'results' | 'image_url'

function responseFamilyFor(descriptor: DashScopeModelDescriptor): ResponseFamily {
  const path = descriptor.endpoint
  if (path.endsWith('/image-generation/generation') || path.endsWith('/multimodal-generation/generation')) {
    return 'choices'
  }
  if (descriptor.id === 'qwen-mt-image') {
    return 'image_url'
  }
  return 'results'
}

function extractImageUrls(output: DashScopeTaskOutput, family: ResponseFamily): string[] {
  switch (family) {
    case 'choices':
      return (output.choices ?? [])
        .flatMap((choice) => choice.message?.content ?? [])
        .map((part) => part.image)
        .filter((url): url is string => typeof url === 'string' && url.length > 0)
    case 'results':
      return (output.results ?? [])
        .map((entry) => entry.url ?? entry.image_url)
        .filter((url): url is string => typeof url === 'string' && url.length > 0)
    case 'image_url':
      return output.image_url ? [output.image_url] : []
  }
}

/**
 * DashScope's `parameters.size` uses `WIDTH*HEIGHT`; the painting UI canonical
 * form is `WIDTHxHEIGHT`. Returns `undefined` for the `'auto'` sentinel and
 * empty / mismatched input so callers can omit the field entirely.
 */
function toDashScopeSize(size: ImageGenerationSubmitInput['size']): string | undefined {
  if (!size) return undefined
  const value = String(size)
  if (value === 'auto') return undefined
  if (/^\d+\*\d+$/.test(value)) return value
  if (/^\d+x\d+$/i.test(value)) return value.replace(/x/i, '*')
  return undefined
}

/**
 * Resolve `parameters.size` — wan v2 accepts `'1K'|'2K'|'4K'` via the
 * `imageResolution` registry enum; everything else uses `WIDTH*HEIGHT`
 * converted from the canonical `WIDTHxHEIGHT` form.
 */
function resolveSizeParameter(input: ImageGenerationSubmitInput, bag: DashScopeProviderParams): string | undefined {
  if (typeof bag.imageResolution === 'string' && bag.imageResolution) {
    return bag.imageResolution
  }
  return toDashScopeSize(input.size)
}

/**
 * Family C — flat `input.prompt` body for text2image/image-synthesis
 * (qwen-image / qwen-image-plus / wanx2.x-t2i-* / wanx-v1).
 */
function buildText2ImageBody(input: ImageGenerationSubmitInput, bag: DashScopeProviderParams): Record<string, unknown> {
  const inputBlock: Record<string, unknown> = {}
  if (input.prompt) inputBlock.prompt = input.prompt
  if (bag.negative_prompt) inputBlock.negative_prompt = bag.negative_prompt

  const parameters: Record<string, unknown> = {}
  const sizeWire = resolveSizeParameter(input, bag)
  if (sizeWire) parameters.size = sizeWire
  if (input.n && input.n > 1) parameters.n = input.n
  if (typeof bag.seed === 'number') parameters.seed = bag.seed
  if (bag.promptExtend !== undefined) parameters.prompt_extend = bag.promptExtend
  if (bag.addWatermark !== undefined) parameters.watermark = bag.addWatermark

  return {
    model: input.modelId,
    input: inputBlock,
    ...(Object.keys(parameters).length > 0 && { parameters })
  }
}

/**
 * Families A & B — chat-message body for multimodal-generation (sync) and
 * image-generation/generation (async). Both share the `messages[].content[]`
 * shape; sync vs async is decided by `descriptor.isSync` upstream.
 *
 * Image attachments (qwen-image-edit / wan2.x edit input) flow through
 * `input.files` (AI SDK normalizes attached painting files via
 * `prompt: { text, images }` → `options.files`). DashScope accepts both
 * `https?:` URLs and `data:` base64 URLs in `content[].image`.
 */
function buildChatLikeBody(input: ImageGenerationSubmitInput, bag: DashScopeProviderParams): Record<string, unknown> {
  const content: Array<{ text?: string; image?: string }> = []
  if (input.prompt) content.push({ text: input.prompt })
  for (const file of input.files ?? []) content.push({ image: fileToDataUrl(file) })

  const parameters: Record<string, unknown> = {}
  const sizeWire = resolveSizeParameter(input, bag)
  if (sizeWire) parameters.size = sizeWire
  if (input.n && input.n > 1) parameters.n = input.n
  if (typeof bag.seed === 'number') parameters.seed = bag.seed
  if (bag.negative_prompt) parameters.negative_prompt = bag.negative_prompt
  if (bag.promptExtend !== undefined) parameters.prompt_extend = bag.promptExtend
  if (bag.thinkingMode !== undefined) parameters.thinking_mode = bag.thinkingMode
  if (bag.enableInterleave !== undefined) parameters.enable_interleave = bag.enableInterleave
  if (bag.addWatermark !== undefined) parameters.watermark = bag.addWatermark

  return {
    model: input.modelId,
    input: { messages: [{ role: 'user', content }] },
    ...(Object.keys(parameters).length > 0 && { parameters })
  }
}

/**
 * wanx-v1 extends Family C with optional reference-image controls. When the
 * user attaches an image, it goes on `input.ref_image`; `style` /
 * `ref_strength` / `ref_mode` live on `parameters.*`.
 */
function buildWanxV1Body(input: ImageGenerationSubmitInput, bag: DashScopeProviderParams): Record<string, unknown> {
  const inputBlock: Record<string, unknown> = {}
  if (input.prompt) inputBlock.prompt = input.prompt
  if (bag.negative_prompt) inputBlock.negative_prompt = bag.negative_prompt
  const refFile = input.files?.[0]
  if (refFile) inputBlock.ref_image = fileToDataUrl(refFile)

  const parameters: Record<string, unknown> = {}
  const sizeWire = resolveSizeParameter(input, bag)
  if (sizeWire) parameters.size = sizeWire
  if (input.n && input.n > 1) parameters.n = input.n
  if (typeof bag.seed === 'number') parameters.seed = bag.seed
  if (bag.style) parameters.style = bag.style
  if (typeof bag.refStrength === 'number') parameters.ref_strength = bag.refStrength
  if (bag.refMode) parameters.ref_mode = bag.refMode

  return {
    model: input.modelId,
    input: inputBlock,
    ...(Object.keys(parameters).length > 0 && { parameters })
  }
}

/**
 * Family D1 — wan2.5-i2i-preview's image2image body. `input.images` is an
 * array (up to 3 per docs); the canonical `input.files` carries them.
 */
function buildWan25I2IBody(input: ImageGenerationSubmitInput, bag: DashScopeProviderParams): Record<string, unknown> {
  const inputBlock: Record<string, unknown> = {}
  if (input.prompt) inputBlock.prompt = input.prompt
  if (bag.negative_prompt) inputBlock.negative_prompt = bag.negative_prompt
  if (input.files && input.files.length > 0) {
    inputBlock.images = input.files.map((f) => fileToDataUrl(f))
  }

  const parameters: Record<string, unknown> = {}
  const sizeWire = resolveSizeParameter(input, bag)
  if (sizeWire) parameters.size = sizeWire
  if (input.n && input.n > 1) parameters.n = input.n
  if (typeof bag.seed === 'number') parameters.seed = bag.seed
  if (bag.promptExtend !== undefined) parameters.prompt_extend = bag.promptExtend
  if (bag.addWatermark !== undefined) parameters.watermark = bag.addWatermark

  return {
    model: input.modelId,
    input: inputBlock,
    ...(Object.keys(parameters).length > 0 && { parameters })
  }
}

/**
 * Family D2 — qwen-mt-image translates text rendered in an input image. No
 * prompt; `input.image_url` + `source_lang` + `target_lang` are the only
 * required fields (pipeline must thread `requirePrompt: false`).
 */
function buildQwenMtImageBody(
  input: ImageGenerationSubmitInput,
  bag: DashScopeProviderParams
): Record<string, unknown> {
  const inputBlock: Record<string, unknown> = {}
  const firstFile = input.files?.[0]
  if (firstFile) inputBlock.image_url = fileToDataUrl(firstFile)
  if (bag.sourceLang) inputBlock.source_lang = bag.sourceLang
  if (bag.targetLang) inputBlock.target_lang = bag.targetLang
  return { model: input.modelId, input: inputBlock }
}

/**
 * Family D3 — wanx2.1-imageedit's multi-function image editor. The chosen
 * `function` (stylization_all / super_resolution / expand / doodle / ...)
 * picks which `parameters.*` entries DashScope honors; we emit every
 * function-specific param that's set on the bag and let DashScope ignore
 * the irrelevant ones per its documented behavior.
 */
function buildWanxImageEditBody(
  input: ImageGenerationSubmitInput,
  bag: DashScopeProviderParams
): Record<string, unknown> {
  const inputBlock: Record<string, unknown> = {}
  if (bag.function) inputBlock.function = bag.function
  if (input.prompt) inputBlock.prompt = input.prompt
  const baseFile = input.files?.[0]
  if (baseFile) inputBlock.base_image_url = fileToDataUrl(baseFile)
  if (input.mask) inputBlock.mask_image_url = fileToDataUrl(input.mask)

  const parameters: Record<string, unknown> = {}
  if (input.n && input.n > 1) parameters.n = input.n
  if (typeof bag.seed === 'number') parameters.seed = bag.seed
  if (bag.addWatermark !== undefined) parameters.watermark = bag.addWatermark
  if (typeof bag.strength === 'number') parameters.strength = bag.strength
  if (typeof bag.upscaleFactor === 'number') parameters.upscale_factor = bag.upscaleFactor
  if (typeof bag.topScale === 'number') parameters.top_scale = bag.topScale
  if (typeof bag.bottomScale === 'number') parameters.bottom_scale = bag.bottomScale
  if (typeof bag.leftScale === 'number') parameters.left_scale = bag.leftScale
  if (typeof bag.rightScale === 'number') parameters.right_scale = bag.rightScale
  if (bag.isSketch !== undefined) parameters.is_sketch = bag.isSketch

  return {
    model: input.modelId,
    input: inputBlock,
    ...(Object.keys(parameters).length > 0 && { parameters })
  }
}

function buildRequestBody(
  input: ImageGenerationSubmitInput,
  descriptor: DashScopeModelDescriptor
): Record<string, unknown> {
  const bag = (input.providerParams ?? {}) as DashScopeProviderParams
  switch (descriptor.id) {
    case 'z-image-turbo':
    case 'qwen-image-edit':
    case 'qwen-image-edit-plus':
    case 'wan2.6-image':
    case 'wan2.7-image':
    case 'wan2.7-image-pro':
      return buildChatLikeBody(input, bag)
    case 'qwen-image':
    case 'qwen-image-plus':
    case 'wanx2.1-t2i-turbo':
    case 'wanx2.1-t2i-plus':
    case 'wanx2.0-t2i-turbo':
      return buildText2ImageBody(input, bag)
    case 'wanx-v1':
      return buildWanxV1Body(input, bag)
    case 'wan2.5-i2i-preview':
      return buildWan25I2IBody(input, bag)
    case 'qwen-mt-image':
      return buildQwenMtImageBody(input, bag)
    case 'wanx2.1-imageedit':
      return buildWanxImageEditBody(input, bag)
    default:
      throw new Error(`Unsupported DashScope image model: ${descriptor.id}`)
  }
}

class DashScopeTransport implements ImageGenerationTransport {
  private apiKey: string
  private baseURL: string
  private pendingDescriptors = new Map<string, DashScopeModelDescriptor>()

  constructor(settings: DashScopeTransportSettings) {
    this.apiKey = settings.apiKey
    this.baseURL = settings.imageBaseURL || DEFAULT_DASHSCOPE_IMAGE_BASE_URL
  }

  async submit(input: ImageGenerationSubmitInput): Promise<{ taskId?: string; imageUrls?: string[] }> {
    const bag = (input.providerParams ?? {}) as DashScopeProviderParams
    const descriptor = bag.modelDescriptor
    if (!descriptor) {
      throw new Error(`Missing modelDescriptor for DashScope model: ${bag.model ?? input.modelId}`)
    }

    const body = buildRequestBody(input, descriptor)
    const extraHeaders: Record<string, string> = descriptor.isSync ? {} : { 'X-DashScope-Async': 'enable' }

    const response = await this.request<DashScopeTaskResult>(descriptor.endpoint, 'POST', body, {
      timeout: 120000,
      signal: input.signal,
      extraHeaders
    })

    if (descriptor.isSync) {
      return { imageUrls: extractImageUrls(response.output, responseFamilyFor(descriptor)) }
    }

    const taskId = response.output.task_id
    if (!taskId) {
      throw new DashScopeApiError('DashScope async submit returned no task_id', 0)
    }
    this.pendingDescriptors.set(taskId, descriptor)
    bag.onSubmitTaskId?.(taskId)
    return { taskId }
  }

  async poll(
    taskId: string,
    options: { signal?: AbortSignal; onProgress?: (progress: number) => void }
  ): Promise<string[]> {
    const descriptor = this.pendingDescriptors.get(taskId)
    try {
      const result = await this.pollTaskResult(taskId, options)
      const family = descriptor ? responseFamilyFor(descriptor) : 'results'
      return extractImageUrls(result.output, family)
    } finally {
      this.pendingDescriptors.delete(taskId)
    }
  }

  /**
   * DashScope has no public task-cancel endpoint, so cancellation is local
   * only: drop the pending descriptor. The image-model adapter invokes this on
   * abort, including the abort-after-submit-before-poll window where `poll()`'s
   * `finally` never runs — without it that descriptor would leak for the
   * lifetime of the (reused) transport.
   */
  async cancel(taskId: string): Promise<void> {
    this.pendingDescriptors.delete(taskId)
  }

  private async pollTaskResult(
    taskId: string,
    options: {
      interval?: number
      maxAttempts?: number
      onProgress?: (progress: number) => void
      signal?: AbortSignal
    }
  ): Promise<DashScopeTaskResult> {
    const { interval, maxAttempts = 120, signal } = options
    const maxTransientRetries = 10
    let attempts = 0
    let transientRetries = 0
    const startTime = Date.now()

    while (attempts < maxAttempts) {
      if (signal?.aborted) throw createAbortError('Task polling aborted')

      try {
        const result = await this.request<DashScopeTaskResult>(
          `/api/v1/tasks/${encodeURIComponent(taskId)}`,
          'GET',
          undefined,
          { timeout: 10000, signal }
        )
        transientRetries = 0
        const status = result.output.task_status
        if (status === 'SUCCEEDED') return result
        if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
          throw new DashScopeTaskFailedError(result.output.message || `DashScope task ${status.toLowerCase()}`)
        }
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
          throw createAbortError('Task polling aborted')
        }
        // A terminal vendor failure or a 4xx (bar 429) poll response ends the
        // loop; 5xx / 429 fall through to transient retry.
        if (error instanceof DashScopeTaskFailedError) throw error
        if (error instanceof DashScopeApiError && isTerminalHttpStatus(error.statusCode)) throw error

        transientRetries++
        if (transientRetries >= maxTransientRetries) {
          throw error instanceof Error ? error : new Error(String(error))
        }
        const elapsedTime = Date.now() - startTime
        const pollDelay = interval ?? (elapsedTime < 60000 ? 3000 : 10000)
        await waitWithSignal(pollDelay, signal)
        continue
      }

      const elapsedTime = Date.now() - startTime
      const pollDelay = interval ?? (elapsedTime < 60000 ? 3000 : 10000)
      await waitWithSignal(pollDelay, signal)
      attempts++
    }

    throw new Error('Task polling timeout')
  }

  private async request<T>(
    path: string,
    method: 'POST' | 'GET',
    body: Record<string, unknown> | undefined,
    options: { timeout?: number; signal?: AbortSignal; extraHeaders?: Record<string, string> }
  ): Promise<T> {
    const timeout = options.timeout ?? DEFAULT_TIMEOUT
    const externalSignal = options.signal
    const controller = new AbortController()
    let externallyAborted = false

    const timeoutId = setTimeout(() => controller.abort(), timeout)
    const onExternalAbort = () => {
      externallyAborted = true
      controller.abort()
    }
    if (externalSignal?.aborted) {
      externallyAborted = true
      controller.abort()
    } else {
      externalSignal?.addEventListener('abort', onExternalAbort, { once: true })
    }

    const fetchOptions: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(method === 'POST' && { 'Content-Type': 'application/json' }),
        ...options.extraHeaders
      },
      signal: controller.signal
    }
    if (method === 'POST' && body !== undefined) {
      fetchOptions.body = JSON.stringify(body)
    }

    try {
      const response = await fetch(`${this.baseURL}${path}`, fetchOptions)
      if (!response.ok) {
        const errorText = (await response.text().catch(() => '')).slice(0, 500)
        throw new DashScopeApiError(`DashScope API error: ${response.status} - ${errorText}`, response.status)
      }
      return (await response.json()) as T
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        if (externallyAborted) throw createAbortError('DashScope API request aborted')
        throw new Error(`DashScope API request timeout after ${timeout / 1000}s`)
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
      externalSignal?.removeEventListener('abort', onExternalAbort)
    }
  }
}

export function createDashScopeTransport(settings: DashScopeTransportSettings): DashScopeTransport {
  return new DashScopeTransport(settings)
}

export type { DashScopeTransport }
