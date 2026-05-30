import { describe, expect, it } from 'vitest'

import { getFileTypeByExt } from '../fileType'

describe('getFileTypeByExt', () => {
  it('classifies .png as image', () => {
    expect(getFileTypeByExt('png')).toBe('image')
  })

  it('classifies extension regardless of leading dot', () => {
    expect(getFileTypeByExt('.png')).toBe('image')
  })

  it('classifies unknown extension as other', () => {
    expect(getFileTypeByExt('xyz123')).toBe('other')
  })

  it('classifies empty string as other', () => {
    expect(getFileTypeByExt('')).toBe('other')
  })

  it('is case-insensitive', () => {
    expect(getFileTypeByExt('PNG')).toBe('image')
  })

  it('classifies common video / audio / text / document / image extensions', () => {
    expect(getFileTypeByExt('mp4')).toBe('video')
    expect(getFileTypeByExt('mp3')).toBe('audio')
    expect(getFileTypeByExt('pdf')).toBe('document')
    expect(getFileTypeByExt('jpg')).toBe('image')
  })
})
