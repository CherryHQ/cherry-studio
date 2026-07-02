// Unit tests for the FILE_STORAGE contributor — pure declaration assertions (no DB).
import { table } from '@main/data/db/backup/dbSchemaRefs'
import { describe, expect, it } from 'vitest'

import { FILE_STORAGE_CONTRIBUTOR } from '../backupContributor-file-storage'

describe('FILE_STORAGE contributor', () => {
  it('owns file_entry only (post-#16532 file_ref split moved junctions to source domains)', () => {
    expect(FILE_STORAGE_CONTRIBUTOR.schema.tables).toEqual([table('file_entry')])
  })

  it('has no cross-domain references (file_entry has no FKs)', () => {
    expect(FILE_STORAGE_CONTRIBUTOR.schema.references).toEqual([])
  })

  it('file_entry aggregate is a non-renamable uuid-entity root', () => {
    const aggregate = FILE_STORAGE_CONTRIBUTOR.schema.aggregates[0]
    expect(aggregate.root).toBe(table('file_entry'))
    expect(aggregate.identityKey).toEqual(['id'])
    expect(aggregate.renamable).toBe(false)
  })

  it('declares no fileRefSourcePolicies (junctions belong to source domains; sourceTypes deferred)', () => {
    expect(FILE_STORAGE_CONTRIBUTOR.schema.fileRefSourcePolicies).toEqual([])
  })

  it('primary key is non-ambiguous (file_entry uuid-v7)', () => {
    for (const pk of FILE_STORAGE_CONTRIBUTOR.schema.primaryKeys) {
      expect(pk.ambiguous).toBeFalsy()
    }
  })

  it('schema is deep-frozen (mutation throws)', () => {
    expect(() => {
      ;(FILE_STORAGE_CONTRIBUTOR.schema.tables as unknown as string[]).push('x')
    }).toThrow()
  })
})
