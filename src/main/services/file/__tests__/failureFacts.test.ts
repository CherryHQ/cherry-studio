import { describe, expect, it } from 'vitest'

import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { shouldReportFailure } from '@shared/utils/errorReporting'

import { classifyFileFailure } from '../failureFacts'

describe('file failure classification', () => {
  it.each(['ENOENT', 'EACCES', 'EPERM', 'ENOSPC', 'EROFS'])(
    'keeps %s local for an external path, but reports managed storage failures',
    (code) => {
      const error = Object.assign(new Error('private path'), { code })
      expect(shouldReportFailure(classifyFileFailure(error, true))).toBe(false)
      expect(shouldReportFailure(classifyFileFailure(error))).toBe(true)
    }
  )

  it('reports metadata loss after content commit even for external file operations', () => {
    const error = new IpcError(fileErrorCodes.COMMITTED_METADATA_PENDING, 'private entry')
    expect(classifyFileFailure(error, true).kind).toBe('reliability')
    expect(shouldReportFailure(classifyFileFailure(error, true))).toBe(true)
  })

  it.each([
    fileErrorCodes.STALE_VERSION,
    fileErrorCodes.OPEN_BLOCKED_UNSAFE_TYPE,
    fileErrorCodes.DIRECTORY_TREE_STOPPED
  ])('keeps explicit user conflicts and lifecycle conditions local: %s', (code) => {
    expect(shouldReportFailure(classifyFileFailure(new IpcError(code, 'detail')))).toBe(false)
  })

  it('retains defects and unknown errors instead of guessing from their messages', () => {
    expect(classifyFileFailure(new TypeError('permission denied'), true).kind).toBe('defect')
    expect(shouldReportFailure(classifyFileFailure(new Error('not found'), true))).toBe(true)
    expect(shouldReportFailure(classifyFileFailure(Object.assign(new Error('disk'), { code: 'EIO' }), true))).toBe(true)
  })
})
