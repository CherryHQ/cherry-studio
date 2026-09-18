import type { FetchFunction } from '@ai-sdk/provider-utils'

import { loggerService } from '@logger'

import type {
  ImageGenerationSubmitInput,
  ImageGenerationTransport,
  ImageTransportDescriptor
} from '../imageGenerationModel'
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
  if (!response.ok) throw new Error(`ComfyUI userdata listing failed (HTTP ${response.status})`)
  const entries = (await response.json()) as UserDataEntry[]
  return entries
    .filter((entry) => entry.type === 'file' && entry.name.endsWith(WORKFLOW_FILE_EXTENSION))
    .map((entry) => entry.name.slice(0, -WORKFLOW_FILE_EXTENSION.length))
}

async function fetchJson<T>(url: string, signal?: AbortSignal, options: ComfyuiRequestOptions = {}): Promise<T> {
  const doFetch = options.fetch ?? fetch
  const response = await doFetch(url, { signal, headers: options.headers })
  if (!response.ok) throw new Error(`ComfyUI request to ${url} failed (HTTP ${response.status})`)
  return (await response.json()) as T
}

/** Turn ComfyUI's validation payload into something a user can act on. */
function describePromptError(status: number, body: unknown): string {
  const payload = body as {
    error?: { message?: string; details?: string }
    node_errors?: Record<string, { errors?: Array<{ message?: string; details?: string }> }>
  }
  const parts: string[] = []
  if (payload?.error?.message) parts.push(payload.error.message)
  if (payload?.error?.details) parts.push(payload.error.details)
  for (const [nodeId, entry] of Object.entries(payload?.node_errors ?? {})) {
    for (const error of entry?.errors ?? []) {
      parts.push(`node ${nodeId}: ${error.message ?? ''} ${error.details ?? ''}`.trim())
    }
  }
  return parts.length > 0 ? parts.join('; ') : `ComfyUI rejected the workflow (HTTP ${status})`
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
      throw new Error(
        `ComfyUI workflow "${input.modelId}" has no text node that the sampler consumes as positive conditioning, so there is nowhere to put the prompt.`
      )
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
      throw new Error(describePromptError(response.status, await response.json().catch(() => ({}))))
    }
    const { prompt_id: promptId } = (await response.json()) as { prompt_id?: string }
    if (!promptId) throw new Error('ComfyUI accepted the workflow but returned no prompt id')
    return { taskId: promptId }
  }

  async poll(
    taskId: string,
    options: {
      signal?: AbortSignal
      onProgress?: (progress: number) => void
      modelDescriptor?: ImageTransportDescriptor
    }
  ): Promise<string[]> {
    const deadline = Date.now() + POLL_TIMEOUT_MS
    let ticks = 0
    while (Date.now() < deadline) {
      if (options.signal?.aborted) throw new Error('Image generation aborted')
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
        if (images.length === 0) throw new Error('ComfyUI finished without producing an image')
        return Promise.all(images.map((image) => this.fetchImage(image, options.signal)))
      }
      if (entry?.status?.status_str === 'error') {
        throw new Error(`ComfyUI workflow failed: ${JSON.stringify(entry.status.messages ?? {}).slice(0, 500)}`)
      }
      ticks += 1
      options.onProgress?.(Math.min(0.9, ticks * 0.05))
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
    throw new Error(`ComfyUI did not finish within ${POLL_TIMEOUT_MS / 1000}s`)
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
      if (!response.ok) throw new Error(`ComfyUI could not return ${image.filename} (HTTP ${response.status})`)
      const buffer = Buffer.from(await response.arrayBuffer())
      const contentType = response.headers.get('content-type') || 'image/png'
      return `data:${contentType};base64,${buffer.toString('base64')}`
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
 * pinning widget — so the connection is kept, not severed.
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
    const sourceKey = source ? seedInputKey(source.inputs) : undefined
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
