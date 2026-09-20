import type { FetchFunction } from '@ai-sdk/provider-utils'

import { loggerService } from '@logger'
import { t } from '@main/i18n'
import { createPaintingGenerateError, PaintingGenerateError } from '@shared/ai/paintingGenerateError'

import type {
  ImageGenerationSubmitInput,
  ImageGenerationTransport,
  ImageTransportDescriptor
} from '../imageGenerationModel'
import { readErrorMessage } from '../readErrorMessage'
import { createAbortError, isTerminalHttpStatus, waitWithSignal } from '../transportUtils'
import {
  convertUiWorkflowToPrompt,
  findPromptTarget,
  isReference,
  type ApiPromptNode,
  type ObjectInfo
} from './uiToApiPrompt'

/**
 * ComfyUI transport: list the user's saved workflows, expand one into a prompt,
 * submit it, then poll the queue and pull the rendered images back.
 *
 * ComfyUI is driven by a node graph rather than a prompt string, so a workflow
 * supplies everything except the prompt: the node that receives it is found by
 * following the sampler's positive conditioning.
 */

const logger = loggerService.withContext('comfyui')

export const DEFAULT_COMFYUI_BASE_URL = 'http://localhost:8188'

const WORKFLOW_DIR = 'workflows'
const POLL_INTERVAL_MS = 1500
const POLL_TIMEOUT_MS = 10 * 60 * 1000
const IMAGE_TIMEOUT_MS = 60 * 1000
const CAPABILITY_TIMEOUT_MS = 5000

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

/** Per-request overrides shared by the transport and the standalone helpers. */
export interface ComfyuiRequestOptions {
  /** Extra headers, e.g. the provider's configured extra headers. */
  headers?: Record<string, string>
  /** Overrides `fetch` for every request. */
  fetch?: FetchFunction
}

export interface ComfyuiTransportSettings extends ComfyuiRequestOptions {
  baseURL?: string
}

/** One `/history/{id}` entry: the images it produced, or the failure it reported. */
interface HistoryEntry {
  outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }>
  status?: { status_str?: string; messages?: unknown[] }
}

/** Per-transport short-lived timeouts to prevent forever-pending HTTP calls. */
const CANCEL_QUEUE_TIMEOUT_MS = 5000

interface UserDataEntry {
  name: string
  type: string
  /** Path relative to the user data root (`workflows/sub/x.json`); the listing
   * walks subdirectories, so `name` alone is only the basename. */
  path?: string
}

export const WORKFLOW_FILE_EXTENSION = '.json'

/** Saved workflow names, newest first. Directories and non-workflow files are skipped. */
export async function listWorkflows(
  baseURL: string,
  signal?: AbortSignal,
  options: ComfyuiRequestOptions = {}
): Promise<string[]> {
  const entries = await requestJson<UserDataEntry[]>(
    `${baseURL}/v2/userdata?path=${WORKFLOW_DIR}`,
    t('paintings.comfyui.list_failed'),
    signal,
    options
  )
  const prefix = `${WORKFLOW_DIR}/`
  return entries
    .filter((entry) => entry.type === 'file' && entry.name.endsWith(WORKFLOW_FILE_EXTENSION))
    .map((entry) => {
      // The listing walks subdirectories, so a workflow in one arrives with the
      // basename in `name` and its real location in `path`. Keep the relative
      // path as the handle: it is what resolves again when the workflow is read
      // back and submitted.
      const relative = (entry.path ?? `${WORKFLOW_DIR}/${entry.name}`).replace(/^\/+/, '')
      const workflowPath = relative.startsWith(prefix) ? relative.slice(prefix.length) : relative
      return workflowPath.slice(0, -WORKFLOW_FILE_EXTENSION.length)
    })
}

/**
 * The one place a GET is issued: the listing and every read the transport makes
 * go through it, so the headers, the fetch override and the structured failure
 * have a single owner. The caller resolves its own fallback message: the i18n
 * gate only accepts a key written literally where the helper is called.
 */
async function requestJson<T>(
  url: string,
  fallback: string,
  signal?: AbortSignal,
  options: ComfyuiRequestOptions = {}
): Promise<T> {
  const doFetch = options.fetch ?? fetch
  const response = await doFetch(url, { signal, headers: options.headers })
  if (!response.ok) {
    throw createPaintingGenerateError('REMOTE_ERROR', {
      message: await readErrorMessage(response, fallback)
    })
  }
  return (await response.json()) as T
}

