import { describe, expect, it } from 'vitest'

import { getPaintingFileUrl } from '../paintingFileUrl'

describe('getPaintingFileUrl', () => {
  it('returns an empty URL when no physical path is available', () => {
    expect(getPaintingFileUrl({ path: '', ext: '.png' })).toBe('')
  })

  it('builds the preview URL from the resolved physical path instead of the legacy file name', () => {
    expect(
      getPaintingFileUrl({
        path: '/resolved output/paint result.png',
        ext: '.png'
      })
    ).toBe('file:///resolved%20output/paint%20result.png')
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
