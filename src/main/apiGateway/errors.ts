/**
 * Per-dialect error handling for the API gateway.
 *
 * Idiomatic Elysia: route handlers return success values (validated by their
 * `response` schemas) and THROW for failures. The response DIALECT is a property
 * of the request path — AI-proxy endpoints answer in their upstream provider's
 * dialect, Cherry's own endpoints answer in our REST dialect:
 *
 * - `anthropicErrorHandler` (`/v1/messages`): `{ type: 'error', error: { type, message } }`
 * - `openaiErrorHandler` (`/v1/chat`, `/v1/responses`): `{ error: { message, type, code } }`
 * - `restErrorHandler` (Cherry endpoints + fallback): `{ error: { code, message, details? } }`
 *
 * Elysia dispatches built-in failures (`VALIDATION`, `NOT_FOUND`, `PARSE`) and
 * uncaught throws to the OUTERMOST `onError`, which shadows any scoped per-group
 * handler — so a single root `gatewayErrorHandler` selects the dialect by path
 * (`dialectForPath`) and delegates. The app registers `.error({ DATA_API })` so
 * the `code` below is typed to include `'DATA_API'`; `DataApiError`s are mapped
 * here, provider/runtime errors are shaped per-dialect (Anthropic inline via
 * `transformAnthropicError`; OpenAI via `responsesService.transformError`).
 */

import { loggerService } from '@logger'
import { DataApiError } from '@shared/data/api'

import { responsesService } from './services/responses'

const logger = loggerService.withContext('ApiGatewayErrors')

/** Minimal subset of Elysia's `onError` context that the handlers consume. */
interface GatewayErrorContext {
  // `code` is a string for built-in errors (`VALIDATION`, `NOT_FOUND`, …) and the
  // registered `'DATA_API'`; a number for status-thrown errors.
  code: string | number
  error: unknown
  /** Elysia's context `status(code, body)` helper — sets the status and wraps the body. */
  status: (code: number, body: unknown) => unknown
  request: Request
}

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
 * Shape an unknown provider/runtime error into the Anthropic error envelope.
 * Inlined from the former `MessagesService` — this is its only remaining consumer.
 */
function transformAnthropicError(error: unknown): {
  statusCode: number
  errorResponse: { type: 'error'; error: { type: string; message: string; requestId?: string } }
} {
  const err = error as { status?: unknown; error?: { type?: unknown; message?: unknown }; request_id?: unknown }
  let statusCode = 500
  let errorType = 'api_error'
  let errorMessage = 'Internal server error'

  const anthropicStatus = typeof err.status === 'number' ? err.status : undefined
  const anthropicError = err.error

  if (anthropicStatus) {
    statusCode = anthropicStatus
  }
  if (typeof anthropicError?.type === 'string') {
    errorType = anthropicError.type
  }
  if (typeof anthropicError?.message === 'string') {
    errorMessage = anthropicError.message
  } else if (error instanceof Error && error.message) {
    errorMessage = error.message
  }

  // Without a structured Anthropic error, fall back to the error's own `.status`.
  // Don't regex-match `error.message`: upstreams already expose `.status`/`.code`,
  // and a genuine 500 whose message mentions "connection" must not become a 502.
  if (!anthropicStatus && error instanceof Error) {
    const maybeStatus = (error as { status?: unknown }).status
    const status = typeof maybeStatus === 'number' ? maybeStatus : null
    if (status !== null) {
      statusCode = status
      errorType =
        status === 401 || status === 403
          ? 'authentication_error'
          : status === 429
            ? 'rate_limit_error'
            : status >= 500 && status < 600
              ? 'api_error'
              : 'invalid_request_error'
    }
  }

  const safeErrorMessage =
    typeof errorMessage === 'string' && errorMessage.length > 0 ? errorMessage : 'Internal server error'
  const requestId = typeof err.request_id === 'string' ? err.request_id : undefined

  return {
    statusCode,
    errorResponse: { type: 'error', error: { type: errorType, message: safeErrorMessage, requestId } }
  }
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
 * provider/runtime errors to `responsesService.transformError`.
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
  const { statusCode, errorResponse } = responsesService.transformError(error)
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
  return status(500, restEnvelope('INTERNAL_SERVER_ERROR', messageOf(error, 'Internal server error')))
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
