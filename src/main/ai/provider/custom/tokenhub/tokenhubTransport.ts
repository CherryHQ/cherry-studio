import { combineHeaders, createJsonResponseHandler, type FetchFunction, postJsonToApi } from '@ai-sdk/provider-utils'
import type { VendorBag } from '@main/ai/utils/imageOptions'
import * as z from 'zod'

import type { ImageGenerationSubmitInput } from '../imageTransport'
import {
  ADAPTIVE_IMAGE_POLL_POLICY,
  completedImageTransportSubmission,
  completedImageTransportTask,
  type ImageGenerationTransport,
  type ImageTransportInputSupport,
  type ImageTransportTaskContext,
  type ImageTransportTaskState,
  submittedImageTransportSubmission,
  type TaskImageGenerationTransport
} from '../imageTransport'
import { createImageTransportErrorResponseHandler, withImageTransportRequestTimeout } from '../imageTransportHttp'

/**
 * TokenHub (Tencent MaaS) Hunyuan image transport.
 *
 * The registry declares the per-model routing (`vendorTransport`):
 *   - `hy-image-v3.0` → POST `/v1/api/image/submit` → poll `/v1/api/image/query`
 *   - `hy-image-lite` → POST `/v1/api/image/lite` (synchronous, `isSync`)
 *
 * API contract: https://cloud.tencent.com/document/product/1823/130080 —
 * submit returns `{ id, status: 'queued' }`; query takes `{ model, id }` and
 * returns `{ status, data: [{ url }] }`; params are the Hunyuan job fields in
 * snake_case (`LogoAdd` → `logo_add`).
 */

export const TOKENHUB_PROVIDER_NAME = 'tokenhub' as const

export const DEFAULT_TOKENHUB_ORIGIN = 'https://tokenhub.tencentmaas.com'

const QUERY_ENDPOINT = '/v1/api/image/query'

/** Hunyuan `resolution` ("width:height") per registry aspect-ratio option. */
const ASPECT_RATIO_RESOLUTIONS: Record<string, string> = {
  '1:1': '1024:1024',
  '4:3': '1024:768',
  '3:4': '768:1024',
  '16:9': '1280:720',
  '9:16': '720:1280'
}

const tokenhubImageDataSchema = z.object({ url: z.string().min(1) }).passthrough()
const tokenhubSubmitResultSchema = z.object({ id: z.string().min(1) }).passthrough()
const tokenhubSyncResultSchema = z.object({ data: z.array(tokenhubImageDataSchema) }).passthrough()
const tokenhubQueryResultSchema = z
  .object({
    status: z.enum([
      'queued',
      'running',
      'completed',
      'succeeded',
      'success',
      'failed',
      'error',
      'cancelled',
      'canceled'
    ]),
    data: z.array(tokenhubImageDataSchema).optional()
  })
  .passthrough()

/**
 * The vendor bag as this transport reads it. Derived from {@link ParamValues} so every
 * canonical key is CHECKED against `IMAGE_PARAM_CATALOG` — the IPC boundary strips
 * anything else, so a hand-declared non-catalog name is a field that can never arrive.
 */
export type TokenhubProviderParams = Pick<VendorBag, 'negativePrompt' | 'addWatermark'>

const FAILED_STATUSES = new Set(['failed', 'error', 'cancelled', 'canceled'])
const COMPLETED_STATUSES = new Set(['completed', 'succeeded', 'success'])

export interface TokenhubTransportSettings {
  apiKey: string
  /** Host origin; the registry `vendorTransport.endpoint` paths are host-absolute. */
  origin?: string
  headers?: Record<string, string | undefined>
  fetch?: FetchFunction
}

class TokenhubTransport implements TaskImageGenerationTransport<TokenhubProviderParams> {
  private readonly apiKey: string
  private readonly origin: string
  private readonly headers: Record<string, string | undefined> | undefined
  private readonly fetch: FetchFunction | undefined

  readonly task: TaskImageGenerationTransport<TokenhubProviderParams>['task'] = {
    kind: 'supported' as const,
    pollPolicy: ADAPTIVE_IMAGE_POLL_POLICY,
    query: (taskId: string, context: Parameters<TokenhubTransport['query']>[1]) => this.query(taskId, context),
    cancel: { kind: 'unsupported' as const }
  }

  constructor(settings: TokenhubTransportSettings) {
    this.apiKey = settings.apiKey
    this.origin = settings.origin || DEFAULT_TOKENHUB_ORIGIN
    this.headers = settings.headers
    this.fetch = settings.fetch
  }

  /** Hunyuan's text-to-image body has no image or mask slot for any model. */
  supportsInput(): ImageTransportInputSupport {
    return { files: false, mask: false }
  }

