import {
  combineHeaders,
  createJsonResponseHandler,
  type FetchFunction,
  getFromApi,
  postJsonToApi
} from '@ai-sdk/provider-utils'
import type { VendorBag } from '@main/ai/utils/imageOptions'
import * as z from 'zod'

import type { ImageGenerationSubmitInput } from '../imageTransport'
import {
  ADAPTIVE_IMAGE_POLL_POLICY,
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
 * ModelScope (魔搭) API Inference transport for AIGC image generation.
 *
 * Submit POST `/v1/images/generations` with `X-ModelScope-Async-Mode: true` →
 * returns `{ task_id }`. Poll `GET /v1/tasks/{task_id}` with
 * `X-ModelScope-Task-Type: image_generation` until `task_status === 'SUCCEED'`,
 * then read `output_images[]` (raw URL strings). Free-tier limits apply per
 * ModelScope's fair-use quotas.
 *
 * Wire-format notes (per api-inference docs):
 *   - `size` is the WxH string itself (e.g. `'1024x1024'`), NOT a width /
 *     height split.
 *   - Sampling fields are `steps` and `guidance` (NOT `num_inference_steps`
 *     / `guidance_scale`). This transport reads the canonical camelCase
 *     `numInferenceSteps` / `guidanceScale` from the vendor bag and renames
 *     them to ModelScope's spelling.
 *   - `negative_prompt` and `seed` are forwarded as-is.
 *   - `image_url` carries the edit-mode input image (Qwen-Image-Edit-*).
 */

export const DEFAULT_MODELSCOPE_BASE_URL = 'https://api-inference.modelscope.cn'

const modelscopeSubmitResultSchema = z.object({ task_id: z.string().min(1) }).passthrough()
const modelscopeTaskResultSchema = z
  .object({
    task_status: z.enum(['PENDING', 'RUNNING', 'SUCCEED', 'FAILED']),
    output_images: z.array(z.string().min(1)).optional(),
    message: z.string().optional()
  })
  .passthrough()

export interface ModelscopeTransportSettings {
  apiKey: string
  baseURL?: string
  headers?: Record<string, string | undefined>
  fetch?: FetchFunction
}

/** The three canonical keys this transport's single body carries. */
export type ModelscopeProviderParams = Pick<VendorBag, 'numInferenceSteps' | 'guidanceScale' | 'negativePrompt'>

class ModelscopeTransport implements TaskImageGenerationTransport<ModelscopeProviderParams> {
  private readonly apiKey: string
  private readonly baseURL: string
  private readonly headers: Record<string, string | undefined> | undefined
  private readonly fetch: FetchFunction | undefined

  readonly task: TaskImageGenerationTransport<ModelscopeProviderParams>['task'] = {
    kind: 'supported' as const,
    pollPolicy: ADAPTIVE_IMAGE_POLL_POLICY,
    query: (taskId: string, context: Parameters<ModelscopeTransport['query']>[1]) => this.query(taskId, context),
    cancel: { kind: 'unsupported' as const }
  }

  constructor(settings: ModelscopeTransportSettings) {
    this.apiKey = settings.apiKey
    this.baseURL = settings.baseURL || DEFAULT_MODELSCOPE_BASE_URL
    this.headers = settings.headers
    this.fetch = settings.fetch
  }

  /** One unconditional body for every model, and it always carries `image_url`. */
  supportsInput(): ImageTransportInputSupport {
    return { files: true, mask: false }
  }

  async submit(input: ImageGenerationSubmitInput<ModelscopeProviderParams>) {
    const bag = input.providerParams

    const body: Record<string, unknown> = {
      model: input.modelId,
      prompt: input.prompt ?? ''
    }

    // ModelScope's `size` is the WxH string itself — NOT split into
    // width / height (api-inference docs).
    if (input.size) body.size = input.size

    // Image-edit models (Qwen-Image-Edit-*) require `image_url`. AI SDK
    // normalizes attached input images into `input.files` (post `prompt: { text,
    // images }`). Pass the first one — ModelScope accepts http(s) or data URLs.
    const firstFile = input.files?.[0]
    if (firstFile) {
      body.image_url = fileToDataUrl(firstFile)
    }

    // The bag is canonical camelCase (schema-coerced); ModelScope's wire names
    // are `steps` / `guidance` (not `num_inference_steps` / `guidance_scale`).
    if (typeof bag.numInferenceSteps === 'number') body.steps = bag.numInferenceSteps
    if (typeof bag.guidanceScale === 'number') body.guidance = bag.guidanceScale
    if (typeof bag.negativePrompt === 'string' && bag.negativePrompt) body.negative_prompt = bag.negativePrompt

    if (input.seed !== undefined) body.seed = input.seed

    const url = `${this.baseURL}/v1/images/generations`
    const response = await withImageTransportRequestTimeout(
      { url, timeoutMs: 120_000, signal: input.signal },
      (signal) =>
        postJsonToApi({
          url,
          headers: combineHeaders({ Authorization: `Bearer ${this.apiKey}` }, this.headers, input.headers, {
            'X-ModelScope-Async-Mode': 'true'
          }),
          body,
          abortSignal: signal,
          fetch: this.fetch,
          failedResponseHandler: createImageTransportErrorResponseHandler('ModelScope API error'),
          successfulResponseHandler: createJsonResponseHandler(modelscopeSubmitResultSchema)
        })
    )
    return submittedImageTransportSubmission(response.value.task_id, 'ModelScope')
  }

  private async query(
    taskId: string,
    context: ImageTransportTaskContext<ModelscopeProviderParams, AbortSignal>
  ): Promise<ImageTransportTaskState> {
    const url = `${this.baseURL}/v1/tasks/${encodeURIComponent(taskId)}`
    const result = await withImageTransportRequestTimeout(
      { url, timeoutMs: 10_000, signal: context.signal },
      (signal) =>
        getFromApi({
          url,
          headers: combineHeaders({ Authorization: `Bearer ${this.apiKey}` }, this.headers, context.headers, {
            'X-ModelScope-Task-Type': 'image_generation'
          }),
          abortSignal: signal,
          fetch: this.fetch,
          failedResponseHandler: createImageTransportErrorResponseHandler('ModelScope API error'),
          successfulResponseHandler: createJsonResponseHandler(modelscopeTaskResultSchema)
        })
    )

    if (result.value.task_status === 'SUCCEED') {
      return completedImageTransportTask(result.value.output_images ?? [], 'ModelScope task')
    }
    if (result.value.task_status === 'FAILED') {
      return { kind: 'failed', message: result.value.message || 'Task failed' }
    }
    return { kind: 'pending' }
  }
}

export function createModelscopeTransport(settings: ModelscopeTransportSettings): ModelscopeTransport {
  return new ModelscopeTransport(settings)
}

export type { ModelscopeTransport }