/**
 * Turn ComfyUI's validation payload into something a user can act on. The
 * server's messages are kept verbatim — they name the offending node and input —
 * and are wrapped in a structured `REMOTE_ERROR` carrying a localized fallback
 * when the body says nothing useful.
 */
async function describePromptError(response: Response): Promise<string> {
  const fallback = t('paintings.comfyui.workflow_rejected', { status: response.status })
  const bodyText = await response.text().catch(() => '')
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

class ComfyuiTransport implements ImageGenerationTransport {
  private readonly baseURL: string
  private readonly headers: Record<string, string>
  private readonly doFetch: FetchFunction
  /** Cached target-specific interrupt capability promise. Resolved once on
   *  first `cancel()` call and cached for the transport's lifetime; failures
   *  are also cached (fail-closed: persistent false result, never retry). */
  private capabilitiesPromise?: Promise<ComfyuiCancelCapabilities>

  constructor(settings: ComfyuiTransportSettings) {
    this.baseURL = (settings.baseURL || DEFAULT_COMFYUI_BASE_URL).replace(/\/+$/, '')
    this.headers = settings.headers ?? {}
    this.doFetch = settings.fetch ?? fetch
  }

  async submit(input: ImageGenerationSubmitInput): Promise<{ taskId?: string; imageUrls?: string[] }> {
    const workflowPath = `${WORKFLOW_DIR}/${input.modelId}${WORKFLOW_FILE_EXTENSION}`
    const requestOptions = { headers: this.headers, fetch: this.doFetch }
    const [workflow, objectInfo] = await Promise.all([
      // `/userdata/{file}` matches a single path segment, so the separator has to be
      // percent-encoded — `/userdata/workflows/x.json` is a 404, `%2F` is not. The
      // ComfyUI frontend encodes the same parameter.
      requestJson<Parameters<typeof convertUiWorkflowToPrompt>[0]>(
        `${this.baseURL}/userdata/${encodeURIComponent(workflowPath)}`,
        t('paintings.comfyui.request_failed'),
        input.signal,
        requestOptions
      ),
      requestJson<ObjectInfo>(
        `${this.baseURL}/object_info`,
        t('paintings.comfyui.request_failed'),
        input.signal,
        requestOptions
      )
    ])

    const { prompt: graph, warnings } = convertUiWorkflowToPrompt(workflow, objectInfo)
    for (const warning of warnings) logger.warn(`workflow conversion: ${warning}`)

    const target = findPromptTarget(graph)
    if (!target) {
      throw createPaintingGenerateError('REMOTE_ERROR', {
        message: t('paintings.comfyui.no_prompt_node', { workflow: input.modelId })
      })
    }
    graph[target.nodeId].inputs[target.input] = input.prompt ?? ''
    applySeed(graph, input.seed, target.samplerId)

    const response = await this.doFetch(`${this.baseURL}/prompt`, {
      method: 'POST',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: graph, client_id: `cherry-studio-${Date.now()}` }),
      signal: input.signal
    })
    if (!response.ok) {
      throw createPaintingGenerateError('REMOTE_ERROR', { message: await describePromptError(response) })
    }
    const { prompt_id: promptId } = (await response.json()) as { prompt_id?: string }
    if (!promptId) {
      throw createPaintingGenerateError('REMOTE_ERROR', { message: t('paintings.comfyui.no_prompt_id') })
    }
    return { taskId: promptId }
  }

  async poll(
    taskId: string,
    options: {
      signal?: AbortSignal
      onProgress?: (progress: number) => void
      modelDescriptor?: ImageTransportDescriptor
    } = {}
  ): Promise<string[]> {
    const deadline = Date.now() + POLL_TIMEOUT_MS
    let ticks = 0
    while (Date.now() < deadline) {
      // Every cancellation path exits as the repo's AbortError convention
      // (`error.name === 'AbortError'`): the pre-flight check, an abort raised
      // inside the history request or the inter-tick sleep, and an abort racing
      // the response. Otherwise a user cancel is rethrown from the generic
      // catch below as a failed generation.
      if (options.signal?.aborted) throw createAbortError('Task polling aborted')
      try {
        const history = await this.fetchHistory(taskId, options.signal, deadline - Date.now())
        const entry = history[taskId]
        if (entry?.outputs && Object.keys(entry.outputs).length > 0) {
          const images = Object.values(entry.outputs).flatMap((output) => output.images ?? [])
          if (images.length === 0) {
            throw createPaintingGenerateError('REMOTE_ERROR', { message: t('paintings.comfyui.no_image') })
          }
          return await Promise.all(images.map((image) => this.fetchImage(image, options.signal)))
        }
        if (entry?.status?.status_str === 'error') {
          throw createPaintingGenerateError('REMOTE_ERROR', {
            message:
              `${t('paintings.comfyui.workflow_failed')} ${JSON.stringify(entry.status.messages ?? {}).slice(0, 500)}`.trim()
          })
        }
      } catch (error) {
        if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
          throw createAbortError('Task polling aborted')
        }
        // Structured failures (workflow error, no image, a terminal 4xx history
        // response) end the poll loop; anything else — a network blip, a 5xx or
        // a 429 on the history GET — retries until the overall deadline.
        if (error instanceof PaintingGenerateError) throw error
      }
      ticks += 1
      options.onProgress?.(Math.min(0.9, ticks * 0.05))
      await waitWithSignal(POLL_INTERVAL_MS, options.signal)
    }
    throw createPaintingGenerateError('REMOTE_ERROR', {
      message: t('paintings.comfyui.poll_timeout', { seconds: POLL_TIMEOUT_MS / 1000 })
    })
  }

  /**
   * Detect whether this ComfyUI server honours `prompt_id` on `/interrupt`.
   * Reads the server's version from `/system_stats` and compares against the
   * minimum version known to ship the targeted filter (≥ v0.3.57).
   *
   * On first call the capability is probed lazily and the result is cached
   * for the transport's lifetime.  Fail-closed: if the version endpoint is
   * missing, unparseable, or unreachable we return `{ targetedInterrupt:
   * false }` (the interrupt is never sent, but pending prompts can still be
   * dequeued).
   *
   * A short timeout protects against an unresponsive server permanently
   * pinning capability detection and silently disabling all future cancels.
   *
   * Caching is strict: only a fully successful probe (HTTP 200 + parse +
   * version read) is cached.  Timeouts, network errors, and JSON parse
   * failures **clear** the cached promise so the next `cancel()` retries.
   */
  private async getCancelCapabilities(): Promise<ComfyuiCancelCapabilities> {
    if (this.capabilitiesPromise) return this.capabilitiesPromise

    this.capabilitiesPromise = (async () => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), CAPABILITY_TIMEOUT_MS)
      try {
        const response = await this.doFetch(`${this.baseURL}/system_stats`, {
          headers: this.headers,
          signal: controller.signal
        })
        if (!response.ok) return { targetedInterrupt: false }
        const stats = (await response.json()) as Record<string, unknown>
        const verStr = (stats.system as Record<string, unknown>)?.comfyui_version as string | undefined
        if (!verStr) return { targetedInterrupt: false }

        const ver = parseVersion(verStr)
        return { targetedInterrupt: ver ? isAtLeastVersion(ver, MIN_TARGETED_INTERRUPT_VERSION) : false }
      } catch {
        // Any failure — timeout, network error, JSON parse — is NOT cached.
        // Clear so the next cancel() retries instead of reusing a stale false.
        this.capabilitiesPromise = undefined
        return { targetedInterrupt: false }
      } finally {
        clearTimeout(timer)
      }
    })()

    return this.capabilitiesPromise
  }

  /**
   * Cancel one generation. The two requests are not interchangeable: `POST
   * /queue {"delete": [id]}` drops a *pending* prompt and is id-scoped, while
   * `POST /interrupt {"prompt_id": id}` stops the one *executing* — and on a
   * server that predates the `prompt_id` filter (ComfyUI < v0.3.57) it is a
   * global kill.
   *
   * Capability-based design: detect once whether the server honours `prompt_id`
   * on `/interrupt` (by reading `/system_stats` and comparing the version).
   * When the server does not guarantee target-specific semantics we **skip the
   * interrupt entirely** rather than risk a global kill that can accidentally
   * stop an unrelated generation (the TOCTOU race between the queue snapshot
   * and the interrupt request is unavoidable over HTTP; gate on what the
   * server *proves* rather than the client's luck).
   *
   * Pending prompts are still removed by id because `POST /queue {"delete":
   * [...]}` is inherently id-scoped and unaffected by the race.
   */
  async cancel(taskId: string): Promise<void> {
    const action = await this.cancelAction(taskId)
    const headers = { ...this.headers, 'Content-Type': 'application/json' }
    if (action === 'running') {
      const caps = await this.getCancelCapabilities()
      if (caps.targetedInterrupt) {
        await this.doFetch(`${this.baseURL}/interrupt`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ prompt_id: taskId })
        }).catch(() => undefined)
      }
      // otherwise: intentionally no-op.  A server that does not guarantee
      // target-specific semantics must not be interrupted from the client
      // (the queue → interrupt round-trip cannot prove idempotence over HTTP).
    } else if (action === 'pending') {
      await this.doFetch(`${this.baseURL}/queue`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ delete: [taskId] })
      }).catch(() => undefined)
    }
  }

  /**
   * Which cancellation request `taskId` needs, from the server's queue:
   * `'running'` is interrupted, `'pending'` is dequeued. A queue entry keys
   * the prompt id at index 1 (`[number, prompt_id, prompt, extra_data,
   * outputs]`). An unreadable queue reports `'none'` — without proof the
   * prompt is ours, neither request is safe to send.
   *
   * Both the GET request and the JSON parse are bounded by `CANCEL_QUEUE_TIMEOUT_MS`
   * so a hung server cannot make `cancel()` wait forever.  On timeout or error
   * we return `'none'`, which leaves the task untouched.
   */
  private async cancelAction(taskId: string): Promise<'running' | 'pending' | 'none'> {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), CANCEL_QUEUE_TIMEOUT_MS)
      try {
        const response = await this.doFetch(`${this.baseURL}/queue`, {
          headers: this.headers,
          signal: controller.signal
        })
        if (!response.ok) return 'none'
        const queue = (await response.json()) as { queue_running?: unknown[][]; queue_pending?: unknown[][] }
        if (queue.queue_running?.some((item) => item[1] === taskId)) return 'running'
        if (queue.queue_pending?.some((item) => item[1] === taskId)) return 'pending'
        return 'none'
      } finally {
        clearTimeout(timer)
      }
    } catch {
      // Timeout or network error → queue unreadable → no write is safe.
      return 'none'
    }
  }

  /**
   * GET `url`, bounded by `timeoutMs` and combined with the caller's signal.
   * When this request's own deadline fires the failure is structured, with
   * `timeoutMessage`; every other rejection — the caller's cancellation, a
   * network error — is rethrown untouched, so a caller that needs to tell the
   * two apart can still inspect its own signal.
   */
  private async fetchWithDeadline(
    url: string,
    signal: AbortSignal | undefined,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.max(0, timeoutMs))
    try {
      return await this.doFetch(url, {
        signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
        headers: this.headers
      })
    } catch (error) {
      // The combined signal aborts for the caller's cancellation AND for this
      // request's own budget; only the latter is a deadline failure.
      if (controller.signal.aborted && !signal?.aborted) {
        throw createPaintingGenerateError('REMOTE_ERROR', { message: timeoutMessage })
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Wrap a read operation (e.g. `response.arrayBuffer()`) with a timeout.
   * If the timeout fires the failure is a structured `REMOTE_ERROR`; an
   * `AbortError` that comes from the caller's own signal is rethrown
   * untouched so user cancellation is never confused with a timeout.
   */
  private async readWithTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>
    return Promise.race([
      promise.finally(() => clearTimeout(timer)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(createPaintingGenerateError('REMOTE_ERROR', { message: timeoutMessage })),
          timeoutMs
        )
      })
    ])
  }

  /**
   * Read one history entry. Unlike `requestJson`, a non-OK response is not
   * automatically fatal: a 4xx (bar 429) can never succeed on retry, so it
   * surfaces as a structured failure, while a 5xx / 429 is left as a plain
   * error for the poll loop to retry. The request is also bounded by the poll's
   * remaining budget, so a hanging GET cannot outlive `POLL_TIMEOUT_MS`.
   */
  private async fetchHistory(
    taskId: string,
    signal: AbortSignal | undefined,
    remainingMs: number
  ): Promise<Record<string, HistoryEntry>> {
    const response = await this.fetchWithDeadline(
      `${this.baseURL}/history/${taskId}`,
      signal,
      remainingMs,
      t('paintings.comfyui.poll_timeout', { seconds: POLL_TIMEOUT_MS / 1000 })
    )
    if (!response.ok) {
      const message = await readErrorMessage(response, t('paintings.comfyui.request_failed'))
      if (isTerminalHttpStatus(response.status)) {
        throw createPaintingGenerateError('REMOTE_ERROR', { message })
      }
      // A plain error, not a structured one: the poll loop retries it.
      throw new Error(message)
    }
    return (await response.json()) as Record<string, HistoryEntry>
  }

  /** The AI SDK downloads returned URLs itself, so hand back inline data. */
  private async fetchImage(
    image: { filename: string; subfolder?: string; type?: string },
    signal?: AbortSignal
  ): Promise<string> {
    const query = new URLSearchParams({
      filename: image.filename,
      subfolder: image.subfolder ?? '',
      type: image.type ?? 'output'
    })
    let response: Response
    try {
      response = await this.fetchWithDeadline(
        `${this.baseURL}/view?${query}`,
        signal,
        IMAGE_TIMEOUT_MS,
        t('paintings.comfyui.image_download_timeout', { seconds: IMAGE_TIMEOUT_MS / 1000 })
      )
    } catch (error) {
      // The helper already reported this download's own timeout as a structured
      // failure, so an AbortError left here is the user's cancellation — never a
      // cancelled generation read as a failed download.
      if (signal?.aborted && error instanceof Error && error.name === 'AbortError') {
        throw createAbortError('Task polling aborted')
      }
      throw error
    }
    if (!response.ok) {
      throw createPaintingGenerateError('REMOTE_ERROR', {
        message: await readErrorMessage(response, t('paintings.comfyui.image_fetch_failed'))
      })
    }
    const buffer = Buffer.from(
      await this.readWithTimeout(
        response.arrayBuffer(),
        IMAGE_TIMEOUT_MS,
        t('paintings.comfyui.image_fetch_timeout', { seconds: IMAGE_TIMEOUT_MS / 1000 })
      )
    )
    const contentType = response.headers.get('content-type') || 'image/png'
    return `data:${contentType};base64,${buffer.toString('base64')}`
  }
}

