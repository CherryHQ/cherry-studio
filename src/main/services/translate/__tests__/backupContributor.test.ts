// Unit tests for the TRANSLATE_HISTORY contributor — pure declaration assertions (no DB).
import { table } from '@main/data/db/backup/dbSchemaRefs'
import { describe, expect, it } from 'vitest'

import { TRANSLATE_HISTORY_CONTRIBUTOR } from '../backupContributor'

describe('TRANSLATE_HISTORY contributor', () => {
  it('owns translate_language + translate_history', () => {
    expect(TRANSLATE_HISTORY_CONTRIBUTOR.schema.tables).toEqual([
      table('translate_language'),
      table('translate_history')
    ])
  })

  it('has two INDEPENDENT aggregates (history is not a language member)', () => {
    const aggregates = TRANSLATE_HISTORY_CONTRIBUTOR.schema.aggregates
    expect(aggregates).toHaveLength(2)
    // Neither aggregate has members, so neither can be a parent of the other.
    expect(aggregates[0].members).toEqual([])
    expect(aggregates[1].members).toEqual([])
  })

  it('translate_history is a uuid-entity root keyed by id (derived defaults left to finalize)', () => {
    const history = TRANSLATE_HISTORY_CONTRIBUTOR.schema.aggregates.find((a) => a.root === table('translate_history'))!
    expect(history.identityKey).toEqual(['id'])
    expect(history.renamable).toBe(false)
    // identityClass/conflictDefault are intentionally omitted — finalize derives
    // uuid-v7 → uuid-entity → SKIP. Asserting them here would couple the test to
    // derived (non-declared) values; the finalize test covers derivation.
  })

  it('translate_language is natural-key FIELD_MERGE on langCode', () => {
    const lang = TRANSLATE_HISTORY_CONTRIBUTOR.schema.aggregates.find((a) => a.root === table('translate_language'))!
    expect(lang.identityKey).toEqual(['langCode'])
    expect(lang.identityClass).toBe('natural-key')
    expect(lang.conflictDefault).toBe('FIELD_MERGE')
  })

  it('sourceLanguage/targetLanguage are optional same-domain references', () => {
    const refs = TRANSLATE_HISTORY_CONTRIBUTOR.schema.references
    expect(refs).toHaveLength(2)
    for (const ref of refs) {
      expect(ref.table).toBe(table('translate_history'))
      expect(ref.referencedDomain).toBe('TRANSLATE_HISTORY')
      expect(ref.kind).toBe('optional')
    }
    expect(refs.some((r) => r.column === 'sourceLanguage')).toBe(true)
    expect(refs.some((r) => r.column === 'targetLanguage')).toBe(true)
  })

  it('primary keys: language natural (ambiguous overridden), history uuid-v7', () => {
    const lang = TRANSLATE_HISTORY_CONTRIBUTOR.schema.primaryKeys.find((p) => p.table === 'translate_language')!
    const history = TRANSLATE_HISTORY_CONTRIBUTOR.schema.primaryKeys.find((p) => p.table === 'translate_history')!
    expect(lang.kind).toBe('natural')
    expect(lang.ambiguous).toBe(false) // codegen marks it ambiguous; contributor confirms
    expect(history.kind).toBe('uuid-v7')
    expect(history.ambiguous).toBeFalsy()
  })

  it('schema is deep-frozen (mutation throws)', () => {
    expect(() => {
      ;(TRANSLATE_HISTORY_CONTRIBUTOR.schema.tables as unknown as string[]).push('x')
    }).toThrow()
  })
})
