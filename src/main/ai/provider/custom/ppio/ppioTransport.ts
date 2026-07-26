import type { ParamValues } from '@cherrystudio/provider-registry'
import { DEFAULT_TIMEOUT } from '@main/ai/constants'

import type {
  ImageGenerationSubmitInput,
  ImageGenerationTransport,
  ImageTransportInputSupport
} from '../imageGenerationModel'
import { createAbortError, fileToDataUrl, isTerminalHttpStatus, waitWithSignal } from '../transportUtils'

/**
 * PPIO submit/poll transport.
 *
 * Ported from the legacy painting service
 * (`src/renderer/src/pages/paintings/providers/ppio/service.ts`):
 * same API host, adaptive 3s(<60s)/10s poll interval, `maxAttempts` 120,
 * `maxTransientRetries` 10, `TASK_STATUS_*` machine, per-model param builders
 * and the synchronous (`isSync`) path.
 */

export const DEFAULT_PPIO_BASE_URL = 'https://api.ppio.com'

/** Models whose body has an `image` slot — mirrors the `buildRequestParams` switch.
 *  `transportInputSupport.test.ts` drives both and fails if they disagree. */
const QWEN_EDIT_MODELS = new Set(['qwen-image-edit', 'qwen-image-edit-2509'])
/** Seedream reads a reference image only on the `edit` branch of its mode ternary. */
const SEEDREAM_MODELS = new Set(['seedream-5.0-lite', 'seedream-4.5', 'seedream-4.0'])

export class PpioApiError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message)
    this.name = 'PpioApiError'
  }
}

/**
 * Terminal failure from the PPIO task lifecycle (status === TASK_STATUS_FAILED).
 * Carries the vendor's `task.reason` verbatim — replaces the prior pattern of
 * `new Error(reason ?? 'Task failed')` + `error.message.includes('Task failed')`
 * substring matching, which misclassified non-empty reasons ("Insufficient
 * credits", "NSFW detected") as transient and silently retried them 10 times.
 */
export class PpioTaskFailedError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'PpioTaskFailedError'
  }
}

export type PpioTaskStatus =
  | 'TASK_STATUS_QUEUED'
  | 'TASK_STATUS_PROCESSING'
  | 'TASK_STATUS_SUCCEED'
  | 'TASK_STATUS_FAILED'

export interface PpioTaskResult {
  task: {
    task_id: string
    status: PpioTaskStatus
    task_type: string
    reason?: string
    eta?: number
    progress_percent?: number
  }
  images?: Array<{
    image_url: string
    image_url_ttl: string
    image_type: string
  }>
  extra?: {
    seed?: string
    has_nsfw_contents?: boolean[]
  }
}

export interface PpioSyncResult {
  images?: Array<string | { image_url?: string; url?: string }>
}

/**
 * PPIO model descriptor needed by the transport: which endpoint to POST to
 * and whether the model responds synchronously with finished images.
 * `mode` is the canonical PaintingMode ('draw' / 'edit' / 'generate' …);
 * `buildSeedreamParams` branches on `mode === 'edit'`.
 */
export interface PpioModelDescriptor {
  id: string
  endpoint: string
  isSync?: boolean
  mode?: string
}

/**
 * The vendor bag as this transport reads it, forwarded through `providerOptions.ppio`.
 *
 * Derived from {@link ParamValues} rather than hand-declared, so every canonical field
 * is CHECKED to be a catalog key: the bag arrives straight from `splitParamValues`, and
 * the `ai.generate_image` IPC boundary strips anything `IMAGE_PARAM_CATALOG` doesn't
 * know. A non-canonical name here is not a rename — it is a field that can never
 * arrive, which is what `usePreLlm` was (jimeng's declared prompt-enhancement switch
 * silently did nothing). Anything genuinely not a catalog key — a vendor wire name, a
 * callback — goes in the intersection below, where it is deliberate and visible.
 */
export type PpioProviderParams = Pick<ParamValues, 'size' | 'promptEnhancement' | 'addWatermark' | 'outputFormat'> & {
  /** PPIO's own wire name for the seed; `input.seed` is merged into it at submit. */
  ppioSeed?: number
  /** SDK-path (chat) progress callback; the job path reports via `ctx.reportProgress`. */
  onProgress?: (progress: number) => void
}

