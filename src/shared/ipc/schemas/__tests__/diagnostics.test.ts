import { DIAGNOSTIC_DESCRIPTION_MAX_BYTES } from '@shared/utils/diagnostics'
import { describe, expect, it } from 'vitest'

import { diagnosticsRequestSchemas } from '../diagnostics'

const uploadInput = diagnosticsRequestSchemas['diagnostics.bundle.upload'].input
const retryInput = diagnosticsRequestSchemas['diagnostics.bundle.retry_upload'].input
const uploadOutput = diagnosticsRequestSchemas['diagnostics.bundle.upload'].output

describe('diagnostics request schemas', () => {
  it('trims a non-empty diagnostic description at the IPC boundary', () => {
    expect(
      uploadInput.parse({
        description: '  The app stopped responding.  ',
        includeLogs: true,
        includeTraces: false,
        range: '24h'
      })
    ).toEqual({
      description: 'The app stopped responding.',
      includeLogs: true,
      includeTraces: false,
      range: '24h'
    })

    expect(
      uploadInput.safeParse({ description: '   ', includeLogs: true, includeTraces: false, range: '24h' }).success
    ).toBe(false)
  })

  it('enforces the normalized UTF-8 description byte limit', () => {
    const accepted = 'a'.repeat(DIAGNOSTIC_DESCRIPTION_MAX_BYTES)
    const rejected = `${'a'.repeat(DIAGNOSTIC_DESCRIPTION_MAX_BYTES - 2)}\na`

    expect(
      uploadInput.safeParse({ description: accepted, includeLogs: false, includeTraces: false, range: '7d' }).success
    ).toBe(true)
    expect(
      uploadInput.safeParse({ description: rejected, includeLogs: false, includeTraces: false, range: '7d' }).success
    ).toBe(false)
  })

  it('accepts only a strict opaque bundle id for retry', () => {
    const bundleId = '123e4567-e89b-42d3-a456-426614174000'

    expect(retryInput.parse({ bundleId })).toEqual({ bundleId })
    expect(retryInput.safeParse({ bundleId, filePath: '/tmp/archive.zip' }).success).toBe(false)
    expect(retryInput.safeParse({ bundleId: 'report-123' }).success).toBe(false)
  })

  it('keeps upload rejection reasons within the stable cross-process contract', () => {
    const summary = {
      archiveBytes: 22,
      bundleId: '123e4567-e89b-42d3-a456-426614174000',
      fileName: 'diagnostics.zip',
      filePath: '/tmp/diagnostics.zip',
      hasWarnings: false,
      includedFileCount: 1,
      omittedFileCount: 0
    }

    expect(uploadOutput.safeParse({ ...summary, reason: 'rate_limited', status: 'submission_failed' }).success).toBe(
      true
    )
    expect(uploadOutput.safeParse({ ...summary, reason: 'unexpected', status: 'submission_failed' }).success).toBe(
      false
    )
  })
})
