import {
  combineHeaders,
  createJsonResponseHandler,
  type FetchFunction,
  getFromApi,
  postJsonToApi
} from '@ai-sdk/provider-utils'
import { DEFAULT_TIMEOUT } from '@main/ai/constants'
import type { ImageSizeToken } from '@main/ai/utils/aiSdkNativeBindings'
import type { VendorBag } from '@main/ai/utils/imageOptions'
import * as z from 'zod'

import type { ImageGenerationSubmitInput } from '../imageTransport'
import {
  ADAPTIVE_IMAGE_POLL_POLICY,
  completedImageTransportSubmission,
  completedImageTransportTask,
  type ImageTransportInputSupport,
  type ImageTransportTaskContext,
  type ImageTransportTaskState,
  submittedImageTransportSubmission,
  type TaskImageGenerationTransport
} from '../imageTransport'
import { createImageTransportErrorResponseHandler, withImageTransportRequestTimeout } from '../imageTransportHttp'
import { fileToDataUrl } from '../transportUtils'

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

const ppioSubmitResultSchema = z.object({ task_id: z.string().min(1) }).passthrough()
const ppioSyncResultSchema = z
  .object({
    images: z.array(
      z.union([z.string().min(1), z.object({ image_url: z.string().optional(), url: z.string().optional() })])
    )
  })
  .passthrough()
const ppioTaskResultSchema = z
  .object({
    task: z
      .object({
        status: z.enum(['TASK_STATUS_QUEUED', 'TASK_STATUS_PROCESSING', 'TASK_STATUS_SUCCEED', 'TASK_STATUS_FAILED']),
        reason: z.string().optional(),
        progress_percent: z.number().optional()
      })
      .passthrough(),
    images: z.array(z.object({ image_url: z.string().min(1) }).passthrough()).optional()
  })
  .passthrough()

type PpioSyncResult = z.infer<typeof ppioSyncResultSchema>

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
 * The vendor bag as it ARRIVES, derived from {@link VendorBag} rather than
 * {@link ParamValues}: the bag comes straight from `splitParamValues`, which routes the
 * native keys (`size`/`seed`/`n`/`aspectRatio`) onto `input.*` instead. Picking from
 * `ParamValues` admitted `size` here, and `bagParams.size ?? input.size` then read a
 * field that can never arrive — a probe chain whose first arm is structurally dead.
 */
export type PpioBag = Pick<VendorBag, 'promptEnhancement' | 'addWatermark' | 'outputFormat'>

/** The merged view the per-model builders read: the bag plus the native fields PPIO
 *  needs under its own wire names. Not a bag type — nothing arrives shaped like this. */
export type PpioProviderParams = PpioBag & {
  size?: ImageSizeToken
  /** PPIO's own wire name for the seed, merged from `input.seed` at submit. */
  ppioSeed?: number
}

export interface PpioTransportSettings {
  apiKey: string
  baseURL?: string
  headers?: Record<string, string | undefined>
  fetch?: FetchFunction
}

class PpioTransport implements TaskImageGenerationTransport<PpioBag> {
  private readonly apiKey: string
  private readonly baseURL: string
  private readonly headers: Record<string, string | undefined> | undefined
  private readonly fetch: FetchFunction | undefined

  readonly task: TaskImageGenerationTransport<PpioBag>['task'] = {
    kind: 'supported' as const,
    pollPolicy: ADAPTIVE_IMAGE_POLL_POLICY,
    query: (taskId: string, context: Parameters<PpioTransport['query']>[1]) => this.query(taskId, context),
    cancel: { kind: 'unsupported' as const }
  }

  constructor(settings: PpioTransportSettings) {
    this.apiKey = settings.apiKey
    this.baseURL = settings.baseURL || DEFAULT_PPIO_BASE_URL
    this.headers = settings.headers
    this.fetch = settings.fetch
  }

