import { randomUUID } from 'node:crypto'

import { APICallError } from '@ai-sdk/provider'
import {
  createBinaryResponseHandler,
  createJsonResponseHandler,
  type FetchFunction,
  getFromApi,
  normalizeHeaders,
  postJsonToApi
} from '@ai-sdk/provider-utils'
import * as z from 'zod'

import { loggerService } from '@logger'
import type { VendorBag } from '@main/ai/utils/imageOptions'
import { t } from '@main/i18n'
import { createPaintingGenerateError } from '@shared/ai/paintingGenerateError'

import {
  completedImageTransportTask,
  submittedImageTransportSubmission,
  type ImageGenerationSubmitInput,
  type ImageTransportTaskContext,
  type ImageTransportTaskState,
  type TaskImageGenerationTransport
} from '../imageTransport'
import { combineImageTransportHeaders, createImageTransportErrorResponseHandler } from '../imageTransportHttp'
import { type ComfyuiRequestOptions, normalizeComfyuiBaseUrl, requestJson, withDeadline } from './comfyuiHttp'
import { WORKFLOW_DIR, WORKFLOW_FILE_EXTENSION } from './comfyuiWorkflows'
import { applySeed, convertUiWorkflowToPrompt, findPromptTarget, hasPromptText, type ObjectInfo } from './uiToApiPrompt'

/**
 * ComfyUI transport: expand a saved workflow into a prompt, submit it, then poll
 * the queue and pull the rendered images back. Which workflows exist is the
 * listing's business (`comfyuiWorkflowDiscovery`), not this loop's.
 *
 * ComfyUI is driven by a node graph rather than a prompt string, so a workflow
 * supplies everything except the prompt: the node that receives it is found by
 * following the sampler's positive conditioning.
 */

const logger = loggerService.withContext('comfyui')

export const DEFAULT_COMFYUI_BASE_URL = 'http://localhost:8188'

const POLL_INTERVAL_MS = 1500
const POLL_TIMEOUT_MS = 10 * 60 * 1000
const IMAGE_TIMEOUT_MS = 60 * 1000
const CAPABILITY_TIMEOUT_MS = 5000
/** `/object_info` and the `/prompt` submit on an install with many custom nodes. */
const SUBMIT_TIMEOUT_MS = 60 * 1000

/** Minimum ComfyUI version where `/interrupt` honours `prompt_id`.
 *  Upstream: commit 464ba1d6 (#9607), first shipped in v0.3.57.
 *  Older servers execute a global interrupt regardless of `prompt_id`
 *  and can unintentionally stop an unrelated generation. */
const MIN_TARGETED_INTERRUPT_VERSION = [0, 3, 57] as const

/** Parse a strict `major.minor.patch` version string (e.g. `"0.3.57"`, `"0.36.0"`).
 *  Returns `null` for anything else: pre-release suffixes (`-rc1`), build
 *  metadata (`+build`), `v` prefixes, missing components, or extra dots.
 *  We intentionally never treat non-formal versions as comparable — the
 *  safety gate must fail-closed, not guess. */
export function parseVersion(v: string): [number, number, number] | null {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return null
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)]
}

/** Returns `true` when `a` is lexicographically >= `b` component-wise. */
function isAtLeastVersion(a: [number, number, number], b: readonly [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true
    if (a[i] < b[i]) return false
  }
  return true
}

/** What this ComfyUI server can prove about cancellation targeting. */
export interface ComfyuiCancelCapabilities {
  /** True when POST /interrupt honours prompt_id and the server
   *  guarantees it is scoped to that prompt (checked server-side
   *  after this client reads the queue). */
  targetedInterrupt: boolean
}

/** Per-request overrides are the HTTP surface's; this is the transport's own. */
export interface ComfyuiTransportSettings extends ComfyuiRequestOptions {
  baseURL?: string
}

const submitResponseSchema = z.object({ prompt_id: z.string().min(1) })
const imageSchema = z.object({
  filename: z.string().min(1),
  subfolder: z.string().optional(),
  type: z.string().optional()
})
const historySchema = z.record(
  z.string(),
  z.object({
    outputs: z.record(z.string(), z.object({ images: z.array(imageSchema).optional() })),
    status: z.object({ status_str: z.enum(['success', 'error']), messages: z.array(z.unknown()).optional() })
  })
)
const statsSchema = z.object({ system: z.object({ comfyui_version: z.string().optional() }).optional() })

