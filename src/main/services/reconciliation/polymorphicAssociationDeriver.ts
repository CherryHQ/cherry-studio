// polymorphicAssociationDeriver — derive PolymorphicAssociationDescriptors for the
// polymorphic-association import phase (A1 / entity_tag). Distinct from junctionDeriver:
// junctions need ≥2 kind:'junction' refs; polymorphic associations have 1 kind:'owning'
// same-domain FK (tagId → tag) plus a soft polymorphic entityId keyed by entityType.
//
// entity_tag is intentionally NOT an aggregate member and is #25-exempt from FK
// declaration of its soft entityId — so neither importRows nor importAllJunctionRows
// touches it. This deriver is the sole consumer of polymorphicEntityMap for restore.

import type { EntityReference, ReadonlyBackupRegistry } from '@main/data/db/backup/contributorTypes'
import type { DbTableName } from '@main/data/db/backup/dbSchemaRefs'
import type { BackupDomain } from '@main/data/db/backup/domains'
import type { EntityType } from '@shared/data/types/entityType'

import type { PolymorphicAssociationDescriptor } from './types'

/**
 * entityType → identityMap root/member table that holds the entity PK.
 * Must stay exhaustive over EntityType (compile-time via `satisfies`).
 */
export const POLYMORPHIC_ENTITY_TYPE_ROOT_TABLE = {
  assistant: 'assistant',
  topic: 'topic',
  session: 'agent_session',
  agent: 'agent',
  knowledge: 'knowledge_base',
  model: 'user_model'
} as const satisfies Record<EntityType, DbTableName>

/** Resolve the owning FK's target table for the tag endpoint. */
const resolveTagEndpointTable = (
  registry: ReadonlyBackupRegistry,
  table: DbTableName,
  ref: EntityReference
): DbTableName => {
  const fk = registry.getForeignKeys(table).find((f) => f.columns.includes(ref.column))
  if (!fk) {
    throw new Error(
      `polymorphicAssociationDeriver: no FK on '${table}' for column '${ref.column}' (ref → ${ref.referencedDomain})`
    )
  }
  return fk.targetTable
}

/**
 * Derive polymorphic-association descriptors for selected domains. Pure: reads the
 * registry only. Picks tables that (a) are owned by a selected domain with a non-empty
 * polymorphicEntityMap, (b) declare ≥1 kind:'owning' same-domain reference, and (c) are
 * neither aggregate roots nor include-members (those already cascade via importRows —
 * pin is a root and is filtered at scanAggregates instead).
 */
export const derivePolymorphicAssociationDescriptors = (
  registry: ReadonlyBackupRegistry,
  selectedDomains: readonly BackupDomain[]
): PolymorphicAssociationDescriptor[] => {
  const rootAndMemberTables = new Set<DbTableName>()
  for (const d of selectedDomains) {
    for (const agg of registry.getAggregatesForDomain(d)) {
      rootAndMemberTables.add(agg.root)
      for (const m of agg.members ?? []) {
        if (m.cascade === 'include') rootAndMemberTables.add(m.table)
      }
    }
  }

  const out: PolymorphicAssociationDescriptor[] = []
  const seen = new Set<DbTableName>()

  for (const domain of selectedDomains) {
    const map = registry.getSchema(domain).polymorphicEntityMap
    if (!map || Object.keys(map).length === 0) continue

    for (const ref of registry.getReferencesForDomain(domain)) {
      if (ref.kind !== 'owning') continue
      if (ref.referencedDomain !== domain) continue
      if (seen.has(ref.table) || rootAndMemberTables.has(ref.table)) continue
      if (registry.getTableOwner(ref.table) !== domain) continue

      seen.add(ref.table)
      out.push({
        table: ref.table,
        ownerDomain: domain,
        tagEndpoint: {
          table: resolveTagEndpointTable(registry, ref.table, ref),
          fkColumn: ref.column,
          referencedDomain: ref.referencedDomain
        },
        entityEndpoint: {
          fkColumn: 'entityId',
          entityTypeColumn: 'entityType',
          routeBy: map
        }
      })
    }
  }

  return out
}
