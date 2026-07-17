// Unit tests for the PROVIDERS contributor — pure declaration assertions (no DB).
import { table } from '@main/data/db/backup/dbSchemaRefs'
import { describe, expect, it } from 'vitest'

import { PROVIDERS_CONTRIBUTOR } from '../backupContributorProviders'

describe('PROVIDERS contributor', () => {
  it('owns user_provider + user_model + provider_logo_file_ref', () => {
    expect(PROVIDERS_CONTRIBUTOR.schema.tables).toEqual([
      table('user_provider'),
      table('user_model'),
      table('provider_logo_file_ref')
    ])
  })

  it('declares owning + junction references (user_model.providerId + logo_file_ref sourceId/fileEntryId)', () => {
    const refs = PROVIDERS_CONTRIBUTOR.schema.references
    expect(refs).toHaveLength(3)
    // user_model.providerId → user_provider: same-domain owning (cascade).
    expect(refs).toContainEqual(
      expect.objectContaining({
        table: table('user_model'),
        column: 'providerId',
        referencedDomain: 'PROVIDERS',
        kind: 'owning'
      })
    )
    // provider_logo_file_ref.sourceId → user_provider: same-domain owning (cascade).
    expect(refs).toContainEqual(
      expect.objectContaining({
        table: table('provider_logo_file_ref'),
        column: 'sourceId',
        referencedDomain: 'PROVIDERS',
        kind: 'owning'
      })
    )
    // provider_logo_file_ref.fileEntryId → file_entry (FILE_STORAGE): cross-domain junction.
    expect(refs).toContainEqual(
      expect.objectContaining({
        table: table('provider_logo_file_ref'),
        column: 'fileEntryId',
        referencedDomain: 'FILE_STORAGE',
        kind: 'junction'
      })
    )
  })

  it('user_provider aggregate has user_model + logo_file_ref as include members, non-renamable', () => {
    const aggregate = PROVIDERS_CONTRIBUTOR.schema.aggregates[0]
    expect(aggregate.root).toBe(table('user_provider'))
    expect(aggregate.identityKey).toEqual(['providerId'])
    expect(aggregate.renamable).toBe(false)
    expect(aggregate.members).toEqual([
      expect.objectContaining({ table: table('user_model'), viaColumn: 'providerId', cascade: 'include' }),
      expect.objectContaining({ table: table('provider_logo_file_ref'), viaColumn: 'sourceId', cascade: 'include' })
    ])
  })

  it('identity key is unique (user_provider.providerId is the business identity)', () => {
    const aggregate = PROVIDERS_CONTRIBUTOR.schema.aggregates[0]
    expect(aggregate.identityKey).toEqual(['providerId'])
  })

  it('declares provider_logo fileRefSourcePolicy + no jsonSoftReferences', () => {
    expect(PROVIDERS_CONTRIBUTOR.schema.fileRefSourcePolicies).toEqual([
      expect.objectContaining({
        sourceType: 'provider_logo',
        ownerDomain: 'PROVIDERS',
        resourcePolicy: 'include-with-owner'
      })
    ])
    expect(PROVIDERS_CONTRIBUTOR.schema.jsonSoftReferences).toEqual([])
  })

  it('declares uniqueMergeRules for user_model by [providerId, modelId]', () => {
    expect(PROVIDERS_CONTRIBUTOR.backupPolicy.uniqueMergeRules).toEqual([
      expect.objectContaining({ table: table('user_model'), uniqueColumns: ['providerId', 'modelId'] })
    ])
  })

  it('declares fieldMergePolicies for apiKeys + authConfig (remote-fills-local-empty)', () => {
    // remote-fills-local-empty treats [], null, and empty/skeleton auth as missing —
    // seeded providers ship apiKeys=[] / auth skeletons, so plain -local-null would
    // drop backed-up credentials.
    expect(PROVIDERS_CONTRIBUTOR.backupPolicy.fieldMergePolicies).toEqual([
      expect.objectContaining({
        table: table('user_provider'),
        column: 'apiKeys',
        strategy: 'remote-fills-local-empty'
      }),
      expect.objectContaining({
        table: table('user_provider'),
        column: 'authConfig',
        strategy: 'remote-fills-local-empty'
      })
    ])
  })
})
