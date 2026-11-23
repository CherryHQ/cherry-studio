import { getErrorCode } from '@main/utils/error'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import type { FailureFacts } from '@shared/types/errorReporting'
import { isCancellation } from '@shared/utils/errorReporting'

const expectedFileErrorCodes: readonly string[] = [
  fileErrorCodes.STALE_VERSION,
  fileErrorCodes.EDIT_TARGET_CHANGED,
  fileErrorCodes.EDIT_LEASE_CLOSED,
  fileErrorCodes.EDIT_UNSUPPORTED,
  fileErrorCodes.EDIT_READ_UNSTABLE,
  fileErrorCodes.EDIT_LIMIT,
  fileErrorCodes.OPEN_BLOCKED_UNSAFE_TYPE,
  fileErrorCodes.OPEN_TARGET_UNAVAILABLE,
  fileErrorCodes.DIRECTORY_TREE_STOPPED
]

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- File operations can reject arbitrary values; cancellation, owned file errors, and verified filesystem codes determine domain classification.
export function classifyFileFailure(error: unknown, externalPath = false): FailureFacts {
  if (isCancellation(error)) {
    return { source: 'application', kind: 'expected', reason: 'cancelled', outcome: 'cancelled' }
  }

  const code = getErrorCode(error)

  if (code === fileErrorCodes.COMMITTED_METADATA_PENDING) {
    return { source: 'application', kind: 'reliability', reason: 'file_metadata_pending', outcome: 'failed' }
  }

  if (code !== undefined && expectedFileErrorCodes.includes(code)) {
    return { source: 'application', kind: 'expected', reason: code.toLowerCase(), outcome: 'failed' }
  }

  if (
    code !== undefined &&
    [
      'ENOENT',
      'EACCES',
      'EPERM',
      'EEXIST',
      'ENOTDIR',
      'EISDIR',
      'ENOSPC',
      'EDQUOT',
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

  let kind: FailureFacts['kind'] = 'unknown'

  try {
    if (error instanceof TypeError || error instanceof ReferenceError || error instanceof SyntaxError) kind = 'defect'
  } catch {
    // An unreadable prototype cannot establish a programming defect.
  }

  return {
    source: 'application',
    kind,
    reason: 'file_operation_failed',
    outcome: 'failed'
  }
}