/** Per-transport short-lived timeouts to prevent forever-pending HTTP calls. */
const CANCEL_QUEUE_TIMEOUT_MS = 5000

/**
 * Turn ComfyUI's validation payload into something a user can act on. The
 * server's messages are kept verbatim — they name the offending node and input —
 * and are wrapped in a structured `REMOTE_ERROR` carrying a localized fallback
 * when the body says nothing useful.
 */
async function describePromptError(response: Response, signal?: AbortSignal): Promise<string> {
  const fallback = t('paintings.comfyui.workflow_rejected', { status: response.status })
  let bodyText = ''
  try {
    bodyText = await response.text()
  } catch (error) {
    // A caller cancel during the read is a cancel: reporting the rejected
    // workflow here would surface it as a failed generation.
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw new DOMException('Prompt response aborted', 'AbortError')
    }
  }
  if (!bodyText) return fallback
  let payload: {
    error?: { message?: string; details?: string }
    node_errors?: Record<string, { errors?: Array<{ message?: string; details?: string }> }>
  }
  try {
    payload = JSON.parse(bodyText)
  } catch {
    return bodyText.slice(0, 300) || fallback
  }
  const parts: string[] = []
  if (payload?.error?.message) parts.push(payload.error.message)
  if (payload?.error?.details) parts.push(payload.error.details)
  for (const [nodeId, entry] of Object.entries(payload?.node_errors ?? {})) {
    for (const error of entry?.errors ?? []) {
      parts.push(`node ${nodeId}: ${error.message ?? ''} ${error.details ?? ''}`.trim())
    }
  }
  return parts.length > 0 ? parts.join('; ') : fallback
}

class ComfyuiTransport implements TaskImageGenerationTransport<VendorBag> {
  private readonly baseURL: string
  private readonly headers: Record<string, string>
  private readonly doFetch: FetchFunction
  // Retry failed probes; only successful server capability reads are cached.
  private capabilitiesPromise?: Promise<ComfyuiCancelCapabilities>

  readonly task: TaskImageGenerationTransport<VendorBag>['task'] = {
    kind: 'supported',
    pollPolicy: {
      initialDelayMs: 0,
      maxAttempts: null,
      maxElapsedMs: POLL_TIMEOUT_MS,
      maxConsecutiveErrors: Number.POSITIVE_INFINITY,
      getDelayMs: () => POLL_INTERVAL_MS
    },
    query: (taskId, context) => this.query(taskId, context),
    cancel: { kind: 'supported', cancelRemote: (taskId, context) => this.cancelRemote(taskId, context.headers) }
  }

  supportsInput() {
    return { files: false, mask: false }
  }

  constructor(settings: ComfyuiTransportSettings) {
    this.baseURL = normalizeComfyuiBaseUrl(settings.baseURL || DEFAULT_COMFYUI_BASE_URL)
    this.headers = settings.headers ?? {}
    this.doFetch = settings.fetch ?? fetch
  }

