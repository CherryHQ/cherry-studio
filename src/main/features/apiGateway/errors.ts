import { loggerService } from '@logger'
import { isDev } from '@main/core/platform'
import { ErrorCode, JSONRPC_VERSION } from '@modelcontextprotocol/sdk/types.js'
import { DataApiError } from '@shared/data/api/errors'
import type { SerializedError } from '@shared/types/error'
import type { ErrorHandler } from 'elysia'

import type { OutputFormat } from './adapters'

const logger = loggerService.withContext('ApiGatewayErrors')
const GATEWAY_PROVIDER_ERROR_KIND = 'upstream_provider'

type GatewayErrorContext = Parameters<ErrorHandler<{ DATA_API: DataApiError }>>[0]

export function withGatewayProviderContext(
  error: SerializedError,
  providerId: string,
  modelId: string
): SerializedError {
  if (typeof error.statusCode !== 'number') return error
  return {
    ...error,
    gatewayErrorKind: GATEWAY_PROVIDER_ERROR_KIND,
    requestedProviderId: providerId,
    requestedModelId: modelId
  }
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
 * JSON-RPC 2.0 error envelope for the MCP proxy. Not typed as the SDK's
 * `JSONRPCErrorResponse`: that type declares `id?: string | number`, while the SDK's own
 * Streamable HTTP transport writes `id: null` for errors with no request to attribute
 * them to. The wire shape a client sees is what has to match, so it wins over the type.
 */
export const MCP_TRANSPORT_ERROR = -32000

export const jsonRpcEnvelope = (code: ErrorCode | typeof MCP_TRANSPORT_ERROR, message: string) => ({
  jsonrpc: JSONRPC_VERSION,
  error: { code, message },
  id: null
})

/** Google (Gemini) dialect envelope: `{ error: { code, message, status } }`. */
export const googleEnvelope = (httpStatus: number, message: string) => ({
  error: { code: httpStatus, message, status: googleStatusName(httpStatus) }
})

/** Map an HTTP status to the Google canonical `status` string. */
function googleStatusName(status: number): string {
  switch (status) {
    case 400:
      return 'INVALID_ARGUMENT'
    case 401:
      return 'UNAUTHENTICATED'
    case 403:
      return 'PERMISSION_DENIED'
    case 404:
      return 'NOT_FOUND'
    case 429:
      return 'RESOURCE_EXHAUSTED'
    case 500:
      return 'INTERNAL'
    case 503:
      return 'UNAVAILABLE'
    case 504:
      return 'DEADLINE_EXCEEDED'
    default:
      return status >= 500 ? 'INTERNAL' : 'INVALID_ARGUMENT'
  }
}

/**
 * Best-effort status, message, type, and gateway provider context from any thrown
 * value. AI-SDK `APICallError` extras (`stack`, `url`, request/response bodies and
 * headers) are intentionally ignored so they never reach the client.
 */
function extractError(error: unknown): {
  status?: number
  message?: string
  type?: string
  requestedProviderId?: string
  requestedModelId?: string
  isGatewayProviderError: boolean
} {
  if (error === null || typeof error !== 'object') return { isGatewayProviderError: false }
  const e = error as {
    status?: unknown
    statusCode?: unknown
    message?: unknown
    error?: { type?: unknown; message?: unknown }
    gatewayErrorKind?: unknown
    requestedProviderId?: unknown
    requestedModelId?: unknown
  }
  // Prefer `status` (HTTP libs / OpenAI APIError), then `statusCode` (AI-SDK APICallError / SerializedError).
  const status = typeof e.status === 'number' ? e.status : typeof e.statusCode === 'number' ? e.statusCode : undefined
  // Prefer a structured provider message, then the error's own `message`.
  const message =
    typeof e.error?.message === 'string' ? e.error.message : typeof e.message === 'string' ? e.message : undefined
  const type = typeof e.error?.type === 'string' ? e.error.type : undefined
  const requestedProviderId =
    typeof e.requestedProviderId === 'string' && e.requestedProviderId.length > 0 ? e.requestedProviderId : undefined
  const requestedModelId =
    typeof e.requestedModelId === 'string' && e.requestedModelId.length > 0 ? e.requestedModelId : undefined
  return {
    status,
    message,
    type,
    requestedProviderId,
    requestedModelId,
    isGatewayProviderError: e.gatewayErrorKind === GATEWAY_PROVIDER_ERROR_KIND
  }
}

function gatewayProviderMessage(status: number, requestedProviderId: string, requestedModelId: string): string {
  const requestedAddress = `${requestedProviderId}:${requestedModelId}`
  let summary: string
  if (status === 401) {
    summary = `Gateway request for "${requestedAddress}" received an upstream authentication failure. Check the requested route, any configured fallback, and account access.`
  } else if (status === 403) {
    summary = `Gateway request for "${requestedAddress}" received an upstream access denial. Check the requested route, any configured fallback, and model permissions.`
  } else if (status === 429) {
    summary = `Gateway request for "${requestedAddress}" received an upstream rate limit. Check the requested route, any configured fallback, and provider quota before retrying.`
  } else {
    summary = `Gateway request for "${requestedAddress}" failed upstream (HTTP ${status}). Check the requested route, any configured fallback, and model access.`
  }
  return summary
}

/**
 * Resolve the client-facing message. Tagged gateway provider failures use only
 * status and gateway-owned context because upstream text may echo private request
 * content. Untagged status errors keep the compatibility passthrough; unexpected
 * internal errors are gated behind `isDev`.
 */
function safeMessage(
  status: number | undefined,
  message: string | undefined,
  context?: { isGatewayProviderError: boolean; requestedProviderId?: string; requestedModelId?: string }
): string {
  const fallback = 'Internal server error'
  if (
    status !== undefined &&
    context?.isGatewayProviderError &&
    context.requestedProviderId &&
    context.requestedModelId
  ) {
    return gatewayProviderMessage(status, context.requestedProviderId, context.requestedModelId)
  }
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
  const { status, message, type, ...context } = extractError(error)
  const statusCode = status ?? 500
  const errorType = type ?? anthropicTypeForStatus(statusCode)
  const requestId =
    error !== null && typeof error === 'object' && typeof (error as { request_id?: unknown }).request_id === 'string'
      ? (error as { request_id: string }).request_id
      : undefined
  return {
    statusCode,
    errorResponse: {
      type: 'error',
      error: { type: errorType, message: safeMessage(status, message, context), requestId }
    }
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
  const { status, message, ...context } = extractError(error)
  const statusCode = status ?? 500
  const { type, code } = openaiTypeAndCodeForStatus(statusCode)
  return { statusCode, errorResponse: { error: { message: safeMessage(status, message, context), type, code } } }
}

/**
 * Shape an unknown provider/runtime error into the Google (Gemini) error envelope
 * (used by `/v1beta`). Status-driven, mirroring the other transformers, so it maps
 * the `SerializedError` plain objects `processMessage` throws (which carry
 * `statusCode`, not `status`) correctly instead of flattening everything to 500.
 */
function transformGoogleError(error: unknown): {
  statusCode: number
  errorResponse: { error: { code: number; message: string; status: string } }
} {
  const { status, message, ...context } = extractError(error)
  const statusCode = status ?? 500
  return { statusCode, errorResponse: googleEnvelope(statusCode, safeMessage(status, message, context)) }
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
  if (outputFormat === 'gemini') {
    // Gemini SSE delivers a mid-stream error as a plain `data:` frame carrying the
    // standard error envelope (no named event).
    const { errorResponse } = transformGoogleError(error)
    return `data: ${JSON.stringify(errorResponse)}\n\n`
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
 * Google-dialect error handler (`/v1beta`). Shapes built-in failures and
 * `DataApiError`s into the Google envelope; delegates provider/runtime errors to
 * `transformGoogleError`.
 */
export function googleErrorHandler({ code, error, status }: GatewayErrorContext) {
  if (code === 'VALIDATION') {
    return status(400, googleEnvelope(400, messageOf(error, 'Invalid request parameters')))
  }
  if (code === 'NOT_FOUND') {
    return status(404, googleEnvelope(404, 'Not found'))
  }
  if (code === 'PARSE') {
    return status(400, googleEnvelope(400, 'Malformed request body'))
  }
  if (error instanceof DataApiError) {
    return status(error.status, googleEnvelope(error.status, error.message))
  }

  logger.error('API gateway request error', { code, error })
  const { statusCode, errorResponse } = transformGoogleError(error)
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

/**
 * MCP proxy dialect (`POST /v1/mcps/:id/mcp`). The peer is an MCP transport, not a REST
 * client, so a framework-level failure it never reaches the route for — a body Elysia
 * could not parse, an unknown server id — must still arrive as JSON-RPC.
 *
 * `MCP_TRANSPORT_ERROR` for the resource failures: `ErrorCode` names -32000
 * `ConnectionClosed`, which is not what happened, and it is the code both the SDK's
 * transport and this route's 403/405 responders already use for a transport-level refusal.
 */
function mcpErrorHandler({ code, error, status }: GatewayErrorContext) {
  if (code === 'PARSE') {
    return status(400, jsonRpcEnvelope(ErrorCode.ParseError, 'Parse error'))
  }
  if (code === 'VALIDATION') {
    return status(400, jsonRpcEnvelope(ErrorCode.InvalidRequest, messageOf(error, 'Invalid Request')))
  }
  if (code === 'NOT_FOUND') {
    return status(404, jsonRpcEnvelope(MCP_TRANSPORT_ERROR, 'Not found'))
  }
  if (error instanceof DataApiError) {
    return status(error.status, jsonRpcEnvelope(MCP_TRANSPORT_ERROR, error.message))
  }

  logger.error('API gateway request error', { code, error })
  return status(
    500,
    jsonRpcEnvelope(ErrorCode.InternalError, isDev ? messageOf(error, 'Internal error') : 'Internal error')
  )
}

/** Only the JSON-RPC proxy leaf speaks MCP; `/v1/mcps` and `/v1/mcps/:id` stay REST. */
const MCP_PROXY_PATH = /^\/v1\/mcps\/[^/]+\/mcp$/

/** Select the response dialect from the request path. */
function dialectForPath(request: Request): 'anthropic' | 'openai' | 'google' | 'mcp' | 'rest' {
  let pathname = ''
  try {
    pathname = new URL(request.url).pathname
  } catch {
    return 'rest'
  }
  if (pathname.startsWith('/v1/messages')) return 'anthropic'
  if (pathname.startsWith('/v1/chat') || pathname.startsWith('/v1/responses')) return 'openai'
  if (pathname.startsWith('/v1beta')) return 'google'
  if (MCP_PROXY_PATH.test(pathname)) return 'mcp'
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
    case 'google':
      return googleErrorHandler(ctx)
    case 'mcp':
      return mcpErrorHandler(ctx)
    default:
      return restErrorHandler(ctx)
  }
}
