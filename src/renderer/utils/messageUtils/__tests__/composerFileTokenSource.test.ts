import type { FileMetadata } from '@renderer/types'
import { describe, expect, it } from 'vitest'

import {
  createComposerFileTokenSourceId,
  getComposerFileTokenSourceId,
  isComposerFileTokenSourceId,
  withComposerFileTokenSourceId
} from '../composerFileTokenSource'

describe('composer file token source', () => {
  it('returns undefined without a file token source id', () => {
    expect(getComposerFileTokenSourceId({})).toBeUndefined()
  })

  it('preserves an explicit file token source id', () => {
    expect(getComposerFileTokenSourceId({ fileTokenSourceId: 'source-file-1' })).toBe('source-file-1')
  })

  it('rejects path-like file token source ids', () => {
    expect(isComposerFileTokenSourceId('/tmp/report.pdf')).toBe(false)
    expect(isComposerFileTokenSourceId('file:///tmp/report.pdf')).toBe(false)
    expect(isComposerFileTokenSourceId('FILE:///tmp/report.pdf')).toBe(false)
    expect(getComposerFileTokenSourceId({ fileTokenSourceId: '/tmp/report.pdf' })).toBeUndefined()
    expect(getComposerFileTokenSourceId({ fileTokenSourceId: 'file:///tmp/report.pdf' })).toBeUndefined()
    expect(getComposerFileTokenSourceId({ fileTokenSourceId: 'FILE:///tmp/report.pdf' })).toBeUndefined()
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

  it('mints a unique, non-path-like file-token id', () => {
    const first = createComposerFileTokenSourceId()
    const second = createComposerFileTokenSourceId()

    expect(first.startsWith('file-token-')).toBe(true)
    expect(isComposerFileTokenSourceId(first)).toBe(true)
    expect(first).not.toBe(second)
  })
})
