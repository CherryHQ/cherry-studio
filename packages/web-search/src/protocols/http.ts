import * as z from 'zod'

import type { ProtocolContext, WebSearchHttpRequest, WebSearchHttpResponse } from '../types'
import { WebSearchError } from '../WebSearchError'

export function apiUrl(apiHost: string, path: string): string {
  return new URL(path.replace(/^\//, ''), `${apiHost.replace(/\/+$/, '')}/`).toString()
}

export function bearer(context: ProtocolContext): Record<string, string> {
  const key = context.call.credentials?.apiKey
  return key ? { Authorization: `Bearer ${key}` } : {}
}

export function protocolError(
  context: ProtocolContext,
  code: string,
  message: string,
  providerCode?: string
): WebSearchError {
  return new WebSearchError({
    ...context.call,
    kind: 'provider',
    code,
    message: safeText(context, message, 500),
    providerCode: safeText(context, providerCode, 128) || undefined
  })
}

export function invalidResponse(context: ProtocolContext, code: string, message: string): WebSearchError {
  return new WebSearchError({ ...context.call, kind: 'invalid_response', code, message })
}

function safeText(context: ProtocolContext, value: unknown, limit: number): string {
  let text = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  for (const secret of [context.call.credentials?.apiKey, context.call.credentials?.basicAuth?.password]) {
    if (secret) text = text.split(secret).join('[redacted]')
  }
  return text.trim().slice(0, limit)
}

const errorSchema = z.looseObject({
  code: z.union([z.string(), z.number()]).optional(),
  error_code: z.union([z.string(), z.number()]).optional(),
  message: z.string().optional(),
  error_msg: z.string().optional(),
  msg: z.string().nullish(),
  error: z.union([z.string(), z.looseObject({ message: z.string().optional() })]).optional()
})

export async function requestText(
  context: ProtocolContext,
  request: Omit<WebSearchHttpRequest, 'signal' | 'timeoutMs'>
): Promise<WebSearchHttpResponse> {
  const response = await context.transport.request({
    ...request,
    signal: context.call.signal,
    timeoutMs: context.call.timeoutMs
  })
  if (context.call.signal?.aborted) throw context.call.signal.reason
  if (response.status < 200 || response.status >= 300) {
    let decoded: z.infer<typeof errorSchema> | undefined
    try {
      const parsed = errorSchema.safeParse(JSON.parse(response.bodyText))
      if (parsed.success) decoded = parsed.data
    } catch {
      /* Error bodies can be plain text. */
    }
    const error = decoded?.error
    const message = safeText(
      context,
      decoded?.message ?? decoded?.error_msg ?? decoded?.msg ?? (typeof error === 'string' ? error : error?.message),
      500
    )
    throw new WebSearchError({
      ...context.call,
      kind: 'http',
      code: 'http_error',
      status: response.status,
      message: `${context.call.providerId} request failed: HTTP ${response.status}${message ? ` ${message}` : ''}`,
      providerCode: safeText(context, decoded?.code ?? decoded?.error_code, 128) || undefined,
      retryAfter: safeText(context, response.headers['retry-after'], 128) || undefined,
      requestId: safeText(context, response.headers['x-request-id'], 128) || undefined
    })
  }
  return response
}

export async function requestJson<T>(
  context: ProtocolContext,
  request: { url: string; method: 'GET' | 'POST'; headers?: Record<string, string>; body?: unknown },
  schema: z.ZodType<T>,
  checkError?: (payload: unknown) => void
): Promise<T> {
  const response = await requestText(context, {
    ...request,
    headers: { ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...request.headers },
    body: request.body === undefined ? undefined : JSON.stringify(request.body)
  })
  let payload: unknown
  try {
    payload = JSON.parse(response.bodyText)
  } catch {
    throw invalidResponse(context, 'invalid_json', `${context.call.providerId} returned invalid JSON`)
  }
  checkError?.(payload)
  const parsed = schema.safeParse(payload)
  if (!parsed.success)
    throw invalidResponse(context, 'schema_mismatch', `${context.call.providerId} response validation failed`)
  return parsed.data
}

export function checkProviderError(
  context: ProtocolContext,
  payload: unknown,
  field: 'code' | 'error_code' | 'success'
): void {
  const parsed = errorSchema.extend({ success: z.boolean().optional() }).safeParse(payload)
  if (!parsed.success) return
  const value = parsed.data[field]
  if (value === undefined || (field === 'success' ? value !== false : value === 200)) return
  throw protocolError(
    context,
    'provider_error',
    parsed.data.error_msg ??
      parsed.data.msg ??
      (typeof parsed.data.error === 'string' ? parsed.data.error : undefined) ??
      'The provider reported a failure',
    String(value)
  )
}
