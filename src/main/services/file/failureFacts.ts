import { fileErrorCodes } from '@shared/ipc/errors/file'
import type { FailureFacts } from '@shared/types/errorReporting'
import { isCancellation } from '@shared/utils/errorReporting'

export function classifyFileFailure(error: unknown, externalPath = false): FailureFacts {
  if (isCancellation(error)) {
    return { source: 'application', kind: 'expected', reason: 'cancelled', outcome: 'cancelled' }
  }
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  if (code === fileErrorCodes.COMMITTED_METADATA_PENDING) {
    return { source: 'application', kind: 'reliability', reason: 'file_metadata_pending', outcome: 'failed' }
  }
  if (
    typeof code === 'string' &&
    (
      [
        fileErrorCodes.STALE_VERSION,
        fileErrorCodes.EDIT_TARGET_CHANGED,
        fileErrorCodes.EDIT_LEASE_CLOSED,
        fileErrorCodes.EDIT_UNSUPPORTED,
        fileErrorCodes.EDIT_READ_UNSTABLE,
        fileErrorCodes.EDIT_LIMIT,
        fileErrorCodes.OPEN_BLOCKED_UNSAFE_TYPE,
        fileErrorCodes.OPEN_TARGET_UNAVAILABLE,
        fileErrorCodes.DIRECTORY_TREE_STOPPED
      ] as string[]
    ).includes(code)
  ) {
    return { source: 'application', kind: 'expected', reason: code.toLowerCase(), outcome: 'failed' }
  }
  if (
    typeof code === 'string' &&
    [
      'ENOENT',
      'EACCES',
      'EPERM',
      'EEXIST',
      'ENOTDIR',
      'EISDIR',
      'ENOSPC',
      'EROFS',
      'EIO',
      fileErrorCodes.EDIT_MISSING,
      fileErrorCodes.EDIT_PERMISSION,
      fileErrorCodes.EDIT_NO_SPACE,
      fileErrorCodes.EDIT_IO
    ].includes(code)
  ) {
    return {
      source: 'environment',
      kind: externalPath && code !== 'EIO' && code !== fileErrorCodes.EDIT_IO ? 'expected' : 'reliability',
      reason: code.toLowerCase(),
      outcome: 'failed'
    }
  }
  return {
    source: 'application',
    kind:
      error instanceof TypeError || error instanceof ReferenceError || error instanceof SyntaxError
        ? 'defect'
        : 'unknown',
    reason: 'file_operation_failed',
    outcome: 'failed'
  }
}
