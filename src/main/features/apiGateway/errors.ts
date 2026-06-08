import { loggerService } from '@logger'
import { isDev } from '@main/core/platform'
import { DataApiError } from '@shared/data/api'
import type { ErrorHandler } from 'elysia'

import type { OutputFormat } from './adapters'

const logger = loggerService.withContext('ApiGatewayErrors')

type GatewayErrorContext = Parameters<ErrorHandler<{ DATA_API: DataApiError }>>[0]

const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback

/** Map an HTTP status to the provider-dialect error `type`. */
const typeForStatus = (status: number): string => {
  if (status === 401 || status === 403) return 'authentication_error'
  if (status === 404) return 'not_found_error'
  if (status === 429) return 'rate_limit_error'
  if (status >= 500) return 'server_error'
  return 'invalid_request_error'
}

/** Anthropic dialect envelope. */
const anthropicEnvelope = (type: string, message: string) => ({ type: 'error' as const, error: { type, message } })

/** OpenAI dialect envelope. */
const openaiEnvelope = (type: string, message: string, code: string) => ({ error: { message, type, code } })

/** Cherry REST envelope — mirrors the v2 `DataApiError` vocabulary. */
const restEnvelope = (code: string, message: string, details?: Record<string, unknown>) => ({
  error: { code, message, ...(details ? { details } : {}) }
})

/**
 * Best-effort `{ status, message, type }` from any thrown value — a real `Error`,
 * an OpenAI / AI-SDK error, or a `SerializedError` plain object (carrying
 * `statusCode` / `message`, as produced by `AiStreamManager.onError` and thrown by
 * `processMessage`). Reads only status/message/type; the AI-SDK `APICallError`
 * extras (`stack`, `url`, `requestBodyValues`, `responseBody`, `responseHeaders`)
 * are intentionally ignored so they never reach the client.
 */
function extractError(error: unknown): { status?: number; message?: string; type?: string } {
  if (error === null || typeof error !== 'object') return {}
  const e = error as {
    status?: unknown
    statusCode?: unknown
    message?: unknown
    error?: { type?: unknown; message?: unknown }
  }
  // Prefer `status` (HTTP libs / OpenAI APIError), then `statusCode` (AI-SDK APICallError / SerializedError).
  const status = typeof e.status === 'number' ? e.status : typeof e.statusCode === 'number' ? e.statusCode : undefined
  // Prefer a structured provider message, then the error's own `message`.
  const message =
    typeof e.error?.message === 'string' ? e.error.message : typeof e.message === 'string' ? e.message : undefined
  const type = typeof e.error?.type === 'string' ? e.error.type : undefined
  return { status, message, type }
}

/**
 * Resolve the client-facing message. Provider errors (those carrying a real HTTP
 * status) surface their own message — that's the v1 passthrough behaviour, and the
 * message is not the leak this guards against (the AI-SDK extras are, and those are
 * dropped in `extractError`). Unexpected internal errors (no status) are gated
 * behind `isDev` so internal detail never ships to clients in production.
 */
function safeMessage(status: number | undefined, message: string | undefined): string {
  const fallback = 'Internal server error'
  if (status !== undefined) return message && message.length > 0 ? message : fallback
  return isDev && message && message.length > 0 ? message : fallback
}

/** Anthropic error `type` for a status (the Anthropic vocabulary uses `api_error` for 5xx). */
const anthropicTypeForStatus = (status: number): string => {
  if (status === 401 || status === 403) return 'authentication_error'
  if (status === 404) return 'not_found_error'
  if (status === 429) return 'rate_limit_error'
  if (status >= 500) return 'api_error'
  return 'invalid_request_error'
}

/**
 * Shape an unknown provider/runtime error into the Anthropic error envelope.
 * Inlined from the former `MessagesService`. Status-driven so it correctly maps the
 * `SerializedError` plain objects `processMessage` now throws (which carry
 * `statusCode`, not `status`) instead of flattening every provider error to 500.
 */
function transformAnthropicError(error: unknown): {
  statusCode: number
  errorResponse: { type: 'error'; error: { type: string; message: string; requestId?: string } }
} {
  const { status, message, type } = extractError(error)
  const statusCode = status ?? 500
  const errorType = type ?? anthropicTypeForStatus(statusCode)
  const requestId =
    error !== null && typeof error === 'object' && typeof (error as { request_id?: unknown }).request_id === 'string'
      ? (error as { request_id: string }).request_id
      : undefined
  return {
    statusCode,
    errorResponse: { type: 'error', error: { type: errorType, message: safeMessage(status, message), requestId } }
  }
}

/** OpenAI error `{ type, code }` for a status. */
const openaiTypeAndCodeForStatus = (status: number): { type: string; code: string } => {
  if (status === 401) return { type: 'authentication_error', code: 'invalid_api_key' }
  if (status === 403) return { type: 'forbidden_error', code: 'forbidden' }
  if (status === 404) return { type: 'not_found_error', code: 'not_found' }
  if (status === 429) return { type: 'rate_limit_error', code: 'rate_limit_exceeded' }
  if (status >= 500) return { type: 'server_error', code: 'internal_error' }
  return { type: 'invalid_request_error', code: 'bad_request' }
}

/**
 * Shape an unknown provider/runtime error into the OpenAI error envelope (used by
 * `/v1/chat` and `/v1/responses`). Replaces the former `ResponsesService.transformError`:
 * status-driven rather than `instanceof OpenAI.APIError` + message regex, so it
 * correctly maps the `SerializedError` plain objects `processMessage` now throws.
 */