export interface PpioTransportSettings {
  apiKey: string
  baseURL?: string
}

class PpioTransport implements ImageGenerationTransport {
  private apiKey: string
  private baseURL: string

  constructor(settings: PpioTransportSettings) {
    this.apiKey = settings.apiKey
    this.baseURL = settings.baseURL || DEFAULT_PPIO_BASE_URL
  }

  private async request<T>(
    endpoint: string,
    body: Record<string, unknown>,
    method: 'POST' | 'GET' = 'POST',
    requestOptions?: { timeout?: number; signal?: AbortSignal }
  ): Promise<T> {
    const timeout = requestOptions?.timeout ?? DEFAULT_TIMEOUT
    const externalSignal = requestOptions?.signal
    const url = `${this.baseURL}${endpoint}`
    const controller = new AbortController()
    let externallyAborted = false

    const timeoutId = setTimeout(() => {
      controller.abort()
    }, timeout)

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
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      signal: controller.signal
    }

    if (method === 'POST') {
      fetchOptions.body = JSON.stringify(body)
    }

    try {
      const response = await fetch(url, fetchOptions)

      if (!response.ok) {
        const errorText = (await response.text().catch(() => '')).slice(0, 500)
        throw new PpioApiError(`PPIO API error: ${response.status} - ${errorText}`, response.status)
      }

      const data = await response.json()
      return data as T
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        if (externallyAborted) {
          throw createAbortError('PPIO API request aborted')
        }

        throw new Error(`PPIO API request timeout after ${timeout / 1000}s`)
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
      externalSignal?.removeEventListener('abort', onExternalAbort)
    }
  }

  async submit(input: ImageGenerationSubmitInput): Promise<{ taskId?: string; imageUrls?: string[] }> {
    const bagParams = input.providerParams as PpioProviderParams
    const descriptor = input.modelDescriptor
    if (!descriptor) {
      throw new Error(`Unknown model: ${input.modelId}`)
    }

    // Native AI SDK fields (size / seed) land on `input.*` post-canonicalGenerate
    // partition, not in the providerOptions bag. Merge them into a unified
    // view so the per-model builders below can read uniformly. `ppioSeed`
    // remains PPIO's bespoke wire field name; if the bag carries one
    // explicitly we keep it, otherwise fall back to `input.seed`.
    const params: PpioProviderParams = {
      ...bagParams,
      size: bagParams.size ?? input.size,
      ppioSeed: bagParams.ppioSeed ?? input.seed
    }

    const requestParams = this.buildRequestParams(input, params, descriptor)

    if (descriptor.isSync) {
      const result = await this.request<PpioSyncResult>(descriptor.endpoint, requestParams, 'POST', {
        signal: input.signal
      })
      return { imageUrls: this.extractSyncImageUrls(result) }
    }

    const result = await this.request<{ task_id: string }>(descriptor.endpoint, requestParams, 'POST', {
      timeout: 120000,
      signal: input.signal
    })
    return { taskId: result.task_id }
  }

  /**
   * Mirrors the `buildRequestParams` switch below: only the Qwen edit models and the
   * Seedream family *in edit mode* have an `image` slot. Everything else drops an
   * attached reference image, and PPIO has no mask slot at all.
   */
  supportsInput(input: ImageGenerationSubmitInput): ImageTransportInputSupport {
    const modelId = input.modelDescriptor?.id ?? input.modelId
    const files =
      QWEN_EDIT_MODELS.has(modelId) || (SEEDREAM_MODELS.has(modelId) && input.modelDescriptor?.mode === 'edit')
    return { files, mask: false }
  }

  private buildRequestParams(
    input: ImageGenerationSubmitInput,
    painting: PpioProviderParams,
    descriptor: PpioModelDescriptor
  ): Record<string, unknown> {
    const modelId = descriptor.id
    const params: Record<string, unknown> = {}

    if (input.prompt) {
      params.prompt = input.prompt
    }

    switch (modelId) {
      case 'jimeng-txt2img-v3.1':
      case 'jimeng-txt2img-v3.0':
        return this.buildJimengParams(input, painting)
      case 'hunyuan-image-3':
        return this.buildHunyuanParams(input, painting)
      case 'qwen-image-txt2img':
        return this.buildQwenTxt2ImgParams(input, painting)
      case 'qwen-image-edit':
      case 'qwen-image-edit-2509':
        return this.buildQwenEditParams(input, painting)
      case 'glm-image':
        return this.buildGlmParams(input, painting)
      case 'z-image-turbo':
        return this.buildZImageParams(input, painting)
      case 'z-image-turbo-lora':
        return this.buildZImageLoraParams(input, painting)
      case 'seedream-5.0-lite':
      case 'seedream-4.5':
      case 'seedream-4.0':
        return descriptor.mode === 'edit'
          ? this.buildSeedreamEditParams(input, painting, modelId)
          : this.buildSeedreamDrawParams(input, painting)
      default:
        return params
    }
  }

  private buildJimengParams(input: ImageGenerationSubmitInput, painting: PpioProviderParams): Record<string, unknown> {
    const params: Record<string, unknown> = {
      prompt: input.prompt,
      use_pre_llm: painting.promptEnhancement ?? true,
      seed: painting.ppioSeed ?? -1
    }

    if (painting.size) {
      const [width, height] = painting.size.split('x').map(Number)
      if (width && height) {
        params.width = width
        params.height = height
      }
    }

    if (painting.addWatermark) {
      params.logo_info = {
        add_logo: true
      }
    }

    return params
  }

  private buildHunyuanParams(input: ImageGenerationSubmitInput, painting: PpioProviderParams): Record<string, unknown> {
    return {
      prompt: input.prompt,
      size: painting.size?.replace('x', '*') || '1024*1024',
      seed: painting.ppioSeed ?? -1,
      watermark: painting.addWatermark ?? false
    }
  }

  private buildQwenTxt2ImgParams(
    input: ImageGenerationSubmitInput,
    painting: PpioProviderParams
  ): Record<string, unknown> {
    return {
      prompt: input.prompt,
      size: painting.size?.replace('x', '*') || '1024*1024',
      watermark: painting.addWatermark ?? false
    }
  }

  private buildQwenEditParams(
    input: ImageGenerationSubmitInput,
    painting: PpioProviderParams
  ): Record<string, unknown> {
    const firstFile = input.files?.[0]
    return {
      prompt: input.prompt,
      image: firstFile ? fileToDataUrl(firstFile) : undefined,
      seed: painting.ppioSeed ?? -1,
      output_format: painting.outputFormat || 'jpeg',
      watermark: painting.addWatermark ?? false
    }
  }

  private buildGlmParams(input: ImageGenerationSubmitInput, painting: PpioProviderParams): Record<string, unknown> {
    return {
      prompt: input.prompt,
      size: painting.size || '1280x1280',
      quality: 'hd',
      watermark_enabled: painting.addWatermark ?? true
    }
  }

  private buildZImageParams(input: ImageGenerationSubmitInput, painting: PpioProviderParams): Record<string, unknown> {
    return {
      prompt: input.prompt,
      size: painting.size?.replace('x', '*') || '1024*1024',
      seed: painting.ppioSeed ?? -1
    }
  }

  private buildZImageLoraParams(
    input: ImageGenerationSubmitInput,
    painting: PpioProviderParams
  ): Record<string, unknown> {
    return {
      prompt: input.prompt,
      size: painting.size?.replace('x', '*') || '1024*1024',
      seed: painting.ppioSeed ?? -1,
      loras: []
    }
  }

  private buildSeedreamDrawParams(
    input: ImageGenerationSubmitInput,
    painting: PpioProviderParams
  ): Record<string, unknown> {
    return {
      prompt: input.prompt,
      size: painting.size || '2048x2048',
      watermark: painting.addWatermark ?? true,
      sequential_image_generation: 'disabled'
    }
  }

  private buildSeedreamEditParams(
    input: ImageGenerationSubmitInput,
    painting: PpioProviderParams,
    modelId: string
  ): Record<string, unknown> {
    const firstFile = input.files?.[0]
    const rawImage = firstFile ? fileToDataUrl(firstFile) : ''
    if (modelId === 'seedream-4.0' || modelId === 'seedream-4.0-edit') {
      return {
        prompt: input.prompt,
        images: rawImage ? [rawImage] : [],
        size: painting.size || '2048x2048',
        watermark: painting.addWatermark ?? true,
        sequential_image_generation: 'disabled'
      }
    }

    const base64Image = rawImage.replace(/^data:[^;]+;base64,/, '')
    return {
      prompt: input.prompt,
      image: base64Image ? [base64Image] : [],
      size: painting.size || '2048x2048',
      watermark: painting.addWatermark ?? true,
      sequential_image_generation: 'disabled'
    }
  }

  private extractSyncImageUrls(result: PpioSyncResult): string[] | undefined {
    if (!result.images) return undefined

    return result.images
      .map((image) => {
        if (typeof image === 'string') return image
        return image.image_url ?? image.url
      })
      .filter((url): url is string => typeof url === 'string' && url.length > 0)
  }

  async getTaskResult(taskId: string, timeout: number = 120000, signal?: AbortSignal): Promise<PpioTaskResult> {
    const endpoint = `/v3/async/task-result?task_id=${encodeURIComponent(taskId)}`
    return this.request<PpioTaskResult>(endpoint, {}, 'GET', { timeout, signal })
  }

  async poll(
    taskId: string,
    options: { signal?: AbortSignal; onProgress?: (progress: number) => void }
  ): Promise<string[]> {
    const result = await this.pollTaskResult(taskId, options)
    return (result.images ?? []).map((img) => img.image_url)
  }

  async pollTaskResult(
    taskId: string,
    options?: {
      interval?: number
      maxAttempts?: number
      onProgress?: (progress: number) => void
      signal?: AbortSignal
    }
  ): Promise<PpioTaskResult> {
    const { interval, maxAttempts = 120, onProgress, signal } = options || {}
    const maxTransientRetries = 10
    let attempts = 0
    let transientRetries = 0
    const startTime = Date.now()

    while (attempts < maxAttempts) {
      if (signal?.aborted) {
        throw createAbortError('Task polling aborted')
      }

      try {
        const result = await this.getTaskResult(taskId, 10000, signal)
        transientRetries = 0

        if (result.task.progress_percent !== undefined && onProgress) {
          onProgress(result.task.progress_percent)
        }

        if (result.task.status === 'TASK_STATUS_SUCCEED') {
          return result
        }

        if (result.task.status === 'TASK_STATUS_FAILED') {
          throw new PpioTaskFailedError(result.task.reason || 'Task failed')
        }
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
          throw createAbortError('Task polling aborted')
        }

        // Terminal classifications — propagate without retrying. A 4xx (bar
        // 429) poll response won't recover; 5xx / 429 fall through to the
        // transient handling below (network blips, server hiccups, rate limits).
        if (error instanceof PpioApiError && isTerminalHttpStatus(error.statusCode)) {
          throw error
        }

        if (error instanceof PpioTaskFailedError) {
          throw error
        }

        transientRetries++

        if (transientRetries >= maxTransientRetries) {
          throw error instanceof Error ? error : new Error(String(error))
        }

        const elapsedTime = Date.now() - startTime
        const pollDelay = interval ?? (elapsedTime < 60000 ? 3000 : 10000)
        await waitWithSignal(pollDelay, signal)
        // Count the transient round against `maxAttempts` too. `transientRetries`
        // resets on the next success, so without this a task that alternates
        // success/transient-failure never exhausts either counter and the loop is
        // bounded only by the 30-minute job timeout — and by nothing at all on the
        // in-SDK path, which has no timeout above it.
        attempts++
        continue
      }

      const elapsedTime = Date.now() - startTime
      const pollDelay = interval ?? (elapsedTime < 60000 ? 3000 : 10000)
      await waitWithSignal(pollDelay, signal)
      attempts++
    }

    throw new Error('Task polling timeout')
  }
}

export function createPpioTransport(settings: PpioTransportSettings): PpioTransport {
  return new PpioTransport(settings)
}

export type { PpioTransport }
