import { FileEntrySchema } from '@shared/data/types/file/fileEntry'
import { describe, expect, it } from 'vitest'

import { toFileMetadata } from '../toFileMetadata'

const makeInternal = (overrides: object = {}) =>
  FileEntrySchema.parse({
    id: '018f1234-5678-7000-8000-000000000001',
    name: 'report',
    ext: 'pdf',
    size: 2048,
    origin: 'internal',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides
  })

const makeExternal = (overrides: object = {}) =>
  FileEntrySchema.parse({
    id: '018f1234-5678-7000-8000-000000000002',
    name: 'photo',
    ext: 'jpg',
    origin: 'external',
    externalPath: '/Users/user/Photos/photo.jpg',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides
  })

describe('toFileMetadata — internal entry', () => {
  it('projects id, ext (with leading dot), size, type, created_at', () => {
    const entry = makeInternal()
    const result = toFileMetadata(entry, '/app/Data/Files/018f1234.pdf')

    expect(result.id).toBe(entry.id)
    expect(result.ext).toBe('.pdf')
    expect(result.size).toBe(2048)
    expect(result.type).toBe('document')
    expect(result.created_at).toBe(new Date(1700000000000).toISOString())
    expect(result.count).toBe(1)
  })

  it('sets path to the physicalPath argument', () => {
    const entry = makeInternal()
    const physicalPath = '/app/Data/Files/018f1234.pdf'
    const result = toFileMetadata(entry, physicalPath)
    expect(result.path).toBe(physicalPath)
  })

  it('sets name to entry.name (storage name without extension)', () => {
    const entry = makeInternal()
    const result = toFileMetadata(entry, '/path')
    expect(result.name).toBe('report')
  })

  it('sets origin_name to name + ext (with leading dot)', () => {
    const entry = makeInternal()
    const result = toFileMetadata(entry, '/path')
    expect(result.origin_name).toBe('report.pdf')
  })

  it('handles null ext (extensionless file)', () => {
    const entry = makeInternal({ ext: null, name: 'Dockerfile' })
    const result = toFileMetadata(entry, '/path/Dockerfile')
    expect(result.ext).toBe('')
    expect(result.origin_name).toBe('Dockerfile')
    expect(result.type).toBe('other')
  })

  it('maps image ext to image type', () => {
    const entry = makeInternal({ ext: 'png', name: 'screenshot' })
    const result = toFileMetadata(entry, '/path/screenshot.png')
    expect(result.type).toBe('image')
  })

  it('maps text ext to text type', () => {
    const entry = makeInternal({ ext: 'txt', name: 'notes' })
    const result = toFileMetadata(entry, '/path/notes.txt')
    expect(result.type).toBe('text')
  })
})

describe('toFileMetadata — external entry', () => {
  it('projects id, name (from basename without ext), origin_name (basename), ext, type', () => {
    const entry = makeExternal()
    const result = toFileMetadata(entry, '/Users/user/Photos/photo.jpg')

    expect(result.id).toBe(entry.id)
    expect(result.ext).toBe('.jpg')
    expect(result.type).toBe('image')
    expect(result.created_at).toBe(new Date(1700000000000).toISOString())
    expect(result.count).toBe(1)
  })

  it('sets path to the physicalPath (external path passed through)', () => {
    const entry = makeExternal()
    const externalPath = '/Users/user/Photos/photo.jpg'
    const result = toFileMetadata(entry, externalPath)
    expect(result.path).toBe(externalPath)
  })

  it('sets size to 0 for external entries', () => {
    const entry = makeExternal()
    const result = toFileMetadata(entry, '/path')
    expect(result.size).toBe(0)
  })

  it('sets name to entry.name and origin_name to name + ext', () => {
    const entry = makeExternal()
    const result = toFileMetadata(entry, '/path')
    expect(result.name).toBe('photo')
    expect(result.origin_name).toBe('photo.jpg')
  })

  it('handles external entry with null ext', () => {
    const entry = FileEntrySchema.parse({
      id: '018f1234-5678-7000-8000-000000000003',
      name: 'Makefile',
      ext: null,
      origin: 'external',
      externalPath: '/Users/user/Makefile',
      createdAt: 1700000000000,
      updatedAt: 1700000000000
    })
    const result = toFileMetadata(entry, '/Users/user/Makefile')
    expect(result.ext).toBe('')
    expect(result.origin_name).toBe('Makefile')
    expect(result.type).toBe('other')
  })
})
