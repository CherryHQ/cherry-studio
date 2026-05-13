import { beforeEach, describe, expect, it, vi } from 'vitest'

const loggerWarnMock = vi.fn()

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      info: vi.fn(),
      warn: loggerWarnMock,
      error: vi.fn(),
      debug: vi.fn()
    }))
  }
}))

import type { MigrationContext } from '../../core/MigrationContext'
import { resolveFileRefForLegacyId } from '../resolveFileRefForLegacyId'

function makeCtx(idRemap?: Map<string, string>): MigrationContext {
  const sharedData = new Map<string, unknown>()
  if (idRemap !== undefined) {
    sharedData.set('file.idRemap', idRemap)
  }
  return {
    sharedData,
    logger: {
      warn: loggerWarnMock,
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }
  } as unknown as MigrationContext
}

describe('resolveFileRefForLegacyId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns resolved when idRemap contains the legacy id', () => {
    const remap = new Map([['legacy-abc', 'v2-uuid-xyz']])
    const ctx = makeCtx(remap)

    const result = resolveFileRefForLegacyId(ctx, 'legacy-abc')

    expect(result).toEqual({ kind: 'resolved', v2Id: 'v2-uuid-xyz' })
    expect(loggerWarnMock).not.toHaveBeenCalled()
  })

  it('returns missing and calls logger.warn when idRemap is present but lacks the legacy id', () => {
    const remap = new Map([['other-id', 'v2-other']])
    const ctx = makeCtx(remap)

    const result = resolveFileRefForLegacyId(ctx, 'unknown-legacy-id')

    expect(result).toEqual({ kind: 'missing', legacyId: 'unknown-legacy-id' })
    expect(loggerWarnMock).toHaveBeenCalledOnce()
    expect(loggerWarnMock).toHaveBeenCalledWith(expect.stringContaining('unknown-legacy-id'))
  })

  it('returns missing when idRemap is absent (FileMigrator did not run)', () => {
    const ctx = makeCtx(undefined)

    const result = resolveFileRefForLegacyId(ctx, 'orphaned-id')

    expect(result).toEqual({ kind: 'missing', legacyId: 'orphaned-id' })
    expect(loggerWarnMock).not.toHaveBeenCalled()
  })
})
