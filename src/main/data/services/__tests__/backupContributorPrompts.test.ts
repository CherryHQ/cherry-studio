// Unit tests for the PROMPTS contributor — pure declaration assertions (no DB),
// co-located in the prompts owning module (per-domain __tests__ convention).
import { table } from '@main/data/db/backup/dbSchemaRefs'
import { describe, expect, it } from 'vitest'

import { PROMPTS_CONTRIBUTOR } from '../backupContributorPrompts'

describe('PROMPTS contributor', () => {
  it('owns exactly the prompt table', () => {
    expect(PROMPTS_CONTRIBUTOR.schema.tables).toEqual([table('prompt')])
  })

  it('prompt aggregate: root=prompt, no members, non-renamable', () => {
    const aggregate = PROMPTS_CONTRIBUTOR.schema.aggregates[0]
    expect(aggregate.root).toBe(table('prompt'))
    expect(aggregate.members).toEqual([])
    expect(aggregate.renamable).toBe(false)
  })

  it('prompt primary key is uuid-v4 and non-ambiguous', () => {
    const primaryKey = PROMPTS_CONTRIBUTOR.schema.primaryKeys.find((fact) => fact.table === 'prompt')
    expect(primaryKey).toBeDefined()
    expect(primaryKey!.kind).toBe('uuid-v4')
    expect(primaryKey!.ambiguous).toBeFalsy()
  })

  it('has no cross-domain references, file-ref policies, or JSON soft-refs', () => {
    expect(PROMPTS_CONTRIBUTOR.schema.references).toEqual([])
    expect(PROMPTS_CONTRIBUTOR.schema.fileRefSourcePolicies).toEqual([])
    expect(PROMPTS_CONTRIBUTOR.schema.jsonSoftReferences).toEqual([])
  })

  it('schema is deep-frozen (mutation throws)', () => {
    expect(() => {
      // Readonly array push throws once frozen; cast only to satisfy tsc in the test.
      ;(PROMPTS_CONTRIBUTOR.schema.tables as unknown as string[]).push('x')
    }).toThrow()
  })
})
