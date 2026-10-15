import { describe, expect, it } from 'vitest'

import { shouldReportFailure } from '@shared/utils/errorReporting'

import { classifyStorageFailure } from '../failureFacts'

describe('remote storage failure classification', () => {
  it.each([401, 403, 404, 429, 503])(
    'keeps known external conditions local for both SDK response shapes: %s',
    (status) => {
      expect(shouldReportFailure(classifyStorageFailure(Object.assign(new Error('response'), { status })))).toBe(false)
      expect(
        shouldReportFailure(
          classifyStorageFailure(Object.assign(new Error('response'), { $metadata: { httpStatusCode: status } }))
        )
      ).toBe(false)
    }
  )
  it('retains malformed requests, programming errors and unknown failures', () => {
    expect(shouldReportFailure(classifyStorageFailure(Object.assign(new Error('response'), { status: 400 })))).toBe(
      true
    )
    expect(classifyStorageFailure(new TypeError('network failed')).kind).toBe('defect')
    expect(shouldReportFailure(classifyStorageFailure(new Error('permission denied')))).toBe(true)
  })
  it('does not mistake local storage failure for a remote outage', () => {
    expect(shouldReportFailure(classifyStorageFailure(Object.assign(new Error('disk'), { code: 'ENOSPC' })))).toBe(true)
    expect(
      shouldReportFailure(classifyStorageFailure(Object.assign(new Error('network'), { code: 'ECONNRESET' })))
    ).toBe(false)
  })
})