  async submit(input: ImageGenerationSubmitInput) {
    const workflowPath = `${WORKFLOW_DIR}/${input.modelId}${WORKFLOW_FILE_EXTENSION}`
    const headers = combineImageTransportHeaders(this.headers, input.headers)
    const requestOptions = { headers: normalizeHeaders(headers), fetch: this.doFetch }
    const [workflow, objectInfo] = await Promise.all([
      // `/userdata/{file}` matches a single path segment, so the separator has to be
      // percent-encoded — `/userdata/workflows/x.json` is a 404, `%2F` is not. The
      // ComfyUI frontend encodes the same parameter.
      requestJson<Parameters<typeof convertUiWorkflowToPrompt>[0]>(
        `${this.baseURL}/userdata/${encodeURIComponent(workflowPath)}`,
        t('paintings.comfyui.request_failed'),
        input.signal,
        requestOptions,
        SUBMIT_TIMEOUT_MS
      ),
      requestJson<ObjectInfo>(
        `${this.baseURL}/object_info`,
        t('paintings.comfyui.request_failed'),
        input.signal,
        requestOptions,
        SUBMIT_TIMEOUT_MS
      )
    ])

    const { prompt: graph, warnings, promotedText } = convertUiWorkflowToPrompt(workflow, objectInfo)
    for (const warning of warnings) logger.warn(`workflow conversion: ${warning}`)

    const target = findPromptTarget(graph, { promotedText, objectInfo })
    // A workflow that holds no text at all — an upscaler, a background remover,
    // a depth estimator — takes no prompt and runs as it was saved. One that
    // holds text we could not place is still an error: generating with the
    // workflow's own text instead of the run's is worse than refusing.
    if (!target && hasPromptText(graph)) {
      throw createPaintingGenerateError('REMOTE_ERROR', {
        message: t('paintings.comfyui.no_prompt_node', { workflow: input.modelId })
      })
    }
    if (target) {
      graph[target.nodeId].inputs[target.input] = input.prompt ?? ''
      applySeed(graph, input.seed, target.samplerId)
    } else {
      // Nothing in the graph says which node the run's seed belongs to, so the
      // whole run — the seed included — stays exactly as the workflow saved it.
      logger.warn(`workflow ${input.modelId} holds no prompt; running it as it was saved`)
    }

    // The submit and its body share one deadline, and we name the prompt: a lost
    // response still leaves the id ours to cancel. ComfyUI v0.37+ rejects a
    // `prompt_id` that is not a canonical UUID before it queues anything.
    const requestedPromptId = randomUUID()
    try {
      const { value } = await withDeadline(
        input.signal,
        SUBMIT_TIMEOUT_MS,
        t('paintings.comfyui.request_timeout', { seconds: SUBMIT_TIMEOUT_MS / 1000 }),
        (abortSignal) =>
          postJsonToApi({
            url: this.baseURL + '/prompt',
            headers,
            body: { prompt: graph, client_id: 'cherry-studio-' + Date.now(), prompt_id: requestedPromptId },
            abortSignal,
            fetch: this.doFetch,
            failedResponseHandler: async ({ response, url, requestBodyValues }) => ({
              value: new APICallError({
                message: await describePromptError(response, input.signal),
                url,
                requestBodyValues,
                statusCode: response.status
              })
            }),
            successfulResponseHandler: createJsonResponseHandler(submitResponseSchema)
          })
      )
      return submittedImageTransportSubmission(value.prompt_id, 'ComfyUI')
    } catch (error) {
      // A lost submit response can still own queued work under the UUID we sent.
      void this.cancelRemote(requestedPromptId, input.headers).catch((cancelError) =>
        logger.warn('ComfyUI submit cleanup failed; the remote task may continue', {
          taskId: requestedPromptId,
          error: cancelError
        })
      )
      throw error
    }
  }

  private async query(
    taskId: string,
    context: ImageTransportTaskContext<VendorBag, AbortSignal>
  ): Promise<ImageTransportTaskState> {
    const headers = combineImageTransportHeaders(this.headers, context.headers)
    const { value: history } = await getFromApi({
      url: this.baseURL + '/history/' + taskId,
      headers,
      abortSignal: context.signal,
      fetch: this.doFetch,
      failedResponseHandler: createImageTransportErrorResponseHandler(),
      successfulResponseHandler: createJsonResponseHandler(historySchema)
    })
    // ComfyUI adds a history entry only after execution; absence is its pending signal.
    const entry = history[taskId]
    if (!entry) return { kind: 'pending' }
    if (entry.status.status_str === 'error') {
      return {
        kind: 'failed',
        message: (
          t('paintings.comfyui.workflow_failed') +
          ' ' +
          JSON.stringify(entry.status.messages ?? []).slice(0, 500)
        ).trim()
      }
    }
    const images = Object.values(entry.outputs).flatMap((output) => output.images ?? [])
    if (images.length === 0) return { kind: 'failed', message: t('paintings.comfyui.no_image') }
    return completedImageTransportTask(
      await Promise.all(images.map((image) => this.fetchImage(image, context))),
      'ComfyUI'
    )
  }

