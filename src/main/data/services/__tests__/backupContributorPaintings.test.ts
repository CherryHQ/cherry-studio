// Unit tests for the PAINTINGS contributor — pure declaration assertions (no DB).
import { BackupReadonlyDb } from '@main/data/db/backup/contexts'
import { table } from '@main/data/db/backup/dbSchemaRefs'
import { fileEntryTable } from '@main/data/db/schemas/file'
import { paintingFileRefTable } from '@main/data/db/schemas/fileRelations'
import { paintingTable } from '@main/data/db/schemas/painting'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { collectPaintingFileIds, PAINTINGS_CONTRIBUTOR } from '../backupContributorPaintings'

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

// DB-backed tests for collectFileResources — returns painting_file_ref.fileEntryId (deduped).
describe('PAINTINGS collectFileResources (collectPaintingFileIds)', () => {
  const dbh = setupTestDatabase()

  it('returns deduped fileEntryIds (a file shared by input+output refs counts once)', async () => {
    // FK prerequisites: painting + file_entry must exist before painting_file_ref.
    await dbh.db.insert(paintingTable).values([{ id: 'p1', providerId: 'prov', prompt: 'x', orderKey: 'a' }])
    await dbh.db.insert(fileEntryTable).values([
      { id: 'pf1', origin: 'internal', name: 'a', size: 10 },
      { id: 'pf2', origin: 'internal', name: 'b', size: 20 }
    ])
    await dbh.db.insert(paintingFileRefTable).values([
      { fileEntryId: 'pf1', sourceId: 'p1', role: 'output' },
      { fileEntryId: 'pf2', sourceId: 'p1', role: 'output' },
      { fileEntryId: 'pf1', sourceId: 'p1', role: 'input' } // pf1 reappears → deduped
    ])
    const ids = await collectPaintingFileIds(new BackupReadonlyDb(dbh.db))
    expect(ids).toEqual(new Set(['pf1', 'pf2']))
  })

  it('returns empty set when no painting_file_ref rows exist', async () => {
    const ids = await collectPaintingFileIds(new BackupReadonlyDb(dbh.db))
    expect(ids).toEqual(new Set())
  })
})
