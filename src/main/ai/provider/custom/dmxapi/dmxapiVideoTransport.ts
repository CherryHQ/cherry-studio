import { createAbortError, isTerminalHttpStatus, waitWithSignal } from '../transportUtils'
import type {
  VideoArtifact,
  VideoGenerationSubmitInput,
  VideoGenerationTransport,
  VideoPollOptions
} from '../videoGenerationModel'
import { dmxapiUsesHailuoTransport } from './dmxapiHailuoVideoTransport'
import type { DmxapiProviderSettings } from './dmxapiProvider'

const POLL_INTERVAL_MS = 5_000
const POLL_TIMEOUT_MS = 20 * 60_000

/**
 * DMXAPI video transport. Every DMXAPI video model — submit AND query — POSTs to the single
 * `/v1/responses` endpoint; routing is by the `model` field. Per-family wire divergence (body
 * shape, submit/query response parsing, query "model") lives in the {@link FAMILIES} table —
 * adding a vendor family is a row, not a new transport.
 *
 * Implemented: HappyHorse (enveloped JSON query) and Vidu (flat submit, free-text query whose
 * result URL is regex-extracted). Hailuo (3-step REST, not `/v1/responses`) is a separate TODO.
 *
 * Auth: DMXAPI uses the raw key in `Authorization` (NO `Bearer` prefix).
 */
interface QueryResult {
  done: boolean
  failed: boolean
  videoUrl?: string
  message?: string
}

interface DmxapiVideoFamily {
  matches(modelId: string): boolean
  buildSubmitBody(input: VideoGenerationSubmitInput): Record<string, unknown>
  parseSubmitTaskId(json: unknown): string | undefined
  buildQueryBody(taskId: string): Record<string, unknown>
  parseQuery(json: unknown): QueryResult
}

/** The OpenAI-Responses envelope nests a stringified JSON at `output[0].content[0].text`. */
function envelopeText(json: unknown): string | undefined {
  return (json as { output?: Array<{ content?: Array<{ text?: string }> }> })?.output?.[0]?.content?.[0]?.text
}

function parseEnvelopeJson(json: unknown): Record<string, unknown> {
  const text = envelopeText(json)
  if (typeof text !== 'string') throw new Error('DMXAPI video: malformed response envelope')
  return JSON.parse(text) as Record<string, unknown>
}

/** HappyHorse: `input` is an ARRAY of objects; enveloped JSON for both submit and query. */
const happyHorseFamily: DmxapiVideoFamily = {
  matches: (modelId) => modelId.startsWith('happyhorse'),
  buildSubmitBody: (input) => {
    const item: Record<string, unknown> = {}
    if (input.prompt) item.prompt = input.prompt
    if (input.firstFrame) item.media = [{ type: 'first_frame', url: input.firstFrame }]
    const { aspectRatio, ...rest } = input.providerParams
    return {
      model: input.modelId,
      input: [item],
      parameters: { ...rest, ...(aspectRatio ? { ratio: aspectRatio } : {}) }
    }
  },
  parseSubmitTaskId: (json) => parseEnvelopeJson(json).task_id as string | undefined,
  buildQueryBody: (taskId) => ({ model: 'happyhorse-get', input: taskId }),
  parseQuery: (json) => {
    const p = parseEnvelopeJson(json)
    const status = String(p.task_status ?? '').toUpperCase()
    return {
      done: status === 'SUCCEEDED',
      failed: ['FAILED', 'CANCELED', 'CANCELLED', 'EXPIRED'].includes(status),
      videoUrl: typeof p.video_url === 'string' ? p.video_url : undefined,
      message: typeof p.message === 'string' ? p.message : undefined
    }
  }
}

