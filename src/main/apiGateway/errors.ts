/**
 * Centralized error handling for the API gateway.
 *
 * The gateway speaks two error dialects, so a single global `onError` picks the
 * envelope by request path rather than duplicating shaping in every handler:
 *
 * - Anthropic dialect (`/v1/messages*`): `{ type: 'error', error: { type, message } }`
 * - OpenAI dialect (everything else): `{ error: { message, type, code } }`
 *
 * `VALIDATION` failures become a 400 in the matching dialect; all other errors
 * delegate to the existing per-dialect `transformError` services.
 */

import { loggerService } from '@logger'

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

/** Anthropic routes live under `/v1/messages`. */
const isAnthropicPath = (request: Request): boolean => {
  try {
    return new URL(request.url).pathname.includes('/v1/messages')
  } catch {
    return false
  }
}

/**
 * Global gateway error handler — shapes every error into the dialect matching
 * the request path, using the context `status()` helper to set the HTTP status.
 */
export function gatewayErrorHandler({ code, error, status, request }: GatewayErrorContext) {
  const anthropic = isAnthropicPath(request)

  if (code === 'VALIDATION') {
    const message = messageOf(error, 'Invalid request parameters')
    return status(
      400,
      anthropic
        ? { type: 'error', error: { type: 'invalid_request_error', message } }
        : { error: { message, type: 'invalid_request_error', code: 'invalid_parameters' } }
    )
  }

  logger.error('API gateway request error', { code, error })
  const { statusCode, errorResponse } = anthropic
    ? messagesService.transformError(error)
    : responsesService.transformError(error)
  return status(statusCode, errorResponse)
}
