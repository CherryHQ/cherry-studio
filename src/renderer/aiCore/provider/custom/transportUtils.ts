import type { ImageModelV3File } from '@ai-sdk/provider'
import { parseDataUrl } from '@shared/utils'

/**
 * Shared building blocks for transports / image-model adapters.
 *
 *   - `createAbortError` synthesizes the standard `AbortError` shape callers
 *     downstream key off (`error.name === 'AbortError'`).
 *   - `waitWithSignal` is the abort-aware sleep every async-polling transport
 *     needs between attempts.
 *   - `uint8ToBase64` and `fileToDataUrl` are the AI SDK `ImageModelV3File`
 *     → wire-format (data URL) bridge — vendors that take base64 / data
 *     URLs as their `image` body field call this on `options.files[0]`.
 *
 * These all started as per-file copies inside modelscope / ppio / silicon
 * / aihubmixFlux transports; consolidating here avoids three more
 * `function uint8ToBase64()` declarations when the next async vendor lands.
 */

export function createAbortError(message: string): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

/**
 * Whether an HTTP error status should end a poll loop immediately. A 4xx
 * client error (bad request, auth, not-found) won't fix itself on retry, so
 * it's terminal. 5xx server errors and 429 rate-limits are transient — a poll
 * GET that hits one should retry rather than kill an otherwise-healthy task.
 */
export function isTerminalHttpStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 429
}

export function waitWithSignal(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(createAbortError('Task polling aborted'))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(createAbortError('Task polling aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

/**
 * Normalize an AI SDK `ImageModelV3File` into a `data:` / `https?:` URL
 * vendors accept on body fields like `image` / `image_url` / `input_image`.
 *
 * - `type: 'url'` → pass the URL through unchanged.
 * - `data: string` that's already a data URL → unchanged.
 * - `data: string` (assumed raw base64) → wrap with the supplied mediaType.
 * - `data: Uint8Array` → encode to base64 and wrap.
 */
export function fileToDataUrl(file: ImageModelV3File): string {
  if (file.type === 'url') return file.url
  if (typeof file.data === 'string') {
    const parsed = parseDataUrl(file.data)
    return parsed ? file.data : `data:${file.mediaType || 'image/png'};base64,${file.data}`
  }
  return `data:${file.mediaType || 'image/png'};base64,${uint8ToBase64(file.data)}`
}
