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

  it('classifies both legacy .xls and modern .xlsx as document', () => {
    expect(getFileTypeByExt('xls')).toBe('document')
    expect(getFileTypeByExt('xlsx')).toBe('document')
  })

  it('classifies C# / CSS / shell sources as text so they attach in chat', () => {
    for (const ext of ['cs', 'css', 'sh', 'bash']) {
      expect(getFileTypeByExt(ext)).toBe('text')
    }
  })

  it('classifies common configuration formats as text so they attach in chat', () => {
    for (const ext of ['conf', 'config', 'yaml', 'yml', 'toml', 'ini', 'json']) {
      expect(getFileTypeByExt(ext)).toBe('text')
    }
  })

  it('keeps binary formats as other so they stay rejected in chat', () => {
    for (const ext of ['exe', 'zip', 'dat', 'bin']) {
      expect(getFileTypeByExt(ext)).toBe('other')
    }
  })
})
