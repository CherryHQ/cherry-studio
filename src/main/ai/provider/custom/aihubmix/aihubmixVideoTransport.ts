import { createAbortError, isTerminalHttpStatus, waitWithSignal } from '../transportUtils'
import type {
  VideoArtifact,
  VideoGenerationSubmitInput,
  VideoGenerationTransport,
  VideoPollOptions
} from '../videoGenerationModel'
import type { AihubmixProviderSettings } from './aihubmixProvider'

const POLL_INTERVAL_MS = 5_000
const POLL_TIMEOUT_MS = 20 * 60_000

/**
 * AiHubMix unified video transport — OpenAI-Sora-compatible:
 *   - submit: POST {base}/videos  { model, prompt, input_reference?, …params } → { id, status }
 *   - poll:   GET  {base}/videos/{id} → { status: queued|in_progress|completed|failed, progress?, error? }
 *   - result: GET  {base}/videos/{id}/content (AUTHENTICATED binary mp4)
 * Because the result is an authenticated binary endpoint (no public URL), the transport
 * fetches the bytes itself and returns a `bytes` artifact (not a `url`).
 * Auth is `Bearer <key>`.
 */
export function buildAihubmixVideoTransport(settings: AihubmixProviderSettings): VideoGenerationTransport {
  const base = (settings.baseURL ?? 'https://aihubmix.com/v1').replace(/\/+$/, '')
  const headers = { Authorization: `Bearer ${settings.apiKey ?? ''}` }
  const jsonHeaders = { ...headers, 'Content-Type': 'application/json' }
  const doFetch = settings.fetch ?? fetch

  /** Authenticated binary download of the completed video. */
  const downloadContent = async (taskId: string, signal?: AbortSignal): Promise<VideoArtifact> => {
    const res = await doFetch(`${base}/videos/${encodeURIComponent(taskId)}/content`, {
      method: 'GET',
      headers,
      signal
    })
    if (!res.ok) throw new Error(`AiHubMix video content download failed (${res.status})`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    const mediaType = res.headers.get('content-type') ?? 'video/mp4'
    return { bytes, mediaType }
  }

  return {
    async submit(input: VideoGenerationSubmitInput) {
      const body: Record<string, unknown> = {
        model: input.modelId,
        ...(input.prompt ? { prompt: input.prompt } : {}),
        ...(input.firstFrame ? { input_reference: input.firstFrame } : {}),
        ...input.providerParams
      }
      const res = await doFetch(`${base}/videos`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(body),
        signal: input.signal
      })
      if (!res.ok) {
        throw new Error(
          `AiHubMix video create failed (${res.status}): ${(await res.text().catch(() => '')).slice(0, 300)}`
        )
      }
      const json = (await res.json()) as { id?: string }
      if (!json.id) throw new Error(`AiHubMix video create for '${input.modelId}' returned no id`)
      return { taskId: json.id }
    },

    async poll(taskId: string, options: VideoPollOptions): Promise<VideoArtifact[]> {
      const deadline = Date.now() + POLL_TIMEOUT_MS

      while (true) {
        if (options.signal?.aborted) throw createAbortError('Video generation aborted')
        const res = await doFetch(`${base}/videos/${encodeURIComponent(taskId)}`, {
          method: 'GET',
          headers,
          signal: options.signal
        })
        if (!res.ok) {
          if (isTerminalHttpStatus(res.status) || Date.now() > deadline) {
            throw new Error(`AiHubMix video status failed (${res.status})`)
          }
          await waitWithSignal(POLL_INTERVAL_MS, options.signal)
          continue
        }
        const json = (await res.json()) as {
          status?: string
          progress?: number
          error?: { message?: string } | null
        }
        if (json.status === 'completed') {
          return [await downloadContent(taskId, options.signal)]
        }
        if (json.status === 'failed') {
          throw new Error(`AiHubMix video task '${taskId}' failed: ${json.error?.message ?? 'no detail'}`)
        }
        if (Date.now() > deadline) throw new Error(`AiHubMix video task '${taskId}' timed out after polling`)
        if (typeof json.progress === 'number') options.onProgress?.(json.progress)
        await waitWithSignal(POLL_INTERVAL_MS, options.signal)
      }
    }
  }
}
