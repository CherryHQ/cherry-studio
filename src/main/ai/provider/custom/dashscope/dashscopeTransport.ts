import {
  createJsonResponseHandler,
  type FetchFunction,
  getFromApi,
  postJsonToApi,
  postToApi
} from '@ai-sdk/provider-utils'
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
import { resolveDashScopeImageProtocol } from './dashscopeImageBinding'

export const DEFAULT_DASHSCOPE_IMAGE_BASE_URL = 'https://dashscope.aliyuncs.com'

interface DashScopeTaskOutput {
  task_id?: string
  task_status?: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED'
  message?: string
  code?: string
  results?: Array<{ url?: string; image_url?: string }>
  choices?: Array<{ message?: { content?: Array<{ image?: string; text?: string }> } }>
  image_url?: string
}

/** The resolved registry descriptor, bound once before submission. */
export type DashScopeModelDescriptor = ImageTransportDescriptor

/** Canonical vendor parameters; native fields come from the submit input. */
export type DashScopeProviderParams = Pick<
  VendorBag,
  | 'negativePrompt'
  | 'style'
  | 'promptExtend'
  | 'addWatermark'
  | 'thinkingMode'
  | 'enableInterleave'
  | 'imageResolution'
  | 'refStrength'
  | 'refMode'
  | 'sourceLang'
  | 'targetLang'
  | 'function'
  | 'strength'
  | 'upscaleFactor'
  | 'topScale'
  | 'bottomScale'
  | 'leftScale'
  | 'rightScale'
  | 'isSketch'
>

export interface DashScopeTransportSettings {
  modelDescriptor: DashScopeModelDescriptor
  apiKey: string
  imageBaseURL?: string
  headers?: Record<string, string | undefined>
  fetch?: FetchFunction
}

const dashScopeOutputSchema = z
  .object({
    task_id: z.string().min(1).optional(),
    task_status: z.enum(['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED']).optional(),
    message: z.string().optional(),
    code: z.string().optional(),
    results: z
      .array(z.object({ url: z.string().min(1).optional(), image_url: z.string().min(1).optional() }).passthrough())
      .optional(),
    choices: z
      .array(
        z
          .object({
            message: z
              .object({
                content: z
                  .array(z.object({ image: z.string().min(1).optional(), text: z.string().optional() }).passthrough())
                  .optional()
              })
              .passthrough()
              .optional()
          })
          .passthrough()
      )
      .optional(),
    image_url: z.string().min(1).optional()
  })
  .passthrough()

const dashScopeAsyncSubmitSchema = z
  .object({ output: dashScopeOutputSchema.extend({ task_id: z.string().min(1) }) })
  .passthrough()
