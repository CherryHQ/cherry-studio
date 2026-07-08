// Unit tests for the TRANSLATE_HISTORY contributor — pure declaration assertions (no DB),
// mirroring the other 12 contributor test files per contributor-testing.md
// "contributor 单元测试（每域 __tests__/）".
import { table } from '@main/data/db/backup/dbSchemaRefs'
import { TRANSLATE_HISTORY_CONTRIBUTOR } from '@main/services/translate/backupContributor'
import { describe, expect, it } from 'vitest'

describe('TRANSLATE_HISTORY contributor', () => {
  it('owns translate_language + translate_history', () => {
    expect(TRANSLATE_HISTORY_CONTRIBUTOR.schema.tables).toEqual([
      table('translate_language'),
      table('translate_history')
    ])
  })

  it('two INDEPENDENT aggregates (translate_history is NOT a member of translate_language)', () => {
    // Independence matters: a history row survives a langCode-group SKIP/FIELD_MERGE —
    // member semantics would wrongly drop it. See openspec simple-domains.md.
    const language = TRANSLATE_HISTORY_CONTRIBUTOR.schema.aggregates.find(
      (a) => a.root === table('translate_language')
    )!
    const history = TRANSLATE_HISTORY_CONTRIBUTOR.schema.aggregates.find((a) => a.root === table('translate_history'))!
    expect(language.members).toEqual([])
    expect(history.members).toEqual([])
    expect(language.renamable).toBe(false)
    expect(history.renamable).toBe(false)
  })

  it('translate_language is natural-key FIELD_MERGE (langCode)', () => {
    const language = TRANSLATE_HISTORY_CONTRIBUTOR.schema.aggregates.find(
      (a) => a.root === table('translate_language')
    )!
    expect(language.identityKey).toEqual(['langCode'])
    expect(language.identityClass).toBe('natural-key')
    // natural-key aggregates cannot fall back to global SKIP (finalize guard) —
    // FIELD_MERGE keeps the user's language config across devices instead of dropping it.
    expect(language.conflictDefault).toBe('FIELD_MERGE')
  })

  it('translate_history aggregate: identityKey=id, no members, non-renamable', () => {
    const history = TRANSLATE_HISTORY_CONTRIBUTOR.schema.aggregates.find((a) => a.root === table('translate_history'))!
    expect(history.identityKey).toEqual(['id'])
    expect(history.members).toEqual([])
    expect(history.renamable).toBe(false)
  })

  it('history sourceLanguage/targetLanguage are same-domain optional (SET_NULL, not DELETE_ROW)', () => {
    // optional keeps a history row meaningful when its language is missing — SET_NULL
    // instead of DELETE_ROW (which would lose the translation log).
    const refs = TRANSLATE_HISTORY_CONTRIBUTOR.schema.references
    expect(refs).toHaveLength(2)
    expect(refs.every((r) => r.referencedDomain === 'TRANSLATE_HISTORY' && r.kind === 'optional')).toBe(true)
    expect(refs.map((r) => r.column).sort()).toEqual(['sourceLanguage', 'targetLanguage'])
  })

  it('has no file-ref policies or JSON soft-refs', () => {
    expect(TRANSLATE_HISTORY_CONTRIBUTOR.schema.fileRefSourcePolicies).toEqual([])
    expect(TRANSLATE_HISTORY_CONTRIBUTOR.schema.jsonSoftReferences).toEqual([])
  })

  it('operations is undefined (export-only this slice; restore hooks land in C/D track)', () => {
    expect(TRANSLATE_HISTORY_CONTRIBUTOR.operations).toBeUndefined()
  })

  it('schema is deep-frozen (mutation throws)', () => {
    expect(() => {
      // Readonly array push throws once frozen; cast only to satisfy tsc in the test.
      ;(TRANSLATE_HISTORY_CONTRIBUTOR.schema.tables as unknown as string[]).push('x')
    }).toThrow()
  })
})
