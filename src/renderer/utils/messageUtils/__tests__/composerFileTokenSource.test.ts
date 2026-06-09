import type { FileMetadata } from '@renderer/types'
import { describe, expect, it, vi } from 'vitest'

import {
  createComposerFileTokenSourceId,
  getComposerFileTokenSourceId,
  isComposerFileTokenSourceId,
  withComposerFileTokenSourceId
} from '../composerFileTokenSource'

describe('composer file token source', () => {
  it('does not treat file metadata id as a file token source id', () => {
    expect(getComposerFileTokenSourceId({ id: 'file-1' })).toBeUndefined()
  })

  it('preserves an explicit file token source id', () => {
    expect(getComposerFileTokenSourceId({ id: 'file-1', fileTokenSourceId: 'source-file-1' })).toBe('source-file-1')
  })

  it('rejects path-like file token source ids', () => {
    expect(isComposerFileTokenSourceId('/tmp/report.pdf')).toBe(false)
    expect(isComposerFileTokenSourceId('file:///tmp/report.pdf')).toBe(false)
    expect(isComposerFileTokenSourceId('FILE:///tmp/report.pdf')).toBe(false)
    expect(getComposerFileTokenSourceId({ id: 'file-1', fileTokenSourceId: '/tmp/report.pdf' })).toBeUndefined()
    expect(getComposerFileTokenSourceId({ id: 'file-1', fileTokenSourceId: 'file:///tmp/report.pdf' })).toBeUndefined()
    expect(getComposerFileTokenSourceId({ id: 'file-1', fileTokenSourceId: 'FILE:///tmp/report.pdf' })).toBeUndefined()
  })

  it('adds a generated file token source id without replacing the file id', () => {
    const file = { id: 'file-1', path: '/tmp/report.pdf' } as FileMetadata

    const next = withComposerFileTokenSourceId(file)

    expect(next.id).toBe('file-1')
    expect(next.fileTokenSourceId).toEqual(expect.any(String))
    expect(next.fileTokenSourceId).not.toBe(file.id)
  })

  it('replaces invalid file token source ids without using the path as identity', () => {
    const file = { id: 'file-1', path: '/tmp/report.pdf', fileTokenSourceId: '/tmp/report.pdf' } as FileMetadata

    const next = withComposerFileTokenSourceId(file)

    expect(next.id).toBe('file-1')
    expect(next.fileTokenSourceId).toEqual(expect.any(String))
    expect(next.fileTokenSourceId).not.toBe('/tmp/report.pdf')
    expect(next.fileTokenSourceId).not.toBe(file.path)
  })

  it('uses crypto.getRandomValues when randomUUID is unavailable', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.set(bytes.map((_, index) => index))
      return bytes
    })
    const randomSpy = vi.spyOn(Math, 'random')
    vi.stubGlobal('crypto', { getRandomValues })

    try {
      const sourceId = createComposerFileTokenSourceId()

      expect(getRandomValues).toHaveBeenCalled()
      expect(randomSpy).not.toHaveBeenCalled()
      expect(sourceId).toMatch(/^file-token-[0-9a-f]{32}$/)
    } finally {
      vi.unstubAllGlobals()
      randomSpy.mockRestore()
    }
  })
})
