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
import { createAbortError, waitWithSignal } from '../transportUtils'
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

interface UserDataEntry {
  name: string
  type: string
}

export const WORKFLOW_FILE_EXTENSION = '.json'

/** Saved workflow names, newest first. Directories and non-workflow files are skipped. */
export async function listWorkflows(
  baseURL: string,
  signal?: AbortSignal,
  options: ComfyuiRequestOptions = {}
): Promise<string[]> {
  const doFetch = options.fetch ?? fetch
  const response = await doFetch(`${baseURL}/v2/userdata?path=${WORKFLOW_DIR}`, { signal, headers: options.headers })
  if (!response.ok) {
    throw createPaintingGenerateError('REMOTE_ERROR', {
      message: await readErrorMessage(response, t('paintings.comfyui.list_failed'))
    })
  }
  const entries = (await response.json()) as UserDataEntry[]
  return entries
    .filter((entry) => entry.type === 'file' && entry.name.endsWith(WORKFLOW_FILE_EXTENSION))
    .map((entry) => entry.name.slice(0, -WORKFLOW_FILE_EXTENSION.length))
}

async function fetchJson<T>(url: string, signal?: AbortSignal, options: ComfyuiRequestOptions = {}): Promise<T> {
  const doFetch = options.fetch ?? fetch
  const response = await doFetch(url, { signal, headers: options.headers })
  if (!response.ok) {
    throw createPaintingGenerateError('REMOTE_ERROR', {
      message: await readErrorMessage(response, t('paintings.comfyui.request_failed'))
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
      fetchJson<Parameters<typeof convertUiWorkflowToPrompt>[0]>(
        `${this.baseURL}/userdata/${encodeURIComponent(workflowPath)}`,
        input.signal,
        requestOptions
      ),
      fetchJson<ObjectInfo>(`${this.baseURL}/object_info`, input.signal, requestOptions)
    ])

    const { prompt: graph, warnings } = convertUiWorkflowToPrompt(workflow, objectInfo)
    for (const warning of warnings) logger.warn(`workflow conversion: ${warning}`)

    const target = findPromptTarget(graph)
    if (!target) {
      throw createPaintingGenerateError('REMOTE_ERROR', {
        message: t('paintings.comfyui.no_prompt_node', { workflow: input.modelId })
      })
    }
    applyPrompt(graph, target.nodeId, target.input, input.prompt ?? '')
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
        const history = await fetchJson<
          Record<
            string,
            {
              outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }>
              status?: { status_str?: string; messages?: unknown[] }
            }
          >
        >(`${this.baseURL}/history/${taskId}`, options.signal, {
          headers: this.headers,
          fetch: this.doFetch
        })
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
        // Structured failures (workflow error, no image) end the poll loop;
        // anything else — a transient network blip on the history GET — retries.
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
   * Cancel one generation. Queue entries key the prompt id at index 1
   * (`[number, prompt_id, prompt, extra_data, outputs]`), so dequeue by
   * `POST /queue {"delete": [id]}` — its filter matches index 1 — and
   * interrupt by `POST /interrupt {"prompt_id": id}`, which the server only
   * honours when this generation is the one executing. A finished id matches
   * neither and both requests no-op.
   */
  async cancel(taskId: string): Promise<void> {
    await this.doFetch(`${this.baseURL}/queue`, {
      method: 'POST',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ delete: [taskId] })
    }).catch(() => undefined)
    await this.doFetch(`${this.baseURL}/interrupt`, {
      method: 'POST',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt_id: taskId })
    }).catch(() => undefined)
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
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS)
    try {
      const response = await this.doFetch(`${this.baseURL}/view?${query}`, {
        signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
        headers: this.headers
      })
      if (!response.ok) {
        throw createPaintingGenerateError('REMOTE_ERROR', {
          message: await readErrorMessage(response, t('paintings.comfyui.image_fetch_failed'))
        })
      }
      const buffer = Buffer.from(await response.arrayBuffer())
      const contentType = response.headers.get('content-type') || 'image/png'
      return `data:${contentType};base64,${buffer.toString('base64')}`
    } catch (error) {
      // The combined signal aborts for the user's cancellation AND for this
      // download's own timeout; only the former is an AbortError — a timer fire
      // is a failed download, not a cancelled generation.
      if (error instanceof Error && error.name === 'AbortError') {
        if (signal?.aborted) throw createAbortError('Task polling aborted')
        throw createPaintingGenerateError('REMOTE_ERROR', {
          message: t('paintings.comfyui.image_download_timeout', { seconds: IMAGE_TIMEOUT_MS / 1000 })
        })
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}

/** Write the prompt into the graph, keeping the node's other inputs untouched. */
export function applyPrompt(graph: Record<string, ApiPromptNode>, nodeId: string, input: string, prompt: string): void {
  graph[nodeId].inputs[input] = prompt
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
