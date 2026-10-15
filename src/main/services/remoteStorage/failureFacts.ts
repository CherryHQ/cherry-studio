import type { FailureFacts } from '@shared/types/errorReporting'
import { isCancellation } from '@shared/utils/errorReporting'

export function classifyStorageFailure(error: unknown): FailureFacts {
  if (isCancellation(error)) {
    return { source: 'environment', kind: 'expected', reason: 'cancelled', outcome: 'cancelled' }
  }
  if (error instanceof TypeError || error instanceof ReferenceError || error instanceof SyntaxError) {
    return { source: 'application', kind: 'defect', reason: 'storage_defect', outcome: 'failed' }
  }
  if (error && typeof error === 'object') {
    const value = error as { status?: number; $metadata?: { httpStatusCode?: number }; code?: string }
    const status = value.$metadata?.httpStatusCode ?? value.status
    if (
      typeof status === 'number' &&
      ([401, 403, 404, 408, 409, 412, 423, 429].includes(status) || (status >= 500 && status <= 599))
    ) {
      return { source: 'environment', kind: 'expected', reason: 'storage_remote_unavailable', outcome: 'failed' }
    }
    if (
      value.code &&
      [
        'ENOTFOUND',
        'EAI_AGAIN',
        'ECONNREFUSED',
        'ECONNRESET',
        'ETIMEDOUT',
        'ENETUNREACH',
        'EHOSTUNREACH',
        'DEPTH_ZERO_SELF_SIGNED_CERT',
        'SELF_SIGNED_CERT_IN_CHAIN',
        'CERT_HAS_EXPIRED',
        'ERR_TLS_CERT_ALTNAME_INVALID',
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
      ].includes(value.code)
    ) {
      return { source: 'environment', kind: 'expected', reason: 'storage_connection_failed', outcome: 'failed' }
    }
  }
  return { source: 'application', kind: 'unknown', reason: 'storage_failed', outcome: 'failed' }
}