function transformOpenAiError(error: unknown): {
  statusCode: number
  errorResponse: { error: { message: string; type: string; code: string } }
} {
  const { status, message } = extractError(error)
  const statusCode = status ?? 500
  const { type, code } = openaiTypeAndCodeForStatus(statusCode)
  return { statusCode, errorResponse: { error: { message: safeMessage(status, message), type, code } } }
}

/**
 * Build a per-dialect SSE error frame for a terminal stream error or idle-timeout.
 * Reuses the same envelopes the HTTP handlers emit (message/type only — never the
 * AI-SDK error extras), so the streaming and non-streaming error shapes match and
 * neither leaks `stack` / `url` / request/response bodies to the client.
 */
export function buildStreamErrorFrame(outputFormat: OutputFormat, error: unknown): string {
  if (outputFormat === 'anthropic') {
    const { errorResponse } = transformAnthropicError(error)
    return `event: error\ndata: ${JSON.stringify(errorResponse)}\n\n`
  }
  const { errorResponse } = transformOpenAiError(error)
  if (outputFormat === 'openai-responses') {
    // Responses streams use named events; `type: 'error'` is the event discriminator,
    // distinct from the OpenAI error `type` (carried as part of the message envelope).
    const { message, code } = errorResponse.error
    return `event: error\ndata: ${JSON.stringify({ type: 'error', code, message })}\n\n`
  }
  return `data: ${JSON.stringify(errorResponse)}\n\n`
}

/**
 * Anthropic-dialect error handler (`/v1/messages`). Shapes built-in failures and
 * `DataApiError`s into the Anthropic envelope; delegates provider/runtime errors
 * to `transformAnthropicError`.
 */
export function anthropicErrorHandler({ code, error, status }: GatewayErrorContext) {
  if (code === 'VALIDATION') {
    return status(400, anthropicEnvelope('invalid_request_error', messageOf(error, 'Invalid request parameters')))
  }
  if (code === 'NOT_FOUND') {
    return status(404, anthropicEnvelope('not_found_error', 'Not found'))
  }
  if (code === 'PARSE') {
    return status(400, anthropicEnvelope('invalid_request_error', 'Malformed request body'))
  }
  if (error instanceof DataApiError) {
    return status(error.status, anthropicEnvelope(typeForStatus(error.status), error.message))
  }

  logger.error('API gateway request error', { code, error })
  const { statusCode, errorResponse } = transformAnthropicError(error)
  return status(statusCode, errorResponse)
}

/**
 * OpenAI-dialect error handler (`/v1/chat`, `/v1/responses`). Shapes built-in
 * failures and `DataApiError`s into the OpenAI envelope; delegates
 * provider/runtime errors to `transformOpenAiError`.
 */
export function openaiErrorHandler({ code, error, status }: GatewayErrorContext) {
  if (code === 'VALIDATION') {
    return status(
      400,
      openaiEnvelope('invalid_request_error', messageOf(error, 'Invalid request parameters'), 'invalid_parameters')
    )
  }
  if (code === 'NOT_FOUND') {
    return status(404, openaiEnvelope('not_found_error', 'Not found', 'not_found'))
  }
  if (code === 'PARSE') {
    return status(400, openaiEnvelope('invalid_request_error', 'Malformed request body', 'parse_error'))
  }
  if (error instanceof DataApiError) {
    return status(error.status, openaiEnvelope(typeForStatus(error.status), error.message, error.code.toLowerCase()))
  }

  logger.error('API gateway request error', { code, error })
  const { statusCode, errorResponse } = transformOpenAiError(error)
  return status(statusCode, errorResponse)
}

/**
 * Cherry REST error handler — for Cherry's own endpoints (`knowledge-bases`,
 * `models`) and the app-level fallback (`/health`, `/`, unmatched routes). Speaks
 * the same `{ error: { code, message, details? } }` vocabulary as the v2 data
 * layer (`ErrorCode` / `ERROR_STATUS_MAP`), so there is no provider delegate.
 */
export function restErrorHandler({ code, error, status }: GatewayErrorContext) {
  if (error instanceof DataApiError) {
    return status(error.status, restEnvelope(error.code, error.message, error.details as Record<string, unknown>))
  }
  if (code === 'VALIDATION') {
    return status(422, restEnvelope('VALIDATION_ERROR', messageOf(error, 'Invalid request parameters')))
  }
  if (code === 'NOT_FOUND') {
    return status(404, restEnvelope('NOT_FOUND', 'Not found'))
  }
  if (code === 'PARSE') {
    return status(400, restEnvelope('BAD_REQUEST', 'Malformed request body'))
  }

  logger.error('API gateway request error', { code, error })
  // Don't leak raw internal error messages to clients in production.
  return status(
    500,
    restEnvelope('INTERNAL_SERVER_ERROR', isDev ? messageOf(error, 'Internal server error') : 'Internal server error')
  )
}

/** Select the response dialect from the request path. */
function dialectForPath(request: Request): 'anthropic' | 'openai' | 'rest' {
  let pathname = ''
  try {
    pathname = new URL(request.url).pathname
  } catch {
    return 'rest'
  }
  if (pathname.startsWith('/v1/messages')) return 'anthropic'
  if (pathname.startsWith('/v1/chat') || pathname.startsWith('/v1/responses')) return 'openai'
  return 'rest'
}

/**
 * Root `onError` for the whole app. Picks the dialect from the request path and
 * delegates to the matching handler. Registered once at the app level because
 * Elysia routes built-in/validation errors to the outermost handler — a scoped
 * per-group handler would be shadowed by this fallback.
 */
export function gatewayErrorHandler(ctx: GatewayErrorContext) {
  switch (dialectForPath(ctx.request)) {
    case 'anthropic':
      return anthropicErrorHandler(ctx)
    case 'openai':
      return openaiErrorHandler(ctx)
    default:
      return restErrorHandler(ctx)
  }
}