  private async getCancelCapabilities(headers: Record<string, string | undefined>): Promise<ComfyuiCancelCapabilities> {
    if (this.capabilitiesPromise) return this.capabilitiesPromise
    this.capabilitiesPromise = withDeadline(
      undefined,
      CAPABILITY_TIMEOUT_MS,
      t('paintings.comfyui.request_timeout', { seconds: CAPABILITY_TIMEOUT_MS / 1000 }),
      (abortSignal) =>
        getFromApi({
          url: this.baseURL + '/system_stats',
          headers,
          abortSignal,
          fetch: this.doFetch,
          failedResponseHandler: createImageTransportErrorResponseHandler(),
          successfulResponseHandler: createJsonResponseHandler(statsSchema)
        })
    )
      .then(({ value }) => {
        const version = value.system?.comfyui_version
        const parsed = version === undefined ? null : parseVersion(version)
        return { targetedInterrupt: parsed !== null && isAtLeastVersion(parsed, MIN_TARGETED_INTERRUPT_VERSION) }
      })
      .catch(() => {
        this.capabilitiesPromise = undefined
        return { targetedInterrupt: false }
      })
    return this.capabilitiesPromise
  }

  private async cancelRemote(taskId: string, callHeaders: ImageGenerationSubmitInput['headers']): Promise<void> {
    const headers = combineImageTransportHeaders(this.headers, callHeaders)
    // Both writes are ID-scoped; neither waits for a racy queue snapshot.
    const results = await Promise.allSettled([
      this.cancelWrite('/queue', { delete: [taskId] }, headers),
      this.getCancelCapabilities(headers).then(async (caps) => {
        if (!caps.targetedInterrupt)
          throw new Error('ComfyUI cannot interrupt a single running prompt (needs v0.3.57+)')
        await this.cancelWrite('/interrupt', { prompt_id: taskId }, headers)
      })
    ])
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason
    }
  }

  private async cancelWrite(
    path: string,
    body: { delete: string[] } | { prompt_id: string },
    headers: Record<string, string | undefined>
  ): Promise<void> {
    await withDeadline(
      undefined,
      CANCEL_QUEUE_TIMEOUT_MS,
      t('paintings.comfyui.request_timeout', { seconds: CANCEL_QUEUE_TIMEOUT_MS / 1000 }),
      (abortSignal) =>
        postJsonToApi({
          url: this.baseURL + path,
          headers,
          body,
          abortSignal,
          fetch: this.doFetch,
          failedResponseHandler: createImageTransportErrorResponseHandler(),
          // ComfyUI acknowledges queue/interrupt writes with an empty 200 response.
          successfulResponseHandler: async ({ response }) => ({ value: await response.text() })
        })
    )
  }

  private async fetchImage(
    image: z.infer<typeof imageSchema>,
    context: ImageTransportTaskContext<VendorBag, AbortSignal>
  ): Promise<string> {
    const query = new URLSearchParams({
      filename: image.filename,
      subfolder: image.subfolder ?? '',
      type: image.type ?? 'output'
    })
    const { value, responseHeaders } = await withDeadline(
      context.signal,
      IMAGE_TIMEOUT_MS,
      t('paintings.comfyui.image_download_timeout', { seconds: IMAGE_TIMEOUT_MS / 1000 }),
      (abortSignal) =>
        getFromApi({
          url: this.baseURL + '/view?' + query,
          headers: combineImageTransportHeaders(this.headers, context.headers),
          abortSignal,
          fetch: this.doFetch,
          failedResponseHandler: createImageTransportErrorResponseHandler(),
          successfulResponseHandler: createBinaryResponseHandler()
        })
    )
    if (value.length === 0) throw new Error('ComfyUI returned an empty image')
    return (
      'data:' + (responseHeaders?.['content-type'] || 'image/png') + ';base64,' + Buffer.from(value).toString('base64')
    )
  }
}

export function createComfyuiTransport(settings: ComfyuiTransportSettings): ComfyuiTransport {
  return new ComfyuiTransport(settings)
}

export type { ComfyuiTransport }
