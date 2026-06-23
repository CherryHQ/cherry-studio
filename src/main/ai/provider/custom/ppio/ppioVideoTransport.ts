import { createAbortError, isTerminalHttpStatus, waitWithSignal } from '../transportUtils'
import type {
  VideoArtifact,
  VideoGenerationSubmitInput,
  VideoGenerationTransport,
  VideoPollOptions
} from '../videoGenerationModel'
import type { PpioProviderSettings } from './ppioProvider'

const POLL_INTERVAL_MS = 5_000
const POLL_TIMEOUT_MS = 20 * 60_000

/**
 * PPIO unified video transport. One flat submit endpoint switched by `model`, one shared
 * task-query endpoint — the cleanest aggregator shape:
 *   - submit:  POST {base}/v3/video/create  { model, prompt, image?, end_image?, …params } → { task_id }
 *   - query:   GET  {base}/v3/async/task-result?task_id=…
 *              → { task: { status, progress_percent, reason }, videos: [{ video_url }] }
 * Auth is `Bearer <key>`. Result `video_url`s are public signed URLs (TTL ~1h) → returned
 * as `url` artifacts for the handler to download.
 */

/** Normalize any PPIO base (`…/v3/openai`, `…/v3`, host) to the host root. */
function rootUrl(baseURL: string): string {
  return baseURL.replace(/\/+$/, '').replace(/\/v3(\/.*)?$/, '')
}

export function buildPpioVideoTransport(settings: PpioProviderSettings): VideoGenerationTransport {
  const baseURL = settings.baseURL
  if (!baseURL) {
    throw new Error('PPIO provider requires a non-empty `baseURL` to build the video transport.')
  }
  const root = rootUrl(baseURL)
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey ?? ''}` }
  // undici `fetch`, not Electron net.fetch — tolerates CN aggregators' non-Latin1
  // response headers (net.fetch throws an uncaught ByteString error); proxied via
  // the Node global dispatcher.
  const doFetch = fetch

  return {
    async submit(input: VideoGenerationSubmitInput) {
      const body: Record<string, unknown> = {
        model: input.modelId,
        ...(input.prompt ? { prompt: input.prompt } : {}),
        ...(input.firstFrame ? { image: input.firstFrame } : {}),
        ...(input.lastFrame ? { end_image: input.lastFrame } : {}),
        ...input.providerParams
      }
      const res = await doFetch(`${root}/v3/video/create`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: input.signal
      })
      if (!res.ok) {
        throw new Error(`PPIO video create failed (${res.status}): ${(await res.text().catch(() => '')).slice(0, 300)}`)
      }
      const json = (await res.json()) as { task_id?: string }
      if (!json.task_id) throw new Error(`PPIO video create for '${input.modelId}' returned no task_id`)
      return { taskId: json.task_id }
    },

    async poll(taskId: string, options: VideoPollOptions): Promise<VideoArtifact[]> {
      const queryUrl = `${root}/v3/async/task-result?task_id=${encodeURIComponent(taskId)}`
      const deadline = Date.now() + POLL_TIMEOUT_MS

      while (true) {
        if (options.signal?.aborted) throw createAbortError('Video generation aborted')
        const res = await doFetch(queryUrl, { method: 'GET', headers, signal: options.signal })
        if (!res.ok) {
          if (isTerminalHttpStatus(res.status) || Date.now() > deadline) {
            throw new Error(`PPIO video task-result failed (${res.status})`)
          }
          await waitWithSignal(POLL_INTERVAL_MS, options.signal)
          continue
        }
        const json = (await res.json()) as {
          task?: { status?: string; progress_percent?: number; reason?: string }
          videos?: Array<{ video_url?: string }>
        }
        const status = json.task?.status ?? ''
        if (status === 'TASK_STATUS_SUCCEED') {
          const urls = (json.videos ?? []).map((v) => v.video_url).filter((u): u is string => Boolean(u))
          if (urls.length === 0) throw new Error(`PPIO video task '${taskId}' succeeded but returned no video_url`)
          return urls.map((url) => ({ url }))
        }
        if (status === 'TASK_STATUS_FAILED') {
          throw new Error(`PPIO video task '${taskId}' failed: ${json.task?.reason ?? 'no detail'}`)
        }
        if (Date.now() > deadline) throw new Error(`PPIO video task '${taskId}' timed out after polling`)
        if (typeof json.task?.progress_percent === 'number') options.onProgress?.(json.task.progress_percent)
        await waitWithSignal(POLL_INTERVAL_MS, options.signal)
      }
    }
  }
}
