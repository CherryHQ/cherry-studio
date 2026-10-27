import {
  createJsonErrorResponseHandler,
  createJsonResponseHandler,
  type FetchFunction,
  getFromApi as aiSdkGetFromApi,
  zodSchema
} from '@ai-sdk/provider-utils'
import * as z from 'zod'

import { customFetch } from '../utils/customFetch'

/**
 * Provider `fetch` for model listing: Electron `net.fetch` (Chromium) rather than Node's
 * global fetch.
 *
 * Node only trusts its own bundled CA store, while Chromium trusts the OS one and honors
 * the session proxy — so an intercepting corporate root CA that is installed system-wide
 * (and therefore fine for chat, which already goes through `customFetch`) made *listing*
 * fail with a certificate error. Sharing the stack keeps both paths agreeing on trust,
 * proxy and error vocabulary (Chromium `net::ERR_CERT_*`, which `classifyErrorCategory`
 * maps to the proxy/SSL diagnosis).
 *
 * `cache: 'no-store'` because Chromium's HTTP cache would otherwise serve a stale
 * `/models` response on a second pull, resurrecting deleted models.
 */
export const modelListFetch: FetchFunction = (input, init) => customFetch(input, { ...init, cache: 'no-store' })

export const ApiErrorSchema = z.object({
  error: z
    .object({
      message: z.string().optional(),
      code: z.string().optional()
    })
    .optional(),
  message: z.string().optional()
})

export type ApiError = z.infer<typeof ApiErrorSchema>

export async function getFromApi<T>({
  url,
  headers,
  responseSchema,
  abortSignal
}: {
  url: string
  headers?: Record<string, string>
  responseSchema: z.ZodType<T>
  abortSignal?: AbortSignal
}): Promise<T> {
  const { value } = await aiSdkGetFromApi({
    url,
    headers,
    successfulResponseHandler: createJsonResponseHandler(zodSchema(responseSchema)),
    failedResponseHandler: createJsonErrorResponseHandler({
      errorSchema: zodSchema(ApiErrorSchema),
      errorToMessage: (error: ApiError) => error.error?.message || error.message || 'Unknown error'
    }),
    abortSignal,
    fetch: modelListFetch
  })

  return value
}