/** Match a signed video URL after the `视频URL:` label, falling back to the first `.mp4` link. */
function extractViduUrl(text: string): string | undefined {
  return text.match(/视频URL[:：]\s*(https?:\/\/\S+)/)?.[1] ?? text.match(/(https?:\/\/[^\s"']+\.mp4[^\s"']*)/)?.[1]
}

/**
 * Vidu: ONE model id (`viduq3-pro`) with the mode chosen by the media shape; submit returns a
 * FLAT `{ task_id }`; query (`vidu-get`, `stream:false`) returns pre-formatted text carrying the
 * signed URL after `视频URL:` (DMXAPI does not expose a clean JSON field there).
 */
const viduFamily: DmxapiVideoFamily = {
  matches: (modelId) => modelId.startsWith('vidu'),
  buildSubmitBody: (input) => {
    const { aspectRatio, ...rest } = input.providerParams
    const params = { ...rest, ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}) }
    if (input.firstFrame && input.lastFrame) {
      // start/end-frame: images go in `input` (array), prompt is a sibling field.
      return { model: input.modelId, input: [input.firstFrame, input.lastFrame], prompt: input.prompt, ...params }
    }
    if (input.firstFrame) {
      // image-to-video: `images` array + `input` = prompt.
      return { model: input.modelId, images: [input.firstFrame], input: input.prompt, ...params }
    }
    // text-to-video: `input` = prompt.
    return { model: input.modelId, input: input.prompt, ...params }
  },
  parseSubmitTaskId: (json) => (json as { task_id?: string })?.task_id,
  buildQueryBody: (taskId) => ({ model: 'vidu-get', input: taskId, stream: false }),
  parseQuery: (json) => {
    const text = envelopeText(json) ?? (typeof json === 'string' ? json : JSON.stringify(json))
    const videoUrl = extractViduUrl(text)
    if (videoUrl) return { done: true, failed: false, videoUrl }
    const failed = /失败|失败了|error|failed/i.test(text)
    return { done: false, failed, message: failed ? text.slice(0, 200) : undefined }
  }
}

const FAMILIES: readonly DmxapiVideoFamily[] = [happyHorseFamily, viduFamily]

function resolveFamily(modelId: string): DmxapiVideoFamily {
  const family = FAMILIES.find((f) => f.matches(modelId))
  if (!family) throw new Error(`DMXAPI video: unsupported model '${modelId}' (no transport family)`)
  return family
}

/** Whether a DMXAPI model id is handled by the `/v1/responses` families (HappyHorse, Vidu). */
export function dmxapiUsesResponsesTransport(modelId: string): boolean {
  return FAMILIES.some((f) => f.matches(modelId))
}

/** Whether a DMXAPI model id is handled by ANY DMXAPI video transport (responses families or Hailuo REST). */
export function dmxapiUsesVideoTransport(modelId: string): boolean {
  return dmxapiUsesResponsesTransport(modelId) || dmxapiUsesHailuoTransport(modelId)
}

/** Normalize the chat baseURL to the `/v1/responses` endpoint (handles a base with or without a trailing `/v1`). */
function responsesUrl(baseURL: string): string {
  const base = baseURL.replace(/\/+$/, '').replace(/\/v1$/, '')
  return `${base}/v1/responses`
}

export function buildDmxapiVideoTransport(settings: DmxapiProviderSettings, modelId: string): VideoGenerationTransport {
  const baseURL = settings.baseURL
  if (!baseURL) {
    throw new Error('DMXAPI provider requires a non-empty `baseURL` to build the video transport.')
  }
  const family = resolveFamily(modelId)
  const url = responsesUrl(baseURL)
  const apiKey = settings.apiKey ?? ''
  // DMXAPI auth: the raw key, NO `Bearer` prefix.
  const headers = { 'Content-Type': 'application/json', Authorization: apiKey }
  const doFetch = settings.fetch ?? fetch

  const post = async (body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> => {
    const res = await doFetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      const err = new Error(`DMXAPI video request failed (${res.status}): ${detail.slice(0, 300)}`)
      ;(err as Error & { status?: number }).status = res.status
      throw err
    }
    return res.json()
  }

  return {
    async submit(input) {
      const taskId = family.parseSubmitTaskId(await post(family.buildSubmitBody(input), input.signal))
      if (typeof taskId !== 'string' || !taskId) {
        throw new Error(`DMXAPI video submit for '${input.modelId}' returned no task id`)
      }
      return { taskId }
    },

    async poll(taskId, options: VideoPollOptions): Promise<VideoArtifact[]> {
      const deadline = Date.now() + POLL_TIMEOUT_MS

      while (true) {
        if (options.signal?.aborted) throw createAbortError('Video generation aborted')
        let result: QueryResult
        try {
          result = family.parseQuery(await post(family.buildQueryBody(taskId), options.signal))
        } catch (error) {
          const status = (error as { status?: number }).status
          if ((status && isTerminalHttpStatus(status)) || Date.now() > deadline) throw error
          await waitWithSignal(POLL_INTERVAL_MS, options.signal)
          continue
        }
        if (result.done) {
          if (!result.videoUrl) throw new Error(`DMXAPI video task '${taskId}' completed but returned no video URL`)
          return [{ url: result.videoUrl }]
        }
        if (result.failed) throw new Error(`DMXAPI video task '${taskId}' failed: ${result.message ?? 'no detail'}`)
        if (Date.now() > deadline) throw new Error(`DMXAPI video task '${taskId}' timed out after polling`)
        options.onProgress?.(50)
        await waitWithSignal(POLL_INTERVAL_MS, options.signal)
      }
    }
  }
}
