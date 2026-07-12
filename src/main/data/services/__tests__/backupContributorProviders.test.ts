// Unit tests for the PROVIDERS contributor — pure declaration assertions (no DB).
import { table } from '@main/data/db/backup/dbSchemaRefs'
import { describe, expect, it } from 'vitest'

import { PROVIDERS_CONTRIBUTOR } from '../backupContributorProviders'

describe('PROVIDERS contributor', () => {
  it('owns user_provider + user_model', () => {
    expect(PROVIDERS_CONTRIBUTOR.schema.tables).toEqual([table('user_provider'), table('user_model')])
  })

  it('declares providerId owning reference (same-domain, aggregate membership)', () => {
    const refs = PROVIDERS_CONTRIBUTOR.schema.references
    expect(refs).toHaveLength(1)
    // user_model.providerId → user_provider: same-domain owning (cascade).
    expect(refs).toContainEqual(
      expect.objectContaining({
        table: table('user_model'),
        column: 'providerId',
        referencedDomain: 'PROVIDERS',
        kind: 'owning'
      })
    )
  })

  it('user_provider aggregate has user_model as a providerId include member, non-renamable', () => {
    const aggregate = PROVIDERS_CONTRIBUTOR.schema.aggregates[0]
    expect(aggregate.root).toBe(table('user_provider'))
    expect(aggregate.identityKey).toEqual(['providerId'])
    expect(aggregate.renamable).toBe(false)
    expect(aggregate.members).toEqual([
      expect.objectContaining({ table: table('user_model'), viaColumn: 'providerId', cascade: 'include' })
    ])
  })

  it('identity key is unique (user_provider.providerId is the business identity)', () => {
    const aggregate = PROVIDERS_CONTRIBUTOR.schema.aggregates[0]
    expect(aggregate.identityKey).toEqual(['providerId'])
  })

  it('declares no fileRefSourcePolicies and no jsonSoftReferences', () => {
    expect(PROVIDERS_CONTRIBUTOR.schema.fileRefSourcePolicies).toEqual([])
    expect(PROVIDERS_CONTRIBUTOR.schema.jsonSoftReferences).toEqual([])
  })

  it('primary keys are non-ambiguous (user_provider/user_model natural-key)', () => {
    for (const pk of PROVIDERS_CONTRIBUTOR.schema.primaryKeys) {
      expect(pk.ambiguous).toBeFalsy()
    }
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

  it('schema is deep-frozen (mutation throws)', () => {
    expect(() => {
      ;(PROVIDERS_CONTRIBUTOR.schema.tables as unknown as string[]).push('x')
    }).toThrow()
  })
})
