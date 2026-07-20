import fs from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { VersionCheckInput, VersionCheckResult } from '../versionPolicy'
import { checkUpgradePathCompatibility, evaluateCandidateVersion, readPreviousVersion } from '../versionPolicy'

vi.mock('node:fs', async () => {
  const { createNodeFsMock } = await import('@test-helpers/mocks/nodeFsMock')
  return createNodeFsMock()
})

// ── checkUpgradePathCompatibility ──────────────────────────────────

describe('checkUpgradePathCompatibility', () => {
  function check(input: VersionCheckInput): VersionCheckResult {
    return checkUpgradePathCompatibility(input)
  }

  it('#1 blocks when no version.log and no previous version (old user)', () => {
    const result = check({ previousVersion: null, versionLogExists: false, currentAppVersion: '2.0.0' })
    expect(result).toStrictEqual({
      outcome: 'block',
      reason: 'no_version_log',
      details: { requiredVersion: '1.9.12' }
    })
  })

  it('#2 blocks when v1 version is too old (1.5.0)', () => {
    const result = check({ previousVersion: '1.5.0', versionLogExists: true, currentAppVersion: '2.0.0' })
    expect(result).toStrictEqual({
      outcome: 'block',
      reason: 'v1_too_old',
      details: { previousVersion: '1.5.0', requiredVersion: '1.9.12' }
    })
  })

  it('#3 blocks when v1 version is below V1_REQUIRED (1.8.0)', () => {
    const result = check({ previousVersion: '1.8.0', versionLogExists: true, currentAppVersion: '2.0.0' })
    expect(result).toStrictEqual({
      outcome: 'block',
      reason: 'v1_too_old',
      details: { previousVersion: '1.8.0', requiredVersion: '1.9.12' }
    })
  })

  it('#4 passes when previous version is exactly at V1_REQUIRED (1.9.12)', () => {
    const result = check({ previousVersion: '1.9.12', versionLogExists: true, currentAppVersion: '2.0.0' })
    expect(result).toStrictEqual({ outcome: 'pass' })
  })

  it('#5 passes when current version is a pre-release coerced to 2.0.0', () => {
    const result = check({ previousVersion: '1.9.12', versionLogExists: true, currentAppVersion: '2.0.0-alpha' })
    expect(result).toStrictEqual({ outcome: 'pass' })
  })

  it('#6 blocks when v2 gateway is skipped (1.9.12 -> 2.1.0)', () => {
    const result = check({ previousVersion: '1.9.12', versionLogExists: true, currentAppVersion: '2.1.0' })
    expect(result).toStrictEqual({
      outcome: 'block',
      reason: 'v2_gateway_skipped',
      details: { previousVersion: '1.9.12', currentVersion: '2.1.0', gatewayVersion: '2.0.0' }
    })
  })

  it('#7 blocks when current is v2.0.1 (strict v2.0.0 requirement)', () => {
    const result = check({ previousVersion: '1.9.12', versionLogExists: true, currentAppVersion: '2.0.1' })
    expect(result).toStrictEqual({
      outcome: 'block',
      reason: 'v2_gateway_skipped',
      details: { previousVersion: '1.9.12', currentVersion: '2.0.1', gatewayVersion: '2.0.0' }
    })
  })

  it('#8 passes for v2 internal upgrade (2.0.0 -> 2.1.0)', () => {
    const result = check({ previousVersion: '2.0.0', versionLogExists: true, currentAppVersion: '2.1.0' })
    expect(result).toStrictEqual({ outcome: 'pass' })
  })

  it('#9 blocks when previous is 2.0.0-beta (pre-release < 2.0.0)', () => {
    const result = check({ previousVersion: '2.0.0-beta', versionLogExists: true, currentAppVersion: '2.1.0' })
    expect(result).toStrictEqual({
      outcome: 'block',
      reason: 'v2_gateway_skipped',
      details: { previousVersion: '2.0.0-beta', currentVersion: '2.1.0', gatewayVersion: '2.0.0' }
    })
  })

  it('#10 passes when version.log exists but no previous version found', () => {
    const result = check({ previousVersion: null, versionLogExists: true, currentAppVersion: '2.0.0' })
    expect(result).toStrictEqual({ outcome: 'pass' })
  })

  it('#11 passes when previous version is above V1_REQUIRED (1.9.13)', () => {
    const result = check({ previousVersion: '1.9.13', versionLogExists: true, currentAppVersion: '2.0.0' })
    expect(result).toStrictEqual({ outcome: 'pass' })
  })
})

// ── readPreviousVersion ────────────────────────────────────────────

