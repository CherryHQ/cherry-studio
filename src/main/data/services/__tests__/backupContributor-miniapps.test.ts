// Unit tests for the MINIAPPS contributor — pure declaration assertions (no DB).
import { table } from '@main/data/db/backup/dbSchemaRefs'
import { describe, expect, it } from 'vitest'

import { MINIAPPS_CONTRIBUTOR } from '../backupContributor-miniapps'

describe('MINIAPPS contributor', () => {
  it('owns mini_app', () => {
    expect(MINIAPPS_CONTRIBUTOR.schema.tables).toEqual([table('mini_app')])
  })

  it('declares no references (presetMiniAppId points at a non-DB preset, not a DB row)', () => {
    expect(MINIAPPS_CONTRIBUTOR.schema.references).toEqual([])
  })

  it('mini_app aggregate is a single-table natural-key root, non-renamable', () => {
    const aggregate = MINIAPPS_CONTRIBUTOR.schema.aggregates[0]
    expect(aggregate.root).toBe(table('mini_app'))
    expect(aggregate.identityKey).toEqual(['appId'])
    expect(aggregate.renamable).toBe(false)
    expect(aggregate.members).toEqual([])
  })

  it('declares no fileRefSourcePolicies', () => {
    expect(MINIAPPS_CONTRIBUTOR.schema.fileRefSourcePolicies).toEqual([])
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
