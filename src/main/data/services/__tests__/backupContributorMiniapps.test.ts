// Unit tests for the MINIAPPS contributor — pure declaration assertions (no DB).
import { table } from '@main/data/db/backup/dbSchemaRefs'
import { describe, expect, it } from 'vitest'

import { MINIAPPS_CONTRIBUTOR } from '../backupContributorMiniapps'

describe('MINIAPPS contributor', () => {
  it('owns mini_app + mini_app_logo_file_ref', () => {
    expect(MINIAPPS_CONTRIBUTOR.schema.tables).toEqual([table('mini_app'), table('mini_app_logo_file_ref')])
  })

  it('declares logo_file_ref owning + junction references', () => {
    const refs = MINIAPPS_CONTRIBUTOR.schema.references
    expect(refs).toHaveLength(2)
    expect(refs).toContainEqual(
      expect.objectContaining({
        table: table('mini_app_logo_file_ref'),
        column: 'sourceId',
        referencedDomain: 'MINIAPPS',
        kind: 'owning'
      })
    )
    expect(refs).toContainEqual(
      expect.objectContaining({
        table: table('mini_app_logo_file_ref'),
        column: 'fileEntryId',
        referencedDomain: 'FILE_STORAGE',
        kind: 'junction'
      })
    )
  })

  it('mini_app aggregate is a natural-key root with logo_file_ref member, non-renamable', () => {
    const aggregate = MINIAPPS_CONTRIBUTOR.schema.aggregates[0]
    expect(aggregate.root).toBe(table('mini_app'))
    expect(aggregate.identityKey).toEqual(['appId'])
    expect(aggregate.renamable).toBe(false)
    expect(aggregate.members).toEqual([
      expect.objectContaining({ table: table('mini_app_logo_file_ref'), viaColumn: 'sourceId', cascade: 'include' })
    ])
  })

  it('declares mini_app_logo fileRefSourcePolicy', () => {
    expect(MINIAPPS_CONTRIBUTOR.schema.fileRefSourcePolicies).toEqual([
      expect.objectContaining({
        sourceType: 'mini_app_logo',
        ownerDomain: 'MINIAPPS',
        resourcePolicy: 'include-with-owner'
      })
    ])
  })

  it('declares no jsonSoftReferences', () => {
    expect(MINIAPPS_CONTRIBUTOR.schema.jsonSoftReferences).toEqual([])
  })

  it('primary key is non-ambiguous (mini_app appId natural)', () => {
    for (const pk of MINIAPPS_CONTRIBUTOR.schema.primaryKeys) {
      expect(pk.ambiguous).toBeFalsy()
    }
  })

  it('schema is deep-frozen (mutation throws)', () => {
    expect(() => {
      ;(MINIAPPS_CONTRIBUTOR.schema.tables as unknown as string[]).push('x')
    }).toThrow()
  })
})
