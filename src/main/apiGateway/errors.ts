/**
 * Centralized error handling for the API gateway.
 *
 * Idiomatic Elysia: route handlers return success values (validated by their
 * `response` schemas) and THROW for failures; this single global `onError` shapes
 * every error into the dialect matching the request path:
 *
 * - Anthropic dialect (`/v1/messages*`): `{ type: 'error', error: { type, message } }`
 * - OpenAI dialect (everything else): `{ error: { message, type, code } }`
 *
 * `VALIDATION` failures and v2 `DataApiError`s are mapped here; provider/runtime
 * errors delegate to the existing per-dialect `transformError` services.
 */

import { loggerService } from '@logger'
import { DataApiError } from '@shared/data/api'

import { messagesService } from './services/messages'
import { responsesService } from './services/responses'

const logger = loggerService.withContext('ApiGatewayErrors')

/** Minimal subset of Elysia's `onError` context that the handler consumes. */
interface GatewayErrorContext {
  // `code` is a string for built-in errors (`VALIDATION`, `NOT_FOUND`, …) and a
  // number for status-thrown errors.
  code: string | number
  error: unknown
  /** Elysia's context `status(code, body)` helper — sets the status and wraps the body. */
  status: (code: number, body: unknown) => unknown
  request: Request
}

const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback

/** Map an HTTP status to the gateway's error `type`. */
const typeForStatus = (status: number): string => {
  if (status === 401 || status === 403) return 'authentication_error'
  if (status === 404) return 'not_found_error'
  if (status === 429) return 'rate_limit_error'
  if (status >= 500) return 'server_error'
  return 'invalid_request_error'
}

/** Build the error envelope in the dialect matching the request path. */
const envelope = (anthropic: boolean, type: string, message: string, code: string) =>
  anthropic ? { type: 'error' as const, error: { type, message } } : { error: { message, type, code } }

/** Anthropic routes live under `/v1/messages`. */
const isAnthropicPath = (request: Request): boolean => {
  try {
    return new URL(request.url).pathname.includes('/v1/messages')
  } catch {
    return false
  }
}

/**
 * Global gateway error handler — shapes every thrown/validation error into the
 * dialect matching the request path, using the context `status()` helper.
 */
export function gatewayErrorHandler({ code, error, status, request }: GatewayErrorContext) {
  const anthropic = isAnthropicPath(request)

  if (code === 'VALIDATION') {
    return status(
      400,
      envelope(anthropic, 'invalid_request_error', messageOf(error, 'Invalid request parameters'), 'invalid_parameters')
    )
  }

  // Elysia built-in errors for unmatched routes / unparseable bodies. Handle them
  // explicitly so they never reach the provider `transformError` services.
  if (code === 'NOT_FOUND') {
    return status(404, envelope(anthropic, 'not_found_error', 'Not found', 'not_found'))
  }
  if (code === 'PARSE') {
    return status(400, envelope(anthropic, 'invalid_request_error', 'Malformed request body', 'parse_error'))
  }

  // v2 data-layer errors carry their own HTTP status + code (e.g. NOT_FOUND → 404).
  if (error instanceof DataApiError) {
    const type = typeForStatus(error.status)
    return status(error.status, envelope(anthropic, type, error.message, error.code.toLowerCase()))
  }

  logger.error('API gateway request error', { code, error })
  const { statusCode, errorResponse } = anthropic
    ? messagesService.transformError(error)
    : responsesService.transformError(error)
  return status(statusCode, errorResponse)
}