const dashScopeSyncSubmitSchema = z.object({ output: dashScopeOutputSchema }).passthrough()
const dashScopeTaskResultSchema = z
  .object({
    output: dashScopeOutputSchema.extend({
      task_status: z.enum(['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED'])
    })
  })
  .passthrough()

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
function toDashScopeSize(size: ImageGenerationSubmitInput<DashScopeProviderParams>['size']): string | undefined {
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
function resolveSizeParameter(
  input: ImageGenerationSubmitInput<DashScopeProviderParams>,
  bag: DashScopeProviderParams
): string | undefined {
  if (typeof bag.imageResolution === 'string' && bag.imageResolution) {
    return bag.imageResolution
  }
  return toDashScopeSize(input.size)
}

/**
 * Family C — flat `input.prompt` body for text2image/image-synthesis
 * (qwen-image / qwen-image-plus / wanx2.x-t2i-* / wanx-v1).
 */
function buildText2ImageBody(
  input: ImageGenerationSubmitInput<DashScopeProviderParams>,
  bag: DashScopeProviderParams
): Record<string, unknown> {
  const inputBlock: Record<string, unknown> = {}
  if (input.prompt) inputBlock.prompt = input.prompt
  if (bag.negativePrompt) inputBlock.negative_prompt = bag.negativePrompt

  const parameters: Record<string, unknown> = {}
  const sizeWire = resolveSizeParameter(input, bag)
  if (sizeWire) parameters.size = sizeWire
  if (input.n && input.n > 1) parameters.n = input.n
  if (typeof input.seed === 'number') parameters.seed = input.seed
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
function buildChatLikeBody(
  input: ImageGenerationSubmitInput<DashScopeProviderParams>,
  bag: DashScopeProviderParams
): Record<string, unknown> {
  const content: Array<{ text?: string; image?: string }> = []
  if (input.prompt) content.push({ text: input.prompt })
  for (const file of input.files ?? []) content.push({ image: fileToDataUrl(file) })

  const parameters: Record<string, unknown> = {}
  const sizeWire = resolveSizeParameter(input, bag)
  if (sizeWire) parameters.size = sizeWire
  if (input.n && input.n > 1) parameters.n = input.n
  if (typeof input.seed === 'number') parameters.seed = input.seed
  if (bag.negativePrompt) parameters.negative_prompt = bag.negativePrompt
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
function buildWanxV1Body(
  input: ImageGenerationSubmitInput<DashScopeProviderParams>,
  bag: DashScopeProviderParams
): Record<string, unknown> {
  const inputBlock: Record<string, unknown> = {}
  if (input.prompt) inputBlock.prompt = input.prompt
  if (bag.negativePrompt) inputBlock.negative_prompt = bag.negativePrompt
  const refFile = input.files?.[0]
  if (refFile) inputBlock.ref_image = fileToDataUrl(refFile)

  const parameters: Record<string, unknown> = {}
  const sizeWire = resolveSizeParameter(input, bag)
  if (sizeWire) parameters.size = sizeWire
  if (input.n && input.n > 1) parameters.n = input.n
  if (typeof input.seed === 'number') parameters.seed = input.seed
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
function buildWan25I2IBody(
  input: ImageGenerationSubmitInput<DashScopeProviderParams>,
  bag: DashScopeProviderParams
): Record<string, unknown> {
  const inputBlock: Record<string, unknown> = {}
  if (input.prompt) inputBlock.prompt = input.prompt
  if (bag.negativePrompt) inputBlock.negative_prompt = bag.negativePrompt
  if (input.files && input.files.length > 0) {
    inputBlock.images = input.files.map((f) => fileToDataUrl(f))
  }

  const parameters: Record<string, unknown> = {}
  const sizeWire = resolveSizeParameter(input, bag)
  if (sizeWire) parameters.size = sizeWire
  if (input.n && input.n > 1) parameters.n = input.n
  if (typeof input.seed === 'number') parameters.seed = input.seed
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
 * required fields (`inputs.prompt: 'optional'` in the registry capability).
 */
function buildQwenMtImageBody(
  input: ImageGenerationSubmitInput<DashScopeProviderParams>,
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
  input: ImageGenerationSubmitInput<DashScopeProviderParams>,
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
  if (typeof input.seed === 'number') parameters.seed = input.seed
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
  input: ImageGenerationSubmitInput<DashScopeProviderParams>,
  protocol: NonNullable<ReturnType<typeof resolveDashScopeImageProtocol>>
): Record<string, unknown> {
  const bag = input.providerParams
  switch (protocol) {
    case 'chat':
      return buildChatLikeBody(input, bag)
    case 'text':
      return buildText2ImageBody(input, bag)
    case 'reference':
      return buildWanxV1Body(input, bag)
    case 'images':
      return buildWan25I2IBody(input, bag)
    case 'translation':
      return buildQwenMtImageBody(input, bag)
    case 'edit':
      return buildWanxImageEditBody(input, bag)
  }
}

class DashScopeTransport implements TaskImageGenerationTransport<DashScopeProviderParams> {
  private readonly apiKey: string
  private readonly baseURL: string
  private readonly headers: Record<string, string | undefined> | undefined
  private readonly fetch: FetchFunction | undefined

  private readonly modelDescriptor: DashScopeModelDescriptor
  private readonly protocol: NonNullable<ReturnType<typeof resolveDashScopeImageProtocol>>

  readonly task: TaskImageGenerationTransport<DashScopeProviderParams>['task'] = {
    kind: 'supported' as const,
    pollPolicy: ADAPTIVE_IMAGE_POLL_POLICY,
    query: (taskId: string, context: Parameters<DashScopeTransport['query']>[1]) => this.query(taskId, context),
    cancel: {
      kind: 'supported' as const,
      cancelRemote: (taskId: string, context: Parameters<DashScopeTransport['cancelRemote']>[1]) =>
        this.cancelRemote(taskId, context)
    }
  }

  constructor(settings: DashScopeTransportSettings) {
    this.apiKey = settings.apiKey
    this.baseURL = settings.imageBaseURL || DEFAULT_DASHSCOPE_IMAGE_BASE_URL
    this.headers = settings.headers
    this.fetch = settings.fetch
    this.modelDescriptor = { ...settings.modelDescriptor }
    const protocol = resolveDashScopeImageProtocol(settings.modelDescriptor.id)
    if (!protocol) throw new Error(`Unsupported DashScope image model: ${settings.modelDescriptor.id}`)
    this.protocol = protocol
  }

  supportsInput(): ImageTransportInputSupport {
    return { files: this.protocol !== 'text', mask: this.protocol === 'edit' }
  }

  async submit(input: ImageGenerationSubmitInput<DashScopeProviderParams>) {
    const descriptor = this.modelDescriptor
    const body = buildRequestBody({ ...input, modelId: descriptor.id }, this.protocol)
    const url = `${this.baseURL}${descriptor.endpoint}`
    const response = await withImageTransportRequestTimeout(
      { url, timeoutMs: 120_000, signal: input.signal },
      (signal) =>
        postJsonToApi({
          url,
          headers: combineImageTransportHeaders(
            { Authorization: `Bearer ${this.apiKey}` },
            this.headers,
            input.headers,
            descriptor.isSync ? undefined : { 'X-DashScope-Async': 'enable' }
          ),
          body,
          abortSignal: signal,
          fetch: this.fetch,
          failedResponseHandler: createImageTransportErrorResponseHandler('DashScope API error'),
          successfulResponseHandler: createJsonResponseHandler(
            descriptor.isSync ? dashScopeSyncSubmitSchema : dashScopeAsyncSubmitSchema
          )
        })
    )

    if (descriptor.isSync) {
      return completedImageTransportSubmission(
        extractImageUrls(response.value.output, responseFamilyFor(descriptor)),
        'DashScope'
      )
    }

    const taskId = response.value.output.task_id
    if (!taskId) throw new Error('DashScope async submit returned no task_id')
    return submittedImageTransportSubmission(taskId, 'DashScope')
  }

  private async query(
    taskId: string,
    context: ImageTransportTaskContext<DashScopeProviderParams, AbortSignal>
  ): Promise<ImageTransportTaskState> {
    const descriptor = context.modelDescriptor
    if (!descriptor) {
      throw new Error('DashScope task query requires a persisted modelDescriptor')
    }

    const url = `${this.baseURL}/api/v1/tasks/${encodeURIComponent(taskId)}`
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
          failedResponseHandler: createImageTransportErrorResponseHandler('DashScope API error'),
          successfulResponseHandler: createJsonResponseHandler(dashScopeTaskResultSchema)
        })
    )

    const status = result.value.output.task_status
    if (status === 'SUCCEEDED') {
      return completedImageTransportTask(
        extractImageUrls(result.value.output, responseFamilyFor(descriptor)),
        'DashScope task'
      )
    }
    if (status === 'FAILED' || status === 'CANCELED') {
      return {
        kind: 'failed',
        message: result.value.output.message || `DashScope task ${status.toLowerCase()}`
      }
    }
    return { kind: 'pending' }
  }

  /**
   * Official contract: POST /api/v1/tasks/{task_id}/cancel; only a PENDING
   * task can be cancelled. Retrieved 2026-07-27:
   * https://help.aliyun.com/en/model-studio/manage-asynchronous-tasks
   */
  private async cancelRemote(
    taskId: string,
    context: ImageTransportTaskContext<DashScopeProviderParams, undefined>
  ): Promise<void> {
    const url = `${this.baseURL}/api/v1/tasks/${encodeURIComponent(taskId)}/cancel`
    await withImageTransportRequestTimeout({ url, timeoutMs: 10_000 }, (signal) =>
      postToApi({
        url,
        headers: combineImageTransportHeaders(
          { Authorization: `Bearer ${this.apiKey}` },
          this.headers,
          context.headers
        ),
        body: { content: '', values: {} },
        abortSignal: signal,
        fetch: this.fetch,
        failedResponseHandler: createImageTransportErrorResponseHandler('DashScope API error'),
        successfulResponseHandler: async () => ({ value: undefined })
      })
    )
  }
}

export function createDashScopeTransport(settings: DashScopeTransportSettings): DashScopeTransport {
  return new DashScopeTransport(settings)
}

export type { DashScopeTransport }
