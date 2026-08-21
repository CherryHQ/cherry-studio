import type { FileMetadata } from '@shared/data/types/legacyFile'
import { describe, expect, it } from 'vitest'

import { hasLostOriginalFilename, legacyStorageNames, normalizeExt } from '../legacyFileMappings'

const ID = '019606a0-0000-7000-8000-000000000101'

describe('normalizeExt', () => {
  it.each([
    ['.pdf', 'pdf'],
    ['pdf', 'pdf'],
    ['.PDF', 'PDF'],
    ['.exe ', 'exe'],
    ['.exe.', 'exe'],
    ['', null],
    ['   ', null],
    ['.', null],
    [undefined, null],
    [null, null]
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeExt(input)).toBe(expected)
  })
})

describe('legacyStorageNames', () => {
  // Every producer of a v1 `files` row, with the on-disk name it actually wrote. The candidate
  // list must contain that name — otherwise the row looks orphaned on a cross-platform restore
  // and its physical file is swept.
  it.each([
    // producer                       | ext      | real on-disk name
    ['uploadFile (normal)', '.pdf', `${ID}.pdf`],
    ['saveBase64Image (dotless ext)', 'png', `${ID}.png`],
    ['uploadFile (extensionless)', '', ID],
    ['corrupted row (null ext)', null, ID],
    ['findDuplicateFile (malformed)', '.pdf', `${ID}.pdf`],
    ['findDuplicateFile (extensionless)', '', ID],
    ['uploadFile (trailing space ext)', '.exe ', `${ID}.exe `],
    ['uploadFile (trailing dot ext)', '.exe.', `${ID}.exe.`]
  ])('covers %s', (_producer, ext, onDiskName) => {
    expect(legacyStorageNames({ id: ID, ext: ext as string })).toContain(onDiskName)
  })

  it('puts the canonical name first and drops a redundant raw candidate', () => {
    expect(legacyStorageNames({ id: ID, ext: '.pdf' })).toEqual([`${ID}.pdf`])
    expect(legacyStorageNames({ id: ID, ext: 'png' })).toEqual([`${ID}.png`, `${ID}png`])
    expect(legacyStorageNames({ id: ID, ext: '.exe ' })).toEqual([`${ID}.exe`, `${ID}.exe `])
    expect(legacyStorageNames({ id: ID, ext: '' })).toEqual([ID])
  })

  it('never derives a candidate from the malformed double-extension name', () => {
    // The whole point: `{id}.pdf.pdf` does not exist on disk.
    expect(legacyStorageNames({ id: ID, ext: '.pdf' })).not.toContain(`${ID}.pdf.pdf`)
  })
})

describe('hasLostOriginalFilename', () => {
  const row = (overrides: Partial<FileMetadata>): Pick<FileMetadata, 'id' | 'name' | 'origin_name' | 'ext'> => ({
    id: ID,
    name: 'report.pdf',
    origin_name: 'report.pdf',
    ext: '.pdf',
    ...overrides
  })

  it.each([
    ['normal upload', row({}), false],
    // saveBase64Image writes origin_name === the storage name by construction, but nothing was
    // lost — a generated image never had a user filename. The mine this predicate must not step on.
    ['base64 image', row({ name: `${ID}.png`, origin_name: `${ID}.png`, ext: 'png' }), false],
    ['deduped upload', row({ name: `${ID}.pdf.pdf`, origin_name: `${ID}.pdf`, ext: '.pdf' }), true],
    ['deduped upload without an extension', row({ name: ID, origin_name: ID, ext: '' }), true],
    ['external row with an extension', row({ name: 'report.pdf', origin_name: 'report.pdf' }), false],
    // Degenerate case for the fingerprint check alone (name === origin_name when ext is empty);
    // the semantic check rejects it.
    ['external row without an extension', row({ name: 'README', origin_name: 'README', ext: '' }), false],
    // `count` is a v1 reference count, not an upload counter — two messages attaching one file
    // reach 2. It must never influence the verdict.
    ['normal upload referenced twice', row({ count: 2 } as Partial<FileMetadata>), false]
  ])('returns %s → %s', (_label, input, expected) => {
    expect(hasLostOriginalFilename(input)).toBe(expected)
  })
})
