import type { ParamValues } from '@cherrystudio/provider-registry'
import { DEFAULT_TIMEOUT } from '@main/ai/constants'

import type {
  ImageGenerationSubmitInput,
  ImageGenerationTransport,
  ImageTransportInputSupport
} from '../imageGenerationModel'
import { createAbortError, isTerminalHttpStatus, waitWithSignal } from '../transportUtils'

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

export class TokenhubApiError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message)
    this.name = 'TokenhubApiError'
  }
}

/** Terminal failure reported by the image job's `status`. */
export class TokenhubTaskFailedError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'TokenhubTaskFailedError'
  }
}

interface TokenhubImageData {
  url?: string
  revised_prompt?: string
}

interface TokenhubSubmitResult {
  id?: string
  status?: string
  data?: TokenhubImageData[]
}

interface TokenhubQueryResult {
  status?: string
  data?: TokenhubImageData[]
}

/**
 * The vendor bag as this transport reads it. Derived from {@link ParamValues} so every
 * canonical key is CHECKED against `IMAGE_PARAM_CATALOG` — the IPC boundary strips
 * anything else, so a hand-declared non-catalog name is a field that can never arrive.
 */
type TokenhubProviderParams = Pick<ParamValues, 'negativePrompt' | 'addWatermark'> & {
  /** SDK-path progress callback; the job path reports via `ctx.reportProgress`. */
  onProgress?: (progress: number) => void
}

const FAILED_STATUSES = new Set(['failed', 'error', 'cancelled', 'canceled'])
const COMPLETED_STATUSES = new Set(['completed', 'succeeded', 'success'])

export interface TokenhubTransportSettings {
  apiKey: string
  /** Host origin; the registry `vendorTransport.endpoint` paths are host-absolute. */
  origin?: string
}

class TokenhubTransport implements ImageGenerationTransport {
  private apiKey: string
  private origin: string
  /** taskId → model id, for the query body; a restart-resumed poll on a fresh
   *  instance falls back to `options.modelDescriptor.id`. */
  private taskModelIds = new Map<string, string>()

  constructor(settings: TokenhubTransportSettings) {
    this.apiKey = settings.apiKey
    this.origin = settings.origin || DEFAULT_TOKENHUB_ORIGIN
  }

  private async request<T>(
    endpoint: string,
    body: Record<string, unknown>,
    requestOptions?: { timeout?: number; signal?: AbortSignal }
  ): Promise<T> {
    const timeout = requestOptions?.timeout ?? DEFAULT_TIMEOUT
    const externalSignal = requestOptions?.signal
    const url = `${this.origin}${endpoint}`
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

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      })
      if (!response.ok) {
        const errorText = (await response.text().catch(() => '')).slice(0, 500)
        throw new TokenhubApiError(`TokenHub API error: ${response.status} - ${errorText}`, response.status)
      }
      return (await response.json()) as T
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        if (externallyAborted) throw createAbortError('TokenHub API request aborted')
        throw new Error(`TokenHub API request timeout after ${timeout / 1000}s`)
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
      externalSignal?.removeEventListener('abort', onExternalAbort)
    }
  }

  /** Hunyuan's text-to-image body has no image or mask slot for any model. */
  supportsInput(): ImageTransportInputSupport {
    return { files: false, mask: false }
  }

  async submit(input: ImageGenerationSubmitInput): Promise<{ taskId?: string; imageUrls?: string[] }> {
    const descriptor = input.modelDescriptor
    if (!descriptor) {
      throw new Error(`Unknown model: ${input.modelId}`)
    }

    const bag = input.providerParams as TokenhubProviderParams
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
      const result = await this.request<TokenhubSubmitResult>(
        descriptor.endpoint,
        { ...body, rsp_img_type: 'url' },
        { timeout: 120000, signal: input.signal }
      )
      return { imageUrls: extractImageUrls(result.data) }
    }

    const result = await this.request<TokenhubSubmitResult>(descriptor.endpoint, body, {
      timeout: 120000,
      signal: input.signal
    })
    if (!result.id) {
      throw new Error(`TokenHub image submit for '${descriptor.id}' returned no task id`)
    }
    this.taskModelIds.set(result.id, descriptor.id)
    return { taskId: result.id }
  }

  async poll(
    taskId: string,
    options: {
      signal?: AbortSignal
      onProgress?: (progress: number) => void
      modelDescriptor?: { id: string }
    }
  ): Promise<string[]> {
    const { signal } = options
    const modelId = this.taskModelIds.get(taskId) ?? options.modelDescriptor?.id
    if (!modelId) {
      throw new Error('TokenHub poll requires the model id (submit on this instance or a modelDescriptor)')
    }

    const maxAttempts = 120
    const maxTransientRetries = 10
    let attempts = 0
    let transientRetries = 0
    const startTime = Date.now()

    // The map entry outlives every exit from this loop unless it is cleared here:
    // failure, abort and timeout all leave `poll` by `throw`, and TokenHub has no
    // `cancel()` to clean up after them — so a failed task used to pin its model id
    // for the lifetime of the transport instance.
    try {
      while (attempts < maxAttempts) {
        if (signal?.aborted) {
          throw createAbortError('Task polling aborted')
        }
        try {
          const result = await this.request<TokenhubQueryResult>(
            QUERY_ENDPOINT,
            { model: modelId, id: taskId },
            { timeout: 10000, signal }
          )
          transientRetries = 0
          const status = result.status?.toLowerCase() ?? ''
          if (COMPLETED_STATUSES.has(status)) {
            return extractImageUrls(result.data) ?? []
          }
          if (FAILED_STATUSES.has(status)) {
            throw new TokenhubTaskFailedError(`TokenHub image task ${status}`)
          }
          // 'queued' / 'running' / any unknown-but-not-failed status: keep polling.
        } catch (error) {
          if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
            throw createAbortError('Task polling aborted')
          }
          if (error instanceof TokenhubTaskFailedError) throw error
          if (error instanceof TokenhubApiError && isTerminalHttpStatus(error.statusCode)) throw error
          transientRetries++
          if (transientRetries >= maxTransientRetries) {
            throw error instanceof Error ? error : new Error(String(error))
          }
        }

        const elapsedTime = Date.now() - startTime
        await waitWithSignal(elapsedTime < 60000 ? 3000 : 10000, signal)
        attempts++
      }

      throw new Error('Task polling timeout')
    } finally {
      this.taskModelIds.delete(taskId)
    }
  }
}

function extractImageUrls(data: TokenhubImageData[] | undefined): string[] | undefined {
  if (!data) return undefined
  return data.map((item) => item.url).filter((url): url is string => typeof url === 'string' && url.length > 0)
}

/**
 * Build the TokenHub image transport from the generic openai-compatible provider
 * settings (tokenhub has no bespoke SDK provider — chat rides the openai-compatible
 * adapter). The chat `baseURL` (`https://tokenhub.tencentmaas.com/v1`) is reduced
 * to its origin; the registry endpoints are host-absolute paths.
 */
export function buildTokenhubTransport(settings: { apiKey?: string; baseURL?: string }): ImageGenerationTransport {
  let origin: string | undefined
  try {
    origin = settings.baseURL ? new URL(settings.baseURL).origin : undefined
  } catch {
    origin = undefined
  }
  return new TokenhubTransport({ apiKey: settings.apiKey ?? '', origin })
}
