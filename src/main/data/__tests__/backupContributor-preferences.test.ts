// Unit tests for the PREFERENCES contributor — pure declaration assertions (no DB).
import { table } from '@main/data/db/backup/dbSchemaRefs'
import { describe, expect, it } from 'vitest'

import { PREFERENCES_CONTRIBUTOR } from '../backupContributor-preferences'

describe('PREFERENCES contributor', () => {
  it('owns preference + note', () => {
    expect(PREFERENCES_CONTRIBUTOR.schema.tables).toEqual([table('preference'), table('note')])
  })

  it('preference has composite PK [scope, key]; note has uuid-v4 PK', () => {
    const preference = PREFERENCES_CONTRIBUTOR.schema.primaryKeys.find((p) => p.table === 'preference')!
    const note = PREFERENCES_CONTRIBUTOR.schema.primaryKeys.find((p) => p.table === 'note')!
    expect(preference.columns).toEqual(['scope', 'key'])
    expect(preference.kind).toBe('composite')
    expect(note.kind).toBe('uuid-v4')
  })

  it('both aggregates are natural-key SKIP (settings exception, invariant #21)', () => {
    const preference = PREFERENCES_CONTRIBUTOR.schema.aggregates.find((a) => a.root === table('preference'))!
    const note = PREFERENCES_CONTRIBUTOR.schema.aggregates.find((a) => a.root === table('note'))!
    expect(preference.identityKey).toEqual(['scope', 'key'])
    expect(preference.identityClass).toBe('natural-key')
    expect(preference.conflictDefault).toBe('SKIP')
    expect(preference.renamable).toBe(false)
    // note identityKey is the UNIQUE (rootPath, path) overlay key, not the uuid PK
    expect(note.identityKey).toEqual(['rootPath', 'path'])
    expect(note.identityClass).toBe('natural-key')
    expect(note.conflictDefault).toBe('SKIP')
    expect(note.renamable).toBe(false)
  })

  it('has no cross-domain references and no JSON soft-refs (preference.value is free-form JSON)', () => {
    expect(PREFERENCES_CONTRIBUTOR.schema.references).toEqual([])
    expect(PREFERENCES_CONTRIBUTOR.schema.jsonSoftReferences).toEqual([])
  })

  it('declares platformSpecificKeys for restore-time cross-platform exclusion', () => {
    expect(PREFERENCES_CONTRIBUTOR.backupPolicy.platformSpecificKeys).toBeDefined()
    expect(PREFERENCES_CONTRIBUTOR.backupPolicy.platformSpecificKeys!.length).toBeGreaterThan(0)
  })

  it('schema is deep-frozen (mutation throws)', () => {
    expect(() => {
      ;(PREFERENCES_CONTRIBUTOR.schema.tables as unknown as string[]).push('x')
    }).toThrow()
  })
})