/**
 * ComfyUI seeds are integers, and a workflow usually pins one. Write the sampler that
 * consumes the prompt, so two runs differ; a graph that keeps the seed on a shared node
 * feeding that sampler instead gets it there. Regular samplers read `seed`; advanced
 * variants (KSamplerAdvanced and friends, which schedule their own noise) read `noise_seed`.
 */
export function applySeed(graph: Record<string, ApiPromptNode>, seed: number | undefined, samplerId?: string): void {
  if (typeof seed !== 'number' || !Number.isFinite(seed)) return
  const value = Math.trunc(seed)
  const sampler = samplerId ? graph[samplerId] : undefined
  if (sampler) {
    const key = seedInputKey(sampler.inputs)
    if (key) {
      writeSeed(graph, sampler.inputs, key, value)
      return
    }
  }
  for (const node of Object.values(graph)) {
    const key = seedInputKey(node.inputs)
    if (key) {
      writeSeed(graph, node.inputs, key, value)
      return
    }
  }
}

const seedInputKey = (inputs: Record<string, unknown>): 'seed' | 'noise_seed' | undefined =>
  'seed' in inputs ? 'seed' : 'noise_seed' in inputs ? 'noise_seed' : undefined

/**
 * Write the seed into `inputs[key]`. A linked seed input is rewritten at its
 * source node — the node the sampler pulls the seed from usually holds the
 * pinning widget (a seed generator, or PrimitiveInt's `value`) — so the
 * connection is kept, not severed.
 */
function writeSeed(
  graph: Record<string, ApiPromptNode>,
  inputs: Record<string, unknown>,
  key: 'seed' | 'noise_seed',
  value: number
): void {
  const current = inputs[key]
  if (isReference(current)) {
    const source = graph[current[0]]
    const sourceKey = source
      ? (seedInputKey(source.inputs) ??
        ('value' in source.inputs && !isReference(source.inputs.value) ? 'value' : undefined))
      : undefined
    if (sourceKey) {
      source.inputs[sourceKey] = value
      return
    }
  }
  inputs[key] = value
}

export function createComfyuiTransport(settings: ComfyuiTransportSettings): ComfyuiTransport {
  return new ComfyuiTransport(settings)
}

export type { ComfyuiTransport }
