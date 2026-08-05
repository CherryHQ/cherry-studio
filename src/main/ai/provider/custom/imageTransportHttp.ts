import { APICallError } from '@ai-sdk/provider'
import {
  type FetchFunction,
  isAbortError,
  readResponseWithSizeLimit,
  type ResponseHandler
} from '@ai-sdk/provider-utils'
import * as z from 'zod'

const errorPayloadSchema = z
  .object({
    error: z
      .object({ message: z.string().min(1) })
      .passthrough()
      .optional(),
    message: z.string().min(1).optional()
  })
  .passthrough()

export interface ImageTransportHttpSettings {
  headers?: Record<string, string | undefined>
  fetch?: FetchFunction
}

/**
 * Keeps vendor JSON/plain-text messages while producing the structured error
 * that the shared polling runtime uses for retry classification.
 */
export function createImageTransportErrorResponseHandler(prefix?: string): ResponseHandler<APICallError> {
  return async ({ response, url, requestBodyValues }) => {
    const bytes = await readResponseWithSizeLimit({ response, url, maxBytes: 512 * 1024 })
    const responseBody = new TextDecoder().decode(bytes)
    const responseHeaders = Object.fromEntries(response.headers.entries())
    const fallback = response.statusText || `HTTP ${response.status}`
    let detail = responseBody.trim().slice(0, 300) || fallback

    if (responseBody) {
      try {
        const parsed = errorPayloadSchema.safeParse(JSON.parse(responseBody))
        if (parsed.success) {
          detail = parsed.data.error?.message ?? parsed.data.message ?? detail
        }
      } catch {
        // Plain-text vendor errors are already captured in `detail`.
      }
    }

    return {
      value: new APICallError({
        message: prefix ? `${prefix}: ${response.status} - ${detail}` : detail,
        url,
        requestBodyValues,
        statusCode: response.status,
        responseHeaders,
        responseBody
      }),
      responseHeaders
    }
  }
}

/**
 * provider-utils deliberately has no request-timeout option. This wrapper
 * distinguishes our timer from a caller abort, then lets provider-utils perform
 * the request and response handling with the derived signal.
 */
export async function withImageTransportRequestTimeout<T>(
  options: {
    url: string
    timeoutMs: number
    signal?: AbortSignal
  },
  request: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  let externallyAborted = false

  const timeoutId = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs)
  timeoutId.unref()

  const onExternalAbort = () => {
    externallyAborted = true
    controller.abort()
  }
  if (options.signal?.aborted) {
    externallyAborted = true
    controller.abort()
  } else {
    options.signal?.addEventListener('abort', onExternalAbort, { once: true })
  }

  try {
    return await request(controller.signal)
  } catch (error) {
    if (isAbortError(error)) {
      if (externallyAborted) throw new DOMException('Image transport request aborted', 'AbortError')
      if (timedOut) {
        throw new APICallError({
          message: `Image transport request timed out after ${options.timeoutMs / 1000}s`,
          url: options.url,
          requestBodyValues: {},
          cause: error,
          isRetryable: true
        })
      }
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
    options.signal?.removeEventListener('abort', onExternalAbort)
  }
}