describe('readPreviousVersion', () => {
  const mockedReadFileSync = vi.mocked(fs.readFileSync)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the last different version from a multi-version file', () => {
    const content = [
      '1.8.0|darwin|production|true|normal|2025-01-01T00:00:00Z',
      '1.9.0|darwin|production|true|normal|2025-02-01T00:00:00Z',
      '2.0.0|darwin|production|true|normal|2025-03-01T00:00:00Z'
    ].join('\n')
    mockedReadFileSync.mockReturnValue(content)

    expect(readPreviousVersion('/tmp/version.log', '2.0.0')).toBe('1.9.0')
  })

  it('returns null for an empty file', () => {
    mockedReadFileSync.mockReturnValue('')

    expect(readPreviousVersion('/tmp/version.log', '2.0.0')).toBeNull()
  })

  it('returns null when all records match current version', () => {
    const content = [
      '2.0.0|darwin|production|true|normal|2025-03-01T00:00:00Z',
      '2.0.0|darwin|production|true|normal|2025-03-02T00:00:00Z'
    ].join('\n')
    mockedReadFileSync.mockReturnValue(content)

    expect(readPreviousVersion('/tmp/version.log', '2.0.0')).toBeNull()
  })

  it('skips corrupted lines and returns the valid previous version', () => {
    const content = [
      '1.9.0|darwin|production|true|normal|2025-02-01T00:00:00Z',
      'garbage-line-no-pipes',
      'also|bad',
      '2.0.0|darwin|production|true|normal|2025-03-01T00:00:00Z'
    ].join('\n')
    mockedReadFileSync.mockReturnValue(content)

    expect(readPreviousVersion('/tmp/version.log', '2.0.0')).toBe('1.9.0')
  })

  it('returns null when a single valid entry matches current version', () => {
    mockedReadFileSync.mockReturnValue('2.0.0|darwin|production|true|normal|2025-03-01T00:00:00Z')

    expect(readPreviousVersion('/tmp/version.log', '2.0.0')).toBeNull()
  })

  it('returns null when the file does not exist', () => {
    mockedReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory')
    })

    expect(readPreviousVersion('/tmp/nonexistent.log', '2.0.0')).toBeNull()
  })
})

// ── evaluateCandidateVersion ───────────────────────────────────────

describe('evaluateCandidateVersion', () => {
  const mockedExistsSync = vi.mocked(fs.existsSync)
  const mockedReadFileSync = vi.mocked(fs.readFileSync)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('blocks with no_version_log when the directory has no version.log', () => {
    mockedExistsSync.mockReturnValue(false)

    const result = evaluateCandidateVersion('/data/dir', '2.0.0')

    expect(result.check).toStrictEqual({
      outcome: 'block',
      reason: 'no_version_log',
      details: { requiredVersion: '1.9.12' }
    })
    // Intermediates are surfaced for the gate's diagnostic log.
    expect(result.versionLogExists).toBe(false)
    expect(result.previousVersion).toBeNull()
    // version.log path is derived from the candidate directory.
    expect(mockedExistsSync).toHaveBeenCalledWith('/data/dir/version.log')
  })

  it('passes when version.log records a previous version at or above the required v1', () => {
    mockedExistsSync.mockReturnValue(true)
    mockedReadFileSync.mockReturnValue('1.9.12|darwin|production|true|normal|2025-03-01T00:00:00Z')

    const result = evaluateCandidateVersion('/data/dir', '2.0.0')

    expect(result.check).toStrictEqual({ outcome: 'pass' })
    expect(result.previousVersion).toBe('1.9.12')
    expect(result.versionLogExists).toBe(true)
  })

  it('blocks with v1_too_old when the recorded previous version is below the required v1', () => {
    mockedExistsSync.mockReturnValue(true)
    mockedReadFileSync.mockReturnValue('1.8.0|darwin|production|true|normal|2025-01-01T00:00:00Z')

    const result = evaluateCandidateVersion('/data/dir', '2.0.0')

    expect(result.check).toStrictEqual({
      outcome: 'block',
      reason: 'v1_too_old',
      details: { previousVersion: '1.8.0', requiredVersion: '1.9.12' }
    })
    expect(result.previousVersion).toBe('1.8.0')
    expect(result.versionLogExists).toBe(true)
  })

  it('uses the latest valid prior version and exposes only bounded version-log facts', () => {
    mockedExistsSync.mockReturnValue(true)
    mockedReadFileSync.mockReturnValue(
      [
        '1.8.4|darwin|production|true|normal|2025-01-01T00:00:00Z',
        'PRIVATE_INVALID_LINE_/Users/alice',
        '1.9.11|darwin|production|true|normal|2025-02-01T00:00:00Z',
        '2.0.0|darwin|production|true|normal|2025-03-01T00:00:00Z'
      ].join('\n')
    )

    const result = evaluateCandidateVersion('/data/dir', '2.0.0')

    expect(result.previousVersion).toBe('1.9.11')
    expect(result.check).toMatchObject({
      outcome: 'block',
      reason: 'v1_too_old',
      details: { previousVersion: '1.9.11' }
    })
    expect(result.versionLog).toEqual({
      state: 'parsed',
      validRecordCountBucket: '2+',
      invalidRecordCountBucket: '1'
    })
    expect(JSON.stringify(result.versionLog)).not.toContain('PRIVATE_INVALID_LINE')
  })

  it('distinguishes an existing unreadable version log from a missing one', () => {
    mockedExistsSync.mockReturnValue(true)
    mockedReadFileSync.mockImplementation(() => {
      throw new Error('EACCES: PRIVATE_VERSION_LOG_PATH')
    })

    const result = evaluateCandidateVersion('/data/dir', '2.0.0')

    expect(result.versionLog).toEqual({ state: 'read_failed' })
    expect(JSON.stringify(result.versionLog)).not.toContain('PRIVATE_VERSION_LOG_PATH')
  })
})
