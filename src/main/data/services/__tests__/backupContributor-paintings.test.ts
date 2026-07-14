// Unit tests for the PAINTINGS contributor — pure declaration assertions (no DB).
import { table } from '@main/data/db/backup/dbSchemaRefs'
import { describe, expect, it } from 'vitest'

import { PAINTINGS_CONTRIBUTOR } from '../backupContributor-paintings'

describe('PAINTINGS contributor', () => {
  it('owns painting + painting_file_ref', () => {
    expect(PAINTINGS_CONTRIBUTOR.schema.tables).toEqual([table('painting'), table('painting_file_ref')])
  })

  it('declares sourceId owning + fileEntryId cross-domain junction reference', () => {
    const refs = PAINTINGS_CONTRIBUTOR.schema.references
    expect(refs).toHaveLength(2)
    // painting_file_ref.sourceId → painting: same-domain owning (aggregate membership).
    expect(refs).toContainEqual(
      expect.objectContaining({
        table: table('painting_file_ref'),
        column: 'sourceId',
        referencedDomain: 'PAINTINGS',
        kind: 'owning'
      })
    )
    // painting_file_ref.fileEntryId → file_entry (FILE_STORAGE): junction (dual-cascade
    // junction table, cross-domain endpoint — mirrors TOPICS chat_message_file_ref).
    expect(refs).toContainEqual(
      expect.objectContaining({
        table: table('painting_file_ref'),
        column: 'fileEntryId',
        referencedDomain: 'FILE_STORAGE',
        kind: 'junction'
      })
    )
  })

  it('painting aggregate has painting_file_ref as a sourceId include member, non-renamable', () => {
    const aggregate = PAINTINGS_CONTRIBUTOR.schema.aggregates[0]
    expect(aggregate.root).toBe(table('painting'))
    expect(aggregate.identityKey).toEqual(['id'])
    expect(aggregate.renamable).toBe(false)
    expect(aggregate.members).toEqual([
      expect.objectContaining({ table: table('painting_file_ref'), viaColumn: 'sourceId', cascade: 'include' })
    ])
  })

  it('identityKey is the single-column root PK (uniqueness via uuid-v4)', () => {
    const aggregate = PAINTINGS_CONTRIBUTOR.schema.aggregates[0]
    expect(aggregate.identityKey).toEqual(['id'])
    expect(aggregate.identityKey).toHaveLength(1)
  })

  it('classifies painting sourceType in fileRefSourcePolicies', () => {
    const policies = PAINTINGS_CONTRIBUTOR.schema.fileRefSourcePolicies
    expect(policies).toHaveLength(1)
    expect(policies).toContainEqual(
      expect.objectContaining({
        sourceType: 'painting',
        ownerDomain: 'PAINTINGS',
        resourcePolicy: 'include-with-owner',
        sourceTable: table('painting_file_ref')
      })
    )
  })

  it('declares no jsonSoftReferences', () => {
    expect(PAINTINGS_CONTRIBUTOR.schema.jsonSoftReferences).toEqual([])
  })

  it('primary keys are non-ambiguous (painting uuid-v4; painting_file_ref uuid-v4)', () => {
    for (const pk of PAINTINGS_CONTRIBUTOR.schema.primaryKeys) {
      expect(pk.ambiguous).toBeFalsy()
    }
  })

  it('schema is deep-frozen (mutation throws)', () => {
    expect(() => {
      ;(PAINTINGS_CONTRIBUTOR.schema.tables as unknown as string[]).push('x')
    }).toThrow()
  })
})
