import { describe, expect, expectTypeOf, it } from 'vitest'

import type { FileMetadata } from '@renderer/types/file'

import {
  createComposerFileTokenSourceId,
  ensureComposerFileTokenSourceIds,
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
    expect(isComposerFileTokenSourceId(first)).toBe(true)
    expect(first).not.toBe(second)
  })

  it('keeps mutable caller-owned arrays mutable without replacing an unchanged state', () => {
    const files: { id: string; fileTokenSourceId?: string }[] = [{ id: 'existing', fileTokenSourceId: 'source-1' }]

    const normalized = ensureComposerFileTokenSourceIds(files)

    expectTypeOf(normalized).toEqualTypeOf<{ id: string; fileTokenSourceId?: string }[]>()
    expect(normalized).toBe(files)
  })

  it('accepts frozen source arrays without exposing a mutable result or modifying stored file metadata', () => {
    type SourceFile = { id: string; fileTokenSourceId?: string }
    const existing: SourceFile = Object.freeze({ id: 'existing', fileTokenSourceId: 'source-1' })
    const invalid: SourceFile = Object.freeze({ id: 'invalid', fileTokenSourceId: '/tmp/private.pdf' })
    const files: readonly SourceFile[] = Object.freeze([existing, invalid])

    const normalized = ensureComposerFileTokenSourceIds(files)

    expectTypeOf(normalized).toEqualTypeOf<readonly SourceFile[]>()
    expect(normalized).not.toBe(files)
    expect(normalized[0]).toBe(existing)
    expect(normalized[1]).not.toBe(invalid)
    expect(normalized[1].id).toBe('invalid')
    expect(getComposerFileTokenSourceId(normalized[1])).toEqual(expect.any(String))
    expect(normalized[1].fileTokenSourceId).not.toBe('/tmp/private.pdf')
    expect(invalid.fileTokenSourceId).toBe('/tmp/private.pdf')
  })
})