  async submit(input: ImageGenerationSubmitInput<PpioBag>) {
    const bagParams = input.providerParams
    const descriptor = input.modelDescriptor
    if (!descriptor) {
      throw new Error(`Unknown model: ${input.modelId}`)
    }

    // `size`/`seed` are native params: `splitParamValues` routes them onto `input.*`, so
    // the bag never carries them. One read each — the previous `bagParams.size ?? …`
    // probed an arm the type system now proves cannot exist.
    const params: PpioProviderParams = { ...bagParams, size: input.size, ppioSeed: input.seed }

    const requestParams = this.buildRequestParams(input, params, descriptor)
    const url = `${this.baseURL}${descriptor.endpoint}`
    const headers = combineHeaders({ Authorization: `Bearer ${this.apiKey}` }, this.headers, input.headers)

    if (descriptor.isSync) {
      const result = await withImageTransportRequestTimeout(
        { url, timeoutMs: DEFAULT_TIMEOUT, signal: input.signal },
        (signal) =>
          postJsonToApi({
            url,
            headers,
            body: requestParams,
            abortSignal: signal,
            fetch: this.fetch,
            failedResponseHandler: createImageTransportErrorResponseHandler('PPIO API error'),
            successfulResponseHandler: createJsonResponseHandler(ppioSyncResultSchema)
          })
      )
      return completedImageTransportSubmission(this.extractSyncImageUrls(result.value), 'PPIO')
    }

    const result = await withImageTransportRequestTimeout({ url, timeoutMs: 120_000, signal: input.signal }, (signal) =>
      postJsonToApi({
        url,
        headers,
        body: requestParams,
        abortSignal: signal,
        fetch: this.fetch,
        failedResponseHandler: createImageTransportErrorResponseHandler('PPIO API error'),
        successfulResponseHandler: createJsonResponseHandler(ppioSubmitResultSchema)
      })
    )
    return submittedImageTransportSubmission(result.value.task_id, 'PPIO')
  }

  /**
   * Mirrors the `buildRequestParams` switch below: only the Qwen edit models and the
   * Seedream family *in edit mode* have an `image` slot. Everything else drops an
   * attached reference image, and PPIO has no mask slot at all.
   */
  supportsInput(input: ImageGenerationSubmitInput<PpioBag>): ImageTransportInputSupport {
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

  private extractSyncImageUrls(result: PpioSyncResult): string[] {
    return result.images
      .map((image) => {
        if (typeof image === 'string') return image
        return image.image_url ?? image.url
      })
      .filter((url): url is string => typeof url === 'string' && url.length > 0)
  }

  private async query(
    taskId: string,
    context: ImageTransportTaskContext<PpioBag, AbortSignal>
  ): Promise<ImageTransportTaskState> {
    const endpoint = `/v3/async/task-result?task_id=${encodeURIComponent(taskId)}`
    const url = `${this.baseURL}${endpoint}`
    const result = await withImageTransportRequestTimeout(
      { url, timeoutMs: 10_000, signal: context.signal },
      (signal) =>
        getFromApi({
          url,
          headers: combineHeaders({ Authorization: `Bearer ${this.apiKey}` }, this.headers, context.headers),
          abortSignal: signal,
          fetch: this.fetch,
          failedResponseHandler: createImageTransportErrorResponseHandler('PPIO API error'),
          successfulResponseHandler: createJsonResponseHandler(ppioTaskResultSchema)
        })
    )

    if (result.value.task.status === 'TASK_STATUS_SUCCEED') {
      return completedImageTransportTask(
        (result.value.images ?? []).map((image) => image.image_url),
        'PPIO task'
      )
    }
    if (result.value.task.status === 'TASK_STATUS_FAILED') {
      return { kind: 'failed', message: result.value.task.reason || 'Task failed' }
    }
    return { kind: 'pending', progress: result.value.task.progress_percent }
  }
}

export function createPpioTransport(settings: PpioTransportSettings): PpioTransport {
  return new PpioTransport(settings)
}

export type { PpioTransport }
