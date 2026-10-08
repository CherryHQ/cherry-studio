import { createJsonResponseHandler, type FetchFunction, getFromApi, postJsonToApi } from '@ai-sdk/provider-utils'
import * as z from 'zod'

import type { VendorBag } from '@main/ai/utils/imageOptions'

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
import { resolveTokenhubImageProtocol } from './tokenhubImageBinding'

export const DEFAULT_TOKENHUB_BASE_URL = 'https://tokenhub.tencentmaas.com'

const VIDU_TASKS_PATH = '/v1/wand/vidu-image/tasks'

const tokenhubImageSchema = z
  .object({
    url: z.string().min(1).optional(),
    b64_json: z.string().min(1).optional()
  })
  .refine((image) => image.url !== undefined || image.b64_json !== undefined, {
    message: 'TokenHub image result requires url or b64_json'
  })
  .passthrough()

const tokenhubSyncImageResponseSchema = z.object({ data: z.array(tokenhubImageSchema).min(1) }).passthrough()

const tokenhubTaskStateSchema = z.enum(['created', 'queueing', 'processing', 'success', 'failed'])

const tokenhubViduSubmitResponseSchema = z
  .object({
    task_id: z.string().min(1),
    state: tokenhubTaskStateSchema.optional()
  })
  .passthrough()

const tokenhubViduTaskResponseSchema = z
  .object({
    state: tokenhubTaskStateSchema,
    creations: z.array(z.object({ url: z.string().min(1) }).passthrough()).optional(),
    message: z.string().optional(),
    err_msg: z.string().optional()
  })
  .passthrough()

export type TokenhubProviderParams = Pick<
  VendorBag,
  | 'promptEnhancement'
  | 'imageResolution'
  | 'outputFormat'
  | 'addWatermark'
  | 'sequentialImageGeneration'
  | 'maxImages'
  | 'resolution'
>

export interface TokenhubTransportSettings {
  modelDescriptor: ImageTransportDescriptor
  apiKey: string
  baseURL?: string
  headers?: Record<string, string | undefined>
  fetch?: FetchFunction
}

function imagesOf(input: ImageGenerationSubmitInput<VendorBag>): string[] | undefined {
  if (!input.files?.length) return undefined
  return input.files.map((file) => fileToDataUrl(file))
}

function buildHunyuanBody(
  input: ImageGenerationSubmitInput<VendorBag>,
  bag: TokenhubProviderParams
): Record<string, unknown> {
  const body: Record<string, unknown> = { model: input.modelId, prompt: input.prompt ?? '' }
  const images = imagesOf(input)
  if (images) body.images = images
  if (input.size) body.size = input.size
  if (typeof input.seed === 'number') body.seed = input.seed
  if (bag.promptEnhancement !== undefined) body.revise = bag.promptEnhancement
  return body
}

function buildSeedreamBody(
  input: ImageGenerationSubmitInput<VendorBag>,
  bag: TokenhubProviderParams
): Record<string, unknown> {
  const body: Record<string, unknown> = { model: input.modelId, prompt: input.prompt ?? '', response_format: 'url' }
  const images = imagesOf(input)
  if (images) body.images = images
  const size = input.size ?? bag.imageResolution
  if (size) body.size = size
  if (bag.outputFormat) body.output_format = bag.outputFormat
  if (bag.addWatermark !== undefined) body.watermark = bag.addWatermark
  if (bag.sequentialImageGeneration) {
    body.sequential_image_generation = bag.sequentialImageGeneration
    if (bag.sequentialImageGeneration === 'auto' && typeof bag.maxImages === 'number') {
      body.sequential_image_generation_options = { max_images: bag.maxImages }
    }
  }
  return body
}

function buildViduBody(
  input: ImageGenerationSubmitInput<VendorBag>,
  bag: TokenhubProviderParams
): Record<string, unknown> {
  const body: Record<string, unknown> = { model: input.modelId, prompt: input.prompt ?? '' }
  const images = imagesOf(input)
  if (images) body.images = images
  if (input.aspectRatio) body.aspect_ratio = input.aspectRatio
  if (bag.resolution) body.resolution = bag.resolution
  if (typeof input.seed === 'number') body.seed = input.seed
  return body
}

function extractSyncUrls(data: z.infer<typeof tokenhubSyncImageResponseSchema>['data']): string[] {
  return data.map((item) => {
    if (item.url) return item.url
    if (item.b64_json) return `data:image/png;base64,${item.b64_json}`
    throw new Error('TokenHub image result requires url or b64_json')
  })
}

