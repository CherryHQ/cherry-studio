import { describe, expect, it } from 'vitest'

import { resolveStoredImageSrc } from '../storedImage'

describe('resolveStoredImageSrc', () => {
  const filesPath = '/files'
  const id = '0190f3c4-1a2b-7c3d-8e4f-5a6b7c8d9e0f'

  it('resolves a file:<id> ref to the on-disk WebP', () => {
    expect(resolveStoredImageSrc(`file:${id}`, filesPath)).toBe(`file:///files/${id}.webp`)
  })

  it('returns undefined for a file:<id> ref without a filesPath', () => {
    expect(resolveStoredImageSrc(`file:${id}`)).toBeUndefined()
  })

  it('passes an already-resolved file:// URL through unchanged (no double resolve)', () => {
    expect(resolveStoredImageSrc('file:///tmp/wide-avatar.png', filesPath)).toBe('file:///tmp/wide-avatar.png')
  })

  it('passes icon refs / emoji / preset ids / data URLs through unchanged', () => {
    expect(resolveStoredImageSrc('icon:openai', filesPath)).toBe('icon:openai')
    expect(resolveStoredImageSrc('😀', filesPath)).toBe('😀')
    expect(resolveStoredImageSrc('application', filesPath)).toBe('application')
    expect(resolveStoredImageSrc('data:image/png;base64,abc', filesPath)).toBe('data:image/png;base64,abc')
  })

  it('returns undefined for empty / nullish values', () => {
    expect(resolveStoredImageSrc('', filesPath)).toBeUndefined()
    expect(resolveStoredImageSrc(null, filesPath)).toBeUndefined()
    expect(resolveStoredImageSrc(undefined, filesPath)).toBeUndefined()
  })
})
