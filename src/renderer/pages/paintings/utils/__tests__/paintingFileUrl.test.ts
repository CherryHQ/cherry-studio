import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  warn: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ warn: mocks.warn })
  }
}))

import { getPaintingFileUrl } from '../paintingFileUrl'

describe('getPaintingFileUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns undefined when no physical path is available', () => {
    expect(getPaintingFileUrl({ path: '', ext: '.png' })).toBeUndefined()
  })

  it('builds the preview URL from the resolved physical path instead of the legacy file name', () => {
    expect(
      getPaintingFileUrl({
        path: '/resolved output/paint result.png',
        ext: '.png'
      })
    ).toBe('file:///resolved%20output/paint%20result.png')
  })

  it('returns undefined without throwing when the path is not absolute, and logs a warning', () => {
    expect(() => getPaintingFileUrl({ path: 'relative/legacy.png', ext: '.png' })).not.toThrow()
    expect(getPaintingFileUrl({ path: 'relative/legacy.png', ext: '.png' })).toBeUndefined()
    expect(mocks.warn).toHaveBeenCalledWith(
      'getPaintingFileUrl: non-canonical/invalid painting path',
      expect.objectContaining({ path: 'relative/legacy.png' })
    )
  })

  it('keeps shared file-url safety behavior', () => {
    expect(
      getPaintingFileUrl({
        path: '/tmp/generated.svg',
        ext: 'svg'
      })
    ).toBe('file:///tmp')
  })
})