class TokenhubTransport implements TaskImageGenerationTransport<VendorBag> {
  private readonly apiKey: string
  private readonly baseURL: string
  private readonly headers: Record<string, string | undefined> | undefined
  private readonly fetch: FetchFunction | undefined

  private readonly modelDescriptor: ImageTransportDescriptor
  private readonly protocol: NonNullable<ReturnType<typeof resolveTokenhubImageProtocol>>

  readonly task: TaskImageGenerationTransport<VendorBag>['task'] = {
    kind: 'supported' as const,
    pollPolicy: ADAPTIVE_IMAGE_POLL_POLICY,
    query: (taskId: string, context: Parameters<TokenhubTransport['query']>[1]) => this.query(taskId, context),
    cancel: { kind: 'unsupported' as const }
  }

  constructor(settings: TokenhubTransportSettings) {
    this.apiKey = settings.apiKey
    this.baseURL = settings.baseURL || DEFAULT_TOKENHUB_BASE_URL
    this.headers = settings.headers
    this.fetch = settings.fetch
    this.modelDescriptor = { ...settings.modelDescriptor }
    const protocol = resolveTokenhubImageProtocol(settings.modelDescriptor.endpoint)
    if (!protocol) throw new Error(`Unsupported TokenHub image endpoint: ${settings.modelDescriptor.endpoint}`)
    this.protocol = protocol
  }

  supportsInput(): ImageTransportInputSupport {
    return { files: true, mask: false }
  }

  async submit(input: ImageGenerationSubmitInput<VendorBag>) {
    const descriptor = this.modelDescriptor
    const family = this.protocol
    input = { ...input, modelId: descriptor.id }
    const bag = input.providerParams
    const url = `${this.baseURL}${descriptor.endpoint}`
    const headers = combineImageTransportHeaders(
      { Authorization: `Bearer ${this.apiKey}` },
      this.headers,
      input.headers
    )

    if (family === 'vidu') {
      const response = await withImageTransportRequestTimeout(
        { url, timeoutMs: 120_000, signal: input.signal },
        (signal) =>
          postJsonToApi({
            url,
            headers,
            body: buildViduBody(input, bag),
            abortSignal: signal,
            fetch: this.fetch,
            failedResponseHandler: createImageTransportErrorResponseHandler('TokenHub API error'),
            successfulResponseHandler: createJsonResponseHandler(tokenhubViduSubmitResponseSchema)
          })
      )
      return submittedImageTransportSubmission(response.value.task_id, 'TokenHub Vidu submit')
    }

    const response = await withImageTransportRequestTimeout(
      { url, timeoutMs: 120_000, signal: input.signal },
      (signal) =>
        postJsonToApi({
          url,
          headers,
          body: family === 'hunyuan' ? buildHunyuanBody(input, bag) : buildSeedreamBody(input, bag),
          abortSignal: signal,
          fetch: this.fetch,
          failedResponseHandler: createImageTransportErrorResponseHandler('TokenHub API error'),
          successfulResponseHandler: createJsonResponseHandler(tokenhubSyncImageResponseSchema)
        })
    )
    return completedImageTransportSubmission(extractSyncUrls(response.value.data), 'TokenHub')
  }

  private async query(
    taskId: string,
    context: ImageTransportTaskContext<VendorBag, AbortSignal>
  ): Promise<ImageTransportTaskState> {
    const descriptor = context.modelDescriptor
    if (!descriptor || resolveTokenhubImageProtocol(descriptor.endpoint) !== 'vidu') {
      throw new Error('TokenHub task query requires a persisted Vidu modelDescriptor')
    }
    const url = `${this.baseURL}${VIDU_TASKS_PATH}/${encodeURIComponent(taskId)}`
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
          failedResponseHandler: createImageTransportErrorResponseHandler('TokenHub API error'),
          successfulResponseHandler: createJsonResponseHandler(tokenhubViduTaskResponseSchema)
        })
    )

    if (result.value.state === 'success') {
      return completedImageTransportTask(
        (result.value.creations ?? []).map((creation) => creation.url),
        'TokenHub Vidu task'
      )
    }
    if (result.value.state === 'failed') {
      return { kind: 'failed', message: result.value.err_msg || result.value.message || 'TokenHub task failed' }
    }
    return { kind: 'pending' }
  }
}

export function createTokenhubTransport(settings: TokenhubTransportSettings): TokenhubTransport {
  return new TokenhubTransport(settings)
}

export type { TokenhubTransport }
