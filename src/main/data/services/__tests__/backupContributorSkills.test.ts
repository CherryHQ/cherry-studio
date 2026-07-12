// Unit tests for the SKILLS contributor — pure declaration assertions (no DB).
import { table } from '@main/data/db/backup/dbSchemaRefs'
import { describe, expect, it } from 'vitest'

import { SKILLS_CONTRIBUTOR } from '../backupContributorSkills'

describe('SKILLS contributor', () => {
  it('owns exactly agent_global_skill (NOT agent_skill, which belongs to AGENTS)', () => {
    expect(SKILLS_CONTRIBUTOR.schema.tables).toEqual([table('agent_global_skill')])
  })

  it('identityKey is the UNIQUE folderName (natural-key, not the uuid PK)', () => {
    const aggregate = SKILLS_CONTRIBUTOR.schema.aggregates[0]
    expect(aggregate.root).toBe(table('agent_global_skill'))
    expect(aggregate.identityKey).toEqual(['folderName'])
    expect(aggregate.identityClass).toBe('natural-key')
    expect(aggregate.conflictDefault).toBe('FIELD_MERGE')
    expect(aggregate.members).toEqual([])
    expect(aggregate.renamable).toBe(false)
  })

  it('agent_global_skill primary key is uuid-v4 and non-ambiguous', () => {
    const primaryKey = SKILLS_CONTRIBUTOR.schema.primaryKeys.find((fact) => fact.table === 'agent_global_skill')
    expect(primaryKey).toBeDefined()
    expect(primaryKey!.kind).toBe('uuid-v4')
    expect(primaryKey!.ambiguous).toBeFalsy()
  })

  it('has no references, file-ref policies, or JSON soft-refs', () => {
    expect(SKILLS_CONTRIBUTOR.schema.references).toEqual([])
    expect(SKILLS_CONTRIBUTOR.schema.fileRefSourcePolicies).toEqual([])
    expect(SKILLS_CONTRIBUTOR.schema.jsonSoftReferences).toEqual([])
  })

  it('schema is deep-frozen (mutation throws)', () => {
    expect(() => {
      ;(SKILLS_CONTRIBUTOR.schema.tables as unknown as string[]).push('x')
    }).toThrow()
  })
})