  async submit(input: ImageGenerationSubmitInput<TokenhubProviderParams>) {
    const descriptor = input.modelDescriptor
    if (!descriptor) {
      throw new Error(`Unknown model: ${input.modelId}`)
    }

    const bag = input.providerParams
    const resolution = input.aspectRatio ? ASPECT_RATIO_RESOLUTIONS[input.aspectRatio] : undefined
    const body: Record<string, unknown> = {
      model: descriptor.id,
      prompt: input.prompt,
      ...(input.seed !== undefined && { seed: input.seed }),
      ...(bag.negativePrompt && { negative_prompt: bag.negativePrompt }),
      ...(typeof bag.addWatermark === 'boolean' && { logo_add: bag.addWatermark }),
      ...(resolution && { resolution })
    }

    if (descriptor.isSync) {
      // hy-image-lite: OpenAI-style synchronous endpoint, finished images in `data`.
      const url = `${this.origin}${descriptor.endpoint}`
      const result = await withImageTransportRequestTimeout(
        { url, timeoutMs: 120_000, signal: input.signal },
        (signal) =>
          postJsonToApi({
            url,
            headers: combineHeaders({ Authorization: `Bearer ${this.apiKey}` }, this.headers, input.headers),
            body: { ...body, rsp_img_type: 'url' },
            abortSignal: signal,
            fetch: this.fetch,
            failedResponseHandler: createImageTransportErrorResponseHandler('TokenHub API error'),
            successfulResponseHandler: createJsonResponseHandler(tokenhubSyncResultSchema)
          })
      )
      return completedImageTransportSubmission(extractImageUrls(result.value.data), 'TokenHub')
    }

    const url = `${this.origin}${descriptor.endpoint}`
    const result = await withImageTransportRequestTimeout({ url, timeoutMs: 120_000, signal: input.signal }, (signal) =>
      postJsonToApi({
        url,
        headers: combineHeaders({ Authorization: `Bearer ${this.apiKey}` }, this.headers, input.headers),
        body,
        abortSignal: signal,
        fetch: this.fetch,
        failedResponseHandler: createImageTransportErrorResponseHandler('TokenHub API error'),
        successfulResponseHandler: createJsonResponseHandler(tokenhubSubmitResultSchema)
      })
    )
    return submittedImageTransportSubmission(result.value.id, `TokenHub image submit for '${descriptor.id}'`)
  }

  private async query(
    taskId: string,
    context: ImageTransportTaskContext<TokenhubProviderParams, AbortSignal>
  ): Promise<ImageTransportTaskState> {
    const modelId = context.modelDescriptor?.id
    if (!modelId) {
      throw new Error('TokenHub task query requires a persisted modelDescriptor')
    }
    const url = `${this.origin}${QUERY_ENDPOINT}`
    const result = await withImageTransportRequestTimeout(
      { url, timeoutMs: 10_000, signal: context.signal },
      (signal) =>
        postJsonToApi({
          url,
          headers: combineHeaders({ Authorization: `Bearer ${this.apiKey}` }, this.headers, context.headers),
          body: { model: modelId, id: taskId },
          abortSignal: signal,
          fetch: this.fetch,
          failedResponseHandler: createImageTransportErrorResponseHandler('TokenHub API error'),
          successfulResponseHandler: createJsonResponseHandler(tokenhubQueryResultSchema)
        })
    )
    if (COMPLETED_STATUSES.has(result.value.status)) {
      return completedImageTransportTask(extractImageUrls(result.value.data ?? []), 'TokenHub task')
    }
    if (FAILED_STATUSES.has(result.value.status)) {
      return { kind: 'failed', message: `TokenHub image task ${result.value.status}` }
    }
    return { kind: 'pending' }
  }
}

function extractImageUrls(data: Array<{ url: string }>): string[] {
  return data.map((item) => item.url)
}

/**
 * Build the TokenHub image transport from the generic openai-compatible provider
 * settings (tokenhub has no bespoke SDK provider — chat rides the openai-compatible
 * adapter). The chat `baseURL` (`https://tokenhub.tencentmaas.com/v1`) is reduced
 * to its origin; the registry endpoints are host-absolute paths.
 */
export function buildTokenhubTransport(settings: {
  apiKey?: string
  baseURL?: string
  headers?: Record<string, string | undefined>
  fetch?: FetchFunction
}): ImageGenerationTransport<VendorBag> {
  let origin: string | undefined
  try {
    origin = settings.baseURL ? new URL(settings.baseURL).origin : undefined
  } catch {
    origin = undefined
  }
  return new TokenhubTransport({
    apiKey: settings.apiKey ?? '',
    origin,
    headers: settings.headers,
    fetch: settings.fetch
  })
}
