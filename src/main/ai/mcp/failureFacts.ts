import {
  ProtocolError,
  SdkError,
  SdkErrorCode,
  SdkHttpError,
  SseError,
  UnauthorizedError
} from '@modelcontextprotocol/client'

import type { FailureFacts } from '@shared/types/errorReporting'
import { isCancellation } from '@shared/utils/errorReporting'

export class McpConfigurationError extends Error {}

export function classifyMcpFailure(error: unknown, external: boolean, cancelled = false): FailureFacts {
  const facts: FailureFacts = {
    source: 'application',
    kind: 'unknown',
    reason: 'mcp_failed',
    outcome: 'failed'
  }
  if (cancelled || isCancellation(error))
    return { ...facts, kind: 'expected', reason: 'cancelled', outcome: 'cancelled' }
  if (error instanceof McpConfigurationError)
    return { ...facts, source: 'environment', kind: 'expected', reason: 'configuration' }
  if (UnauthorizedError.isInstance(error)) return { ...facts, source: 'environment', kind: 'expected', reason: 'auth' }
  if (external && (SdkHttpError.isInstance(error) || SseError.isInstance(error) || ProtocolError.isInstance(error))) {
    return { ...facts, source: 'tool', kind: 'expected', reason: 'remote_rejected' }
  }
  if (SdkError.isInstance(error)) {
    if ([SdkErrorCode.NotConnected, SdkErrorCode.AlreadyConnected, SdkErrorCode.NotInitialized].includes(error.code)) {
      return { ...facts, kind: 'defect', reason: 'connection_state' }
    }
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
      ].includes(error.code)
    ) {
      return {
        ...facts,
        source: external ? 'tool' : 'application',
        kind: external ? 'expected' : 'reliability',
        reason: 'protocol_failure'
      }
    }
  }
  if (
    external &&
    error &&
    typeof error === 'object' &&
    'code' in error &&
    ['ENOENT', 'EACCES', 'EPERM', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(
      String(error.code)
    )
  ) {
    return { ...facts, source: 'environment', kind: 'expected', reason: 'transport_unavailable' }
  }
  if (error instanceof TypeError || error instanceof ReferenceError || error instanceof SyntaxError) {
    return { ...facts, kind: 'defect', reason: 'runtime_exception' }
  }
  return facts
}
