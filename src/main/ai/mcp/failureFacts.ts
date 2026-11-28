import {
  ProtocolError,
  SdkError,
  SdkErrorCode,
  SdkHttpError,
  SseError,
  UnauthorizedError
} from '@modelcontextprotocol/client'

import type { FailureFacts } from '@shared/types/errorReporting'
import { classifyErrorCategory } from '@shared/utils/errorCategory'
import { isCancellation } from '@shared/utils/errorReporting'

export class McpConfigurationError extends Error {}

class McpTransportError extends Error {
  constructor(cause: Error) {
    super(cause.message, { cause })
    this.name = 'McpTransportError'
  }
}

const TRANSPORT_CODES = new Set([
  'ENOENT',
  'EACCES',
  'EPERM',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN'
])
const MAX_CAUSE_DEPTH = 16
const CONNECTION_STATE_CODES = new Set([
  SdkErrorCode.NotConnected,
  SdkErrorCode.AlreadyConnected,
  SdkErrorCode.NotInitialized
])

function errorCauses(error: unknown): object[] {
  const causes: object[] = []
  const seen = new Set<object>()
  while (error && typeof error === 'object' && !seen.has(error) && causes.length < MAX_CAUSE_DEPTH) {
    causes.push(error)
    seen.add(error)
    error = 'cause' in error ? error.cause : undefined
  }
  return causes
}

/** Preserve transport provenance before the SDK wraps an Electron/Node fetch failure. */
export function normalizeMcpTransportError(error: unknown): unknown {
  if (!(error instanceof Error) || error instanceof McpTransportError) return error
  const causes = errorCauses(error)
  if (
    causes.some(
      (cause) =>
        cause instanceof ReferenceError ||
        cause instanceof SyntaxError ||
        (cause instanceof TypeError && cause.message !== 'fetch failed') ||
        (SdkError.isInstance(cause) && CONNECTION_STATE_CODES.has(cause.code))
    )
  )
    return error
  // Node fetch's TypeError needs its structured errno cause, not only the canonical message.
  const nodeTransport = causes.some((cause) => 'code' in cause && TRANSPORT_CODES.has(String(cause.code)))
  const chromiumTransport =
    error.name === 'Error' &&
    /^net::ERR_[A-Z0-9_]+$/.test(error.message) &&
    ['network', 'stream', 'proxy'].includes(classifyErrorCategory({ text: error.message }))
  return nodeTransport || chromiumTransport ? new McpTransportError(error) : error
}

export function classifyMcpFailure(error: unknown, external: boolean, cancelled = false): FailureFacts {
  const facts: FailureFacts = {
    source: 'application',
    kind: 'unknown',
    reason: 'mcp_failed',
    outcome: 'failed'
  }
  if (cancelled || isCancellation(error))
    return { ...facts, kind: 'expected', reason: 'cancelled', outcome: 'cancelled' }
  const causes = errorCauses(error)
  if (causes.some((cause) => SdkError.isInstance(cause) && CONNECTION_STATE_CODES.has(cause.code))) {
    return { ...facts, kind: 'defect', reason: 'connection_state' }
  }
  for (const cause of causes) {
    if (cause instanceof McpTransportError) {
      return {
        ...facts,
        source: 'environment',
        kind: external ? 'expected' : 'reliability',
        reason: 'transport_unavailable'
      }
    }
    if (isCancellation(cause)) return { ...facts, kind: 'expected', reason: 'cancelled', outcome: 'cancelled' }
    if (cause instanceof McpConfigurationError)
      return { ...facts, source: 'environment', kind: 'expected', reason: 'configuration' }
    if (UnauthorizedError.isInstance(cause))
      return { ...facts, source: 'environment', kind: 'expected', reason: 'auth' }
    if (external && (SdkHttpError.isInstance(cause) || SseError.isInstance(cause) || ProtocolError.isInstance(cause))) {
      return { ...facts, source: 'tool', kind: 'expected', reason: 'remote_rejected' }
    }
    if (SdkError.isInstance(cause)) {
      if (
        [
          SdkErrorCode.RequestTimeout,
          SdkErrorCode.ConnectionClosed,
          SdkErrorCode.SendFailed,
          SdkErrorCode.InvalidResult,
          SdkErrorCode.CapabilityNotSupported,
          SdkErrorCode.MethodNotSupportedByProtocolVersion,
          SdkErrorCode.UnsupportedResultType,
          SdkErrorCode.InputRequiredRoundsExceeded,
          SdkErrorCode.ListPaginationExceeded
        ].includes(cause.code)
      ) {
        return {
          ...facts,
          source: external ? 'tool' : 'application',
          kind: external ? 'expected' : 'reliability',
          reason: 'protocol_failure'
        }
      }
    }
    if (cause instanceof TypeError || cause instanceof ReferenceError || cause instanceof SyntaxError) {
      return { ...facts, kind: 'defect', reason: 'runtime_exception' }
    }
    if (external && 'code' in cause && TRANSPORT_CODES.has(String(cause.code))) {
      return { ...facts, source: 'environment', kind: 'expected', reason: 'transport_unavailable' }
    }
  }
  return facts
}
