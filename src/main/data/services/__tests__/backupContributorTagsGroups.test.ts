// Unit tests for the TAGS_GROUPS contributor — pure declaration assertions (no DB).
import { table } from '@main/data/db/backup/dbSchemaRefs'
import { describe, expect, it } from 'vitest'

import { TAGS_GROUPS_CONTRIBUTOR } from '../backupContributorTagsGroups'

describe('TAGS_GROUPS contributor', () => {
  it('owns tag, entity_tag, group, pin', () => {
    expect(TAGS_GROUPS_CONTRIBUTOR.schema.tables).toEqual([
      table('tag'),
      table('entity_tag'),
      table('group'),
      table('pin')
    ])
  })

  it('entity_tag.tagId is the only declared reference (same-domain owning)', () => {
    const refs = TAGS_GROUPS_CONTRIBUTOR.schema.references
    expect(refs).toHaveLength(1)
    // toContainEqual is loosely typed (unlike toEqual), so the branded column
    // literal matches without a cast.
    expect(refs).toContainEqual(
      expect.objectContaining({
        table: table('entity_tag'),
        column: 'tagId',
        referencedDomain: 'TAGS_GROUPS',
        kind: 'owning'
      })
    )
  })

  it('tag is natural-key FIELD_MERGE on name; group is uuid-entity SKIP; pin natural-key FIELD_MERGE', () => {
    const find = (root: ReturnType<typeof table>) =>
      TAGS_GROUPS_CONTRIBUTOR.schema.aggregates.find((a) => a.root === root)!

    const tag = find(table('tag'))
    expect(tag.identityKey).toEqual(['name'])
    expect(tag.identityClass).toBe('natural-key')
    expect(tag.conflictDefault).toBe('FIELD_MERGE')

    const group = find(table('group'))
    expect(group.identityClass).toBe('uuid-entity')
    expect(group.conflictDefault).toBe('SKIP')

    const pin = find(table('pin'))
    expect(pin.identityKey).toEqual(['entityType', 'entityId'])
    expect(pin.identityClass).toBe('natural-key')
    expect(pin.conflictDefault).toBe('FIELD_MERGE')
  })

  it('entity_tag is owned but is NOT an aggregate member of tag (polymorphic junction)', () => {
    const tag = TAGS_GROUPS_CONTRIBUTOR.schema.aggregates.find((a) => a.root === table('tag'))!
    expect(tag.members).toEqual([])
    // entity_tag has no aggregate of its own
    expect(TAGS_GROUPS_CONTRIBUTOR.schema.aggregates.find((a) => a.root === table('entity_tag'))).toBeUndefined()
  })

  it('all aggregates are non-renamable (no cloneAggregate needed)', () => {
    for (const aggregate of TAGS_GROUPS_CONTRIBUTOR.schema.aggregates) {
      expect(aggregate.renamable).toBe(false)
    }
    expect(TAGS_GROUPS_CONTRIBUTOR.operations?.cloneAggregate).toBeUndefined()
  })

  it('schema is deep-frozen (mutation throws)', () => {
    expect(() => {
      ;(TAGS_GROUPS_CONTRIBUTOR.schema.tables as unknown as string[]).push('x')
    }).toThrow()
  })
})
