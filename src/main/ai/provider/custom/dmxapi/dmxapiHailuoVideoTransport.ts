import { createAbortError, isTerminalHttpStatus, waitWithSignal } from '../transportUtils'
import type {
  VideoArtifact,
  VideoGenerationSubmitInput,
  VideoGenerationTransport,
  VideoPollOptions
} from '../videoGenerationModel'
import type { DmxapiProviderSettings } from './dmxapiProvider'

const POLL_INTERVAL_MS = 5_000
const POLL_TIMEOUT_MS = 20 * 60_000

/**
 * DMXAPI Hailuo (MiniMax) video transport. Unlike the DMXAPI `/v1/responses` families,
 * Hailuo is a classic 3-step REST flow against distinct endpoints:
 *   1. submit:   POST {root}/v1/video_generation         { model, prompt, first_frame_image?, last_frame_image?, … } → { task_id, base_resp }
 *   2. query:    GET  {root}/v1/query/video_generation?task_id=…  → { status: Processing|Success|Failed, file_id, base_resp }
 *   3. resolve:  GET  {root}/v1/files/retrieve?file_id=…&task_id=… → { file: { download_url }, base_resp }
 * Success on every step is `base_resp.status_code === 0`. The query returns a `file_id` (NOT a
 * URL); the third call resolves it to a signed `download_url`. Auth: raw key, NO `Bearer` prefix.
 */

/** Recognizes DMXAPI MiniMax-Hailuo model ids. */
export function dmxapiUsesHailuoTransport(modelId: string): boolean {
  return /^minimax-hailuo/i.test(modelId)
}

function rootUrl(baseURL: string): string {
  return baseURL.replace(/\/+$/, '').replace(/\/v1$/, '')
}

function assertOk(json: unknown, step: string): void {
  const code = (json as { base_resp?: { status_code?: number; status_msg?: string } })?.base_resp?.status_code
  if (typeof code === 'number' && code !== 0) {
    const msg = (json as { base_resp?: { status_msg?: string } })?.base_resp?.status_msg ?? `code ${code}`
    throw new Error(`DMXAPI Hailuo ${step} failed: ${msg}`)
  }
}

export function buildDmxapiHailuoVideoTransport(settings: DmxapiProviderSettings): VideoGenerationTransport {
  const baseURL = settings.baseURL
  if (!baseURL) {
    throw new Error('DMXAPI provider requires a non-empty `baseURL` to build the Hailuo video transport.')
  }
  const root = rootUrl(baseURL)
  const auth = { Authorization: settings.apiKey ?? '' } // raw key, NO Bearer
  // undici `fetch`, not Electron net.fetch — tolerates CN aggregators' non-Latin1
  // response headers (net.fetch throws an uncaught ByteString error); proxied via
  // the Node global dispatcher.
  const doFetch = fetch

  const getJson = async (url: string, signal?: AbortSignal): Promise<unknown> => {
    const res = await doFetch(url, { method: 'GET', headers: auth, signal })
    if (!res.ok) {
      const err = new Error(`DMXAPI Hailuo GET failed (${res.status})`)
      ;(err as Error & { status?: number }).status = res.status
      throw err
    }
    return res.json()
  }

  return {
    async submit(input: VideoGenerationSubmitInput) {
      const body: Record<string, unknown> = {
        model: input.modelId,
        ...(input.prompt ? { prompt: input.prompt } : {}),
        ...(input.firstFrame ? { first_frame_image: input.firstFrame } : {}),
        ...(input.lastFrame ? { last_frame_image: input.lastFrame } : {}),
        ...input.providerParams
      }
      const res = await doFetch(`${root}/v1/video_generation`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: input.signal
      })
      if (!res.ok) {
        throw new Error(
          `DMXAPI Hailuo submit failed (${res.status}): ${(await res.text().catch(() => '')).slice(0, 300)}`
        )
      }
      const json = (await res.json()) as { task_id?: string }
      assertOk(json, 'submit')
      if (!json.task_id) throw new Error(`DMXAPI Hailuo submit for '${input.modelId}' returned no task_id`)
      return { taskId: json.task_id }
    },

    async poll(taskId: string, options: VideoPollOptions): Promise<VideoArtifact[]> {
      const deadline = Date.now() + POLL_TIMEOUT_MS

      while (true) {
        if (options.signal?.aborted) throw createAbortError('Video generation aborted')
        let query: { status?: string; file_id?: string }
        try {
          query = (await getJson(
            `${root}/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`,
            options.signal
          )) as { status?: string; file_id?: string }
        } catch (error) {
          const status = (error as { status?: number }).status
          if ((status && isTerminalHttpStatus(status)) || Date.now() > deadline) throw error
          await waitWithSignal(POLL_INTERVAL_MS, options.signal)
          continue
        }
        const status = query.status
        if (status === 'Success') {
          if (!query.file_id) throw new Error(`DMXAPI Hailuo task '${taskId}' succeeded but returned no file_id`)
          // Step 3: resolve the file_id to a signed download URL.
          const retrieve = (await getJson(
            `${root}/v1/files/retrieve?file_id=${encodeURIComponent(query.file_id)}&task_id=${encodeURIComponent(taskId)}`,
            options.signal
          )) as { file?: { download_url?: string } }
          assertOk(retrieve, 'files/retrieve')
          const downloadUrl = retrieve.file?.download_url
          if (!downloadUrl)
            throw new Error(`DMXAPI Hailuo task '${taskId}' file '${query.file_id}' has no download_url`)
          return [{ url: downloadUrl }]
        }
        if (status === 'Failed') throw new Error(`DMXAPI Hailuo task '${taskId}' failed`)
        if (Date.now() > deadline) throw new Error(`DMXAPI Hailuo task '${taskId}' timed out after polling`)
        options.onProgress?.(50)
        await waitWithSignal(POLL_INTERVAL_MS, options.signal)
      }
    }
  }
}
