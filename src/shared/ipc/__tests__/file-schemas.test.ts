import { FileEntryIdSchema } from '@shared/data/types/file'
import { describe, expect, it } from 'vitest'

import { FILE_IPC_MAX_BATCH_IDS, FILE_IPC_MAX_IMPORT_PATHS, fileRequestSchemas } from '../schemas/file'

const VALID_UUID_V7 = '019606a0-0000-7000-8000-000000000001'
const BATCH_ID_ROUTES = [
  'file.batch_get_metadata',
  'file.batch_get_physical_paths',
  'file.batch_get_dangling_states',
  'file.batch_trash',
  'file.batch_restore',
  'file.batch_permanent_delete'
] as const

describe('file IpcApi schemas', () => {
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

  it('caps imported paths and rejects malformed paths', () => {
    const input = fileRequestSchemas['file.import_paths'].input
    const ok = Array.from({ length: FILE_IPC_MAX_IMPORT_PATHS }, () => '/tmp/import.md')

    expect(input.parse({ paths: ok }).paths).toHaveLength(FILE_IPC_MAX_IMPORT_PATHS)
    expect(() => input.parse({ paths: [] })).toThrow()
    expect(() => input.parse({ paths: [...ok, '/tmp/import.md'] })).toThrow()
    expect(() => input.parse({ paths: ['relative.md'] })).toThrow()
  })

  it('uses FileEntryIdSchema for single-entry file operations', () => {
    const input = fileRequestSchemas['file.open'].input

    expect(input.parse({ id: VALID_UUID_V7 })).toEqual({ id: FileEntryIdSchema.parse(VALID_UUID_V7) })
    expect(() => input.parse({ id: 'not-a-uuid' })).toThrow()
    expect(() => input.parse({ id: VALID_UUID_V7, extra: true })).toThrow()
  })
})
