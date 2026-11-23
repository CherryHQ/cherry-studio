import type { FailureFacts } from '@shared/types/errorReporting'
import { isCancellation } from '@shared/utils/errorReporting'

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Storage SDKs reject different failure shapes; verify HTTP metadata and transport codes before assigning an environment category.
export function classifyStorageFailure(error: unknown): FailureFacts {
  try {
    if (isCancellation(error)) {
      return { source: 'environment', kind: 'expected', reason: 'cancelled', outcome: 'cancelled' }
    }

    if (error instanceof TypeError || error instanceof ReferenceError || error instanceof SyntaxError) {
      return { source: 'application', kind: 'defect', reason: 'storage_defect', outcome: 'failed' }
    }

    if (error && typeof error === 'object') {
      const metadata = '$metadata' in error ? error.$metadata : undefined

      const metadataStatus =
        typeof metadata === 'object' && metadata !== null && 'httpStatusCode' in metadata
          ? metadata.httpStatusCode
          : undefined

      const status = metadataStatus ?? ('status' in error ? error.status : undefined)

      if (
        typeof status === 'number' &&
        ([401, 403, 404, 408, 409, 412, 413, 423, 429].includes(status) || (status >= 500 && status <= 599))
      ) {
        return { source: 'environment', kind: 'expected', reason: 'storage_remote_unavailable', outcome: 'failed' }
      }

      const code = 'code' in error ? error.code : undefined

      if (
        typeof code === 'string' &&
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
        ].includes(code)
      ) {
        return { source: 'environment', kind: 'expected', reason: 'storage_connection_failed', outcome: 'failed' }
      }
    }
  } catch {
    // Unreadable provider fields are not evidence of an expected remote failure.
  }

  return { source: 'application', kind: 'unknown', reason: 'storage_failed', outcome: 'failed' }
}
