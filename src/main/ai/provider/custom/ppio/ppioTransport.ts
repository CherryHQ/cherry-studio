import { createJsonResponseHandler, type FetchFunction, getFromApi, postJsonToApi } from '@ai-sdk/provider-utils'
import { DEFAULT_TIMEOUT } from '@main/ai/constants'
import type { VendorBag } from '@main/ai/utils/imageOptions'
import * as z from 'zod'

import type { ImageGenerationSubmitInput, ImageTransportDescriptor } from '../imageTransport'
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
import {
  combineImageTransportHeaders,
  createImageTransportErrorResponseHandler,
  withImageTransportRequestTimeout
} from '../imageTransportHttp'
import { fileToDataUrl } from '../transportUtils'
import { resolvePpioImageProtocol } from './ppioImageBinding'

export const DEFAULT_PPIO_BASE_URL = 'https://api.ppio.com'

const ppioSubmitResultSchema = z.object({ task_id: z.string().min(1) }).passthrough()
const ppioSyncResultSchema = z
  .object({
    images: z
      .array(
        z.union([
          z.string().min(1),
          z
            .object({ image_url: z.string().min(1).optional(), url: z.string().min(1).optional() })
            .transform((image, ctx) => {
              if (image.image_url) return image.image_url
              if (image.url) return image.url
              ctx.addIssue({ code: 'custom', message: 'PPIO image result requires a URL' })
              return z.NEVER
            })
        ])
      )
      .min(1)
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

/** The resolved registry descriptor, bound once before submission. */
export type PpioModelDescriptor = ImageTransportDescriptor

/** Canonical vendor parameters; native fields come from the submit input. */
export type PpioBag = Pick<VendorBag, 'promptEnhancement' | 'addWatermark' | 'outputFormat'>

export interface PpioTransportSettings {
  modelDescriptor: PpioModelDescriptor
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
  private readonly modelDescriptor: PpioModelDescriptor
  private readonly protocol: NonNullable<ReturnType<typeof resolvePpioImageProtocol>>

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
    this.modelDescriptor = { ...settings.modelDescriptor }
    const protocol = resolvePpioImageProtocol(settings.modelDescriptor.endpoint)
    if (!protocol) throw new Error(`Unsupported PPIO image endpoint: ${settings.modelDescriptor.endpoint}`)
    this.protocol = protocol
  }

  async submit(input: ImageGenerationSubmitInput<PpioBag>) {
    const descriptor = this.modelDescriptor
    const requestParams = this.buildRequestParams(input)
    const url = `${this.baseURL}${descriptor.endpoint}`
    const headers = combineImageTransportHeaders(
      { Authorization: `Bearer ${this.apiKey}` },
      this.headers,
      input.headers
    )

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
      return completedImageTransportSubmission(result.value.images, 'PPIO')
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

  supportsInput(): ImageTransportInputSupport {
    const files =
      this.protocol === 'qwen-edit' || this.protocol === 'seedream-images' || this.protocol === 'seedream-image'
    return { files, mask: false }
  }

  private buildRequestParams(input: ImageGenerationSubmitInput<PpioBag>): Record<string, unknown> {
    switch (this.protocol) {
      case 'jimeng':
        return this.buildJimengParams(input)
      case 'hunyuan':
        return this.buildHunyuanParams(input)
      case 'qwen-generate':
        return this.buildQwenTxt2ImgParams(input)
      case 'qwen-edit':
        return this.buildQwenEditParams(input)
      case 'glm':
        return this.buildGlmParams(input)
      case 'z-image':
        return this.buildZImageParams(input)
      case 'z-image-lora':
        return this.buildZImageLoraParams(input)
      case 'seedream-images':
      case 'seedream-image':
        return input.files?.length ? this.buildSeedreamReferenceParams(input) : this.buildSeedreamParams(input)
    }
  }

  private buildJimengParams(input: ImageGenerationSubmitInput<PpioBag>): Record<string, unknown> {
    const params: Record<string, unknown> = {
      prompt: input.prompt,
      seed: input.seed
    }

    if (input.providerParams.promptEnhancement !== undefined) {
      params.use_pre_llm = input.providerParams.promptEnhancement
    }

    if (input.size) {
      const [width, height] = input.size.split('x').map(Number)
      if (width && height) {
        params.width = width
        params.height = height
      }
    }

    if (input.providerParams.addWatermark !== undefined) {
      params.logo_info = {
        add_logo: input.providerParams.addWatermark
      }
    }

    return params
  }

  private buildHunyuanParams(input: ImageGenerationSubmitInput<PpioBag>): Record<string, unknown> {
    return {
      prompt: input.prompt,
      size: input.size?.replace('x', '*'),
      seed: input.seed,
      watermark: input.providerParams.addWatermark
    }
  }

  private buildQwenTxt2ImgParams(input: ImageGenerationSubmitInput<PpioBag>): Record<string, unknown> {
    return {
      prompt: input.prompt,
      size: input.size?.replace('x', '*'),
      watermark: input.providerParams.addWatermark
    }
  }

  private buildQwenEditParams(input: ImageGenerationSubmitInput<PpioBag>): Record<string, unknown> {
    const firstFile = input.files?.[0]
    return {
      prompt: input.prompt,
      image: firstFile ? fileToDataUrl(firstFile) : undefined,
      seed: input.seed,
      output_format: input.providerParams.outputFormat,
      watermark: input.providerParams.addWatermark
    }
  }

  private buildGlmParams(input: ImageGenerationSubmitInput<PpioBag>): Record<string, unknown> {
    return {
      prompt: input.prompt,
      size: input.size,
      quality: 'hd',
      watermark_enabled: input.providerParams.addWatermark
    }
  }

  private buildZImageParams(input: ImageGenerationSubmitInput<PpioBag>): Record<string, unknown> {
    return {
      prompt: input.prompt,
      size: input.size?.replace('x', '*'),
      seed: input.seed
    }
  }

  private buildZImageLoraParams(input: ImageGenerationSubmitInput<PpioBag>): Record<string, unknown> {
    return {
      prompt: input.prompt,
      size: input.size?.replace('x', '*'),
      seed: input.seed,
      loras: []
    }
  }

  private buildSeedreamParams(input: ImageGenerationSubmitInput<PpioBag>): Record<string, unknown> {
    return {
      prompt: input.prompt,
      size: input.size,
      watermark: input.providerParams.addWatermark,
      sequential_image_generation: 'disabled'
    }
  }

  private buildSeedreamReferenceParams(input: ImageGenerationSubmitInput<PpioBag>): Record<string, unknown> {
    const firstFile = input.files?.[0]
    const rawImage = firstFile ? fileToDataUrl(firstFile) : ''
    if (this.protocol === 'seedream-images') {
      return {
        prompt: input.prompt,
        images: input.files?.map(fileToDataUrl),
        size: input.size,
        watermark: input.providerParams.addWatermark,
        sequential_image_generation: 'disabled'
      }
    }

    const base64Image = rawImage.replace(/^data:[^;]+;base64,/, '')
    return {
      prompt: input.prompt,
      image: base64Image ? [base64Image] : [],
      size: input.size,
      watermark: input.providerParams.addWatermark,
      sequential_image_generation: 'disabled'
    }
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
          headers: combineImageTransportHeaders(
            { Authorization: `Bearer ${this.apiKey}` },
            this.headers,
            context.headers
          ),
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
