import { FileEntryIdSchema } from '@shared/data/types/file'
import { describe, expect, it } from 'vitest'

import { FILE_IPC_MAX_BATCH_CREATE_ITEMS, FILE_IPC_MAX_BATCH_IDS, fileRequestSchemas } from '../schemas/file'

const VALID_UUID_V7 = '019606a0-0000-7000-8000-000000000001'
const BATCH_ID_ROUTES = [
  'file.batch_get_physical_paths',
  'file.batch_get_dangling_states',
  'file.batch_trash',
  'file.batch_restore',
  'file.batch_permanent_delete'
] as const

describe('file IpcApi schemas', () => {
  it('caps batch metadata FileHandle items at FILE_IPC_MAX_BATCH_IDS', () => {
    const input = fileRequestSchemas['file.batch_get_metadata'].input
    const ok = Array.from({ length: FILE_IPC_MAX_BATCH_IDS }, () => ({
      key: VALID_UUID_V7,
      handle: { kind: 'entry' as const, entryId: VALID_UUID_V7 }
    }))

    expect(input.parse({ items: ok }).items).toHaveLength(FILE_IPC_MAX_BATCH_IDS)
    expect(() =>
      input.parse({ items: [...ok, { key: VALID_UUID_V7, handle: { kind: 'path', path: '/tmp/a.txt' } }] })
    ).toThrow()
    expect(() => input.parse({ items: [{ key: '', handle: { kind: 'entry', entryId: VALID_UUID_V7 } }] })).toThrow()
    expect(() => input.parse({ items: [{ key: VALID_UUID_V7, handle: { kind: 'entry', entryId: 'oops' } }] })).toThrow()
    expect(() =>
      input.parse({ items: [{ key: '/tmp/a.txt', handle: { kind: 'path', path: '/tmp/a.txt' } }] })
    ).not.toThrow()
    expect(() => input.parse({ items: [{ key: 'rel', handle: { kind: 'path', path: 'relative.txt' } }] })).toThrow()
  })

  it('caps Files-page batch entry routes at FILE_IPC_MAX_BATCH_IDS', () => {
    const ok = Array.from({ length: FILE_IPC_MAX_BATCH_IDS }, () => VALID_UUID_V7)

    for (const route of BATCH_ID_ROUTES) {
      const input = fileRequestSchemas[route].input
      expect(input.parse({ ids: ok }).ids).toHaveLength(FILE_IPC_MAX_BATCH_IDS)
      expect(() => input.parse({ ids: [...ok, VALID_UUID_V7] })).toThrow()
    }
  })

  it('rejects malformed batch entry ids and extra keys', () => {
    for (const route of BATCH_ID_ROUTES) {
      const input = fileRequestSchemas[route].input
      expect(() => input.parse({ ids: [VALID_UUID_V7, 'oops'] })).toThrow()
      expect(() => input.parse({ ids: [VALID_UUID_V7], extra: true })).toThrow()
    }
  })

  it('caps internal-entry batch create items and validates create sources', () => {
    const input = fileRequestSchemas['file.batch_create_internal_entries'].input
    const ok = Array.from({ length: FILE_IPC_MAX_BATCH_CREATE_ITEMS }, () => ({
      source: 'path' as const,
      path: '/tmp/import.md'
    }))

    expect(input.parse({ items: ok }).items).toHaveLength(FILE_IPC_MAX_BATCH_CREATE_ITEMS)
    expect(() => input.parse({ items: [] })).toThrow()
    expect(() => input.parse({ items: [...ok, { source: 'path', path: '/tmp/import.md' }] })).toThrow()
    expect(() => input.parse({ items: [{ source: 'path', path: 'relative.md' }] })).toThrow()
    expect(() => input.parse({ items: [{ source: 'url', url: 'https://example.com/file.md' }] })).not.toThrow()
    expect(() => input.parse({ items: [{ source: 'base64', data: 'Zm9v' }] })).not.toThrow()
    expect(() =>
      input.parse({ items: [{ source: 'bytes', data: new Uint8Array([1]), name: 'blob', ext: 'bin' }] })
    ).not.toThrow()
    expect(() =>
      input.parse({ items: [{ source: 'bytes', data: new Uint8Array([1]), name: 'blob', ext: '.bin' }] })
    ).toThrow()
  })

  it('uses FileEntryIdSchema for single-entry file operations', () => {
    const input = fileRequestSchemas['file.open'].input

    expect(input.parse({ id: VALID_UUID_V7 })).toEqual({ id: FileEntryIdSchema.parse(VALID_UUID_V7) })
    expect(() => input.parse({ id: 'not-a-uuid' })).toThrow()
    expect(() => input.parse({ id: VALID_UUID_V7, extra: true })).toThrow()
  })
})
