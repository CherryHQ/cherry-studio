import type { FetchFunction } from '@ai-sdk/provider-utils'

import { t } from '@main/i18n'
import { createPaintingGenerateError } from '@shared/ai/paintingGenerateError'

import { readErrorMessage } from '../readErrorMessage'

/**
 * The HTTP rules every ComfyUI caller shares: what a caller may override, how a
 * pasted host is normalized, and how one exchange is bounded. The generation
 * transport and the workflow listing each own what they ask for, but none of
 * them owns the mechanics below.
 */

/** Per-request overrides shared by the transport and the standalone helpers. */
export interface ComfyuiRequestOptions {
  /** Extra headers, e.g. the provider's configured extra headers. */
  headers?: Record<string, string>
  /** Overrides `fetch` for every request. */
  fetch?: FetchFunction
}

/**
 * Everything from `#` on belongs to the client and is never sent, so a host the
 * user pasted as `http://host:8188/#` would otherwise put every request on the
 * console's HTML root instead of the API. Trailing slashes go with it, or the
 * fragment leaves a doubled separator behind.
 */
export function normalizeComfyuiBaseUrl(baseURL: string): string {
  return baseURL.split('#')[0].replace(/\/+$/, '')
}

/**
 * Run one exchange under an absolute deadline, combined with the caller's
 * signal, and report this request's own timeout as a structured failure.
 *
 * `run` receives the combined signal, so everything it awaits — the fetch, the
 * body read, a second read of an error body — is bounded by the same budget and
 * is actually aborted when it fires. This is ComfyUI's only deadline
 * implementation; every caller, the transport included, owns nothing else.
 */
export async function withDeadline<T>(
  signal: AbortSignal | undefined,
  timeoutMs: number,
  timeoutMessage: string,
  run: (deadlineSignal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(0, timeoutMs))
  try {
    return await run(signal ? AbortSignal.any([signal, controller.signal]) : controller.signal)
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
 * The one place a GET is issued: the workflow listing and every read the
 * transport makes go through it, so the headers, the fetch override and the
 * structured failure have a single owner. The caller resolves its own fallback
 * message — the i18n gate only accepts a key written literally where the helper
 * is called — and names its own budget, since a listing and a submit do not
 * wait equally long.
 */
export async function requestJson<T>(
  url: string,
  fallback: string,
  signal: AbortSignal | undefined,
  options: ComfyuiRequestOptions,
  timeoutMs: number
): Promise<T> {
  const doFetch = options.fetch ?? fetch
  return withDeadline(
    signal,
    timeoutMs,
    t('paintings.comfyui.request_timeout', { seconds: timeoutMs / 1000 }),
    async (deadlineSignal) => {
      const response = await doFetch(url, { signal: deadlineSignal, headers: options.headers })
      if (!response.ok) {
        // Inside the deadline: the error body is a read like any other.
        throw createPaintingGenerateError('REMOTE_ERROR', {
          message: await readErrorMessage(response, fallback)
        })
      }
      return (await response.json()) as T
    }
  )
}
