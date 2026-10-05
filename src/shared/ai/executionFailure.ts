import {
  executionFailureSchema,
  type AiFailureReason,
  type ExecutionFailure
} from '@cherrystudio/remote-protocol/failure'

import type { SerializedError } from '../types/error'
import {
  classifyErrorCategory,
  extractHttpStatus,
  isErrorCategory,
  isErrorStage,
  type ErrorCategory,
  type ErrorStage
} from '../utils/errorCategory'
import { getSafeProviderErrorMessage } from './providerError'
import { extractSseErrorFrame } from './sseErrorFrame'

const reasons: Partial<Record<ErrorCategory, AiFailureReason>> = {
  auth: 'auth',
  permission: 'permission',
  region: 'region',
  model: 'model_not_found',
  quota: 'quota',
  rate_limit: 'rate_limit',
  context_length: 'context_length',
  payload: 'payload_too_large',
  network: 'network',
  proxy: 'proxy_tls',
  stream: 'stream_interrupted',
  content: 'content_filter',
  server: 'provider_unavailable',
  mcp: 'mcp',
  parse: 'parse',
  unknown: 'unknown'
}

function safeText(value: unknown, limit: number): string | undefined {
  const text = getSafeProviderErrorMessage({ message: value }).replace(
    /(?:\/(?:Users|home|private|tmp|var|Volumes)\/|[A-Za-z]:\\)[^\s"']+/g,
    '<path>'
  )
  return text ? Array.from(text).slice(0, limit).join('') : undefined
}

/** Opaque messages that name neither a cause nor a stage; each maps to the pipeline
 *  phase actually responsible, so the UI can say more than "no response". */
const NAMED_STAGE_FOR_MESSAGE: ReadonlyArray<readonly [string, ErrorStage]> = [
  ['failed to process successful response', 'parse'],
  ['failed to process error response', 'parse'],
  ['no response', 'runtime'],
  ['an unknown error occurred', 'runtime'],
  ['stream ended without a stop reason', 'parse'],
  ['anthropic stream ended without a stop reason', 'parse'],
  ['request was aborted', 'transport'],
  ['upstream stream ended before completion', 'stream']
]

const TRANSPORT_CODES = new Set([
  'econnreset',
  'econnrefused',
  'enotfound',
  'etimedout',
  'eai_again',
  'ehostunreach',
  'enetunreach',
  'epipe'
])

/**
 * Attribute the failure to a pipeline stage.
 *
 * Order matters: `layer` (who reported it) is decided first because a host-side
 * write failure is always `persistence` regardless of provider status, and a
 * `StreamError` was by construction reported inside an open stream.
 */
function deriveStage(
  error: SerializedError,
  layer: ExecutionFailure['failure']['source']['layer'] | undefined,
  status: number | undefined,
  category: ErrorCategory
): ErrorStage {
  if (layer === 'host') return 'persistence'

  const name = typeof error.name === 'string' ? error.name : ''
  const raw = typeof error.message === 'string' ? error.message : ''
  if (name === 'StreamError') return 'stream'

  const code = typeof error.code === 'string' ? error.code.toLowerCase() : ''
  if (TRANSPORT_CODES.has(code)) return 'transport'

  const normalized = `${name} ${raw}`.toLowerCase()
  for (const [needle, stage] of NAMED_STAGE_FOR_MESSAGE) {
    if (normalized.includes(needle)) return stage
  }

  if (error.claudeCodeExitCategory !== undefined) return 'runtime'
  if (layer === 'tool') return 'runtime'

  // A real HTTP status means the request got through and the provider answered, so
  // the failure is in the response (status or body) rather than the transport.
  if (status !== undefined && status >= 100 && status <= 599) return 'http'
  if (category === 'network' || category === 'proxy') return 'transport'
  if (category === 'stream') return 'stream'
  if (category === 'parse') return 'parse'
  return 'unknown'
}

export function toExecutionFailure(
  error: SerializedError,
  modelId?: string,
  layer?: ExecutionFailure['failure']['source']['layer']
): ExecutionFailure {
  const stored = executionFailureSchema.safeParse(error.executionFailure)
  if (stored.success && !layer) return stored.data
  const raw = typeof error.message === 'string' ? error.message : ''
  // Some providers hand back the whole SSE frame their error rode in on
  // (`… · event:error data:{"type":"error",…}`). Keeping it renders protocol
  // scaffolding in the message; unwrap to the provider's own payload first.
  const frame = extractSseErrorFrame(raw)
  const body = frame?.message ?? raw
  const status = typeof error.statusCode === 'number' ? error.statusCode : (frame?.statusCode ?? extractHttpStatus(raw))
  const category = isErrorCategory(error.providerErrorCategory)
    ? error.providerErrorCategory
    : isErrorCategory(error.claudeCodeExitCategory)
      ? error.claudeCodeExitCategory
      : classifyErrorCategory({ text: [body, frame?.type, frame?.code].filter(Boolean).join('\n'), status })
  const message =
    safeText(
      getSafeProviderErrorMessage({
        message: body,
        responseBody: error.responseBody ?? body.replace(/^\s*\d{3}:\s*/, ''),
        data: error.data
      }),
      500
    ) ?? 'Execution failed'
  const reasonCode = layer === 'host' ? 'internal' : (reasons[category] ?? 'unknown')
  const providerId = safeText(error.providerId ?? modelId?.split('::')[0], 128)
  const model = safeText(modelId ?? error.modelId, 128)
  const source = layer ?? (status || error.providerErrorCategory ? 'provider' : 'runtime')
  const stage = isErrorStage(error.failureStage) ? error.failureStage : deriveStage(error, source, status, category)
  const value: ExecutionFailure = {
    message,
    retryable: error.isRetryable === true && !['auth', 'permission', 'quota', 'internal'].includes(reasonCode),
    failure: {
      version: 1,
      reasonCode,
      source: { layer: source },
      stage,
      context: {
        ...(status && status >= 100 && status <= 599 ? { statusCode: status } : {}),
        ...(providerId ? { providerId } : {}),
        ...(model ? { modelId: model } : {})
      }
    }
  }
  while (new TextEncoder().encode(JSON.stringify(value)).length > 4096)
    value.message = Array.from(value.message)
      .slice(0, Math.floor(Array.from(value.message).length / 2))
      .join('')
  return value
}
