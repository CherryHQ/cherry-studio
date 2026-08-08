// polymorphicAssociationDeriver tests — verifies the entity_tag descriptor the
// polymorphic association phase consumes. Uses the real 14-domain registry.

import { contributorManager } from '@main/services/backup/contributors/ContributorManager'
import { describe, expect, it } from 'vitest'

import {
  derivePolymorphicAssociationDescriptors,
  POLYMORPHIC_ENTITY_TYPE_ROOT_TABLE
} from '../polymorphicAssociationDeriver'

const registry = contributorManager.getRegistry()

describe('derivePolymorphicAssociationDescriptors', () => {
  it('derives entity_tag descriptor when TAGS_GROUPS selected', () => {
    const descs = derivePolymorphicAssociationDescriptors(registry, ['TAGS_GROUPS'])
    expect(descs).toHaveLength(1)
    expect(descs[0].table).toBe('entity_tag')
    expect(descs[0].ownerDomain).toBe('TAGS_GROUPS')
    expect(descs[0].tagEndpoint).toEqual({
      table: 'tag',
      fkColumn: 'tagId',
      referencedDomain: 'TAGS_GROUPS'
    })
    expect(descs[0].entityEndpoint.fkColumn).toBe('entityId')
    expect(descs[0].entityEndpoint.entityTypeColumn).toBe('entityType')
  })

  it('does not derive entity_tag when TAGS_GROUPS not selected', () => {
    const descs = derivePolymorphicAssociationDescriptors(registry, [
      'ASSISTANTS',
      'TOPICS',
      'AGENTS',
      'KNOWLEDGE',
      'PROVIDERS'
    ])
    expect(descs).toEqual([])
  })

  it('still derives exactly one descriptor when other domains are also selected', () => {
    const descs = derivePolymorphicAssociationDescriptors(registry, [
      'TAGS_GROUPS',
      'ASSISTANTS',
      'TOPICS',
      'AGENTS',
      'KNOWLEDGE',
      'PROVIDERS',
      'FILE_STORAGE'
    ])
    expect(descs.map((d) => d.table)).toEqual(['entity_tag'])
  })

  it('descriptor.entityEndpoint routes via polymorphicEntityMap for each entityType', () => {
    const [desc] = derivePolymorphicAssociationDescriptors(registry, ['TAGS_GROUPS'])
    expect(desc).toBeDefined()
    const routeBy = desc.entityEndpoint.routeBy
    expect(routeBy.assistant).toBe('ASSISTANTS')
    expect(routeBy.topic).toBe('TOPICS')
    expect(routeBy.model).toBe('PROVIDERS')
    expect(routeBy.agent).toBe('AGENTS')
    expect(routeBy.knowledge).toBe('KNOWLEDGE')
    expect(routeBy.session).toBe('AGENTS')
    // Root-table map stays exhaustive over EntityType.
    for (const entityType of Object.keys(routeBy)) {
      expect(
        POLYMORPHIC_ENTITY_TYPE_ROOT_TABLE[entityType as keyof typeof POLYMORPHIC_ENTITY_TYPE_ROOT_TABLE]
      ).toBeDefined()
    }
  })

  it('does not derive pin (aggregate root filtered at scanAggregates, not here)', () => {
    const descs = derivePolymorphicAssociationDescriptors(registry, ['TAGS_GROUPS'])
    expect(descs.map((d) => d.table)).not.toContain('pin')
  })
})
