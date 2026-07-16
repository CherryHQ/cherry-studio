import type { EntityReference, ReadonlyBackupRegistry } from '@main/data/db/backup/contributorTypes'
import type { DbTableName } from '@main/data/db/backup/dbSchemaRefs'
import type { BackupDomain } from '@main/data/db/backup/domains'

import type { JunctionDescriptor, JunctionEndpoint } from './types'

/** Resolve a junction FK declaration into the target table it addresses. */
const resolveEndpoint = (
  registry: ReadonlyBackupRegistry,
  table: DbTableName,
  reference: EntityReference
): JunctionEndpoint => {
  const fk = registry.getForeignKeys(table).find((candidate) => candidate.columns.includes(reference.column))
  if (!fk) {
    throw new Error(`junction descriptor has no FK for '${table}.${reference.column}'`)
  }
  return { table: fk.targetTable, fkColumn: reference.column, aggregatePath: 'root' }
}

/** Derive pure, two-ended junction descriptors without duplicating aggregate include members. */
export const deriveJunctionDescriptors = (
  registry: ReadonlyBackupRegistry,
  selectedDomains: readonly BackupDomain[]
): JunctionDescriptor[] => {
  const memberTables = new Set<DbTableName>()
  for (const domain of selectedDomains) {
    for (const aggregate of registry.getAggregatesForDomain(domain)) {
      for (const member of aggregate.members ?? []) {
        if (member.cascade === 'include') memberTables.add(member.table)
      }
    }
  }

  const referencesByTable = new Map<DbTableName, EntityReference[]>()
  for (const domain of selectedDomains) {
    for (const reference of registry.getReferencesForDomain(domain)) {
      if (reference.kind !== 'junction') continue
      const references = referencesByTable.get(reference.table) ?? []
      referencesByTable.set(reference.table, [...references, reference])
    }
  }

  const descriptors: JunctionDescriptor[] = []
  for (const [table, references] of referencesByTable) {
    if (memberTables.has(table) || references.length < 2) continue
    const ownerDomain = registry.getTableOwner(table)
    if (ownerDomain === 'excluded' || ownerDomain === 'infrastructure') continue

    const endpoints = references.map((reference) => resolveEndpoint(registry, table, reference))
    const sourceIndex = endpoints.findIndex((endpoint) => registry.getTableOwner(endpoint.table) === ownerDomain)
    if (sourceIndex < 0) continue
    const targetEndpoint = endpoints.find((_, index) => index !== sourceIndex)
    if (!targetEndpoint) continue

    descriptors.push({ table, ownerDomain, sourceEndpoint: endpoints[sourceIndex], targetEndpoint })
  }
  return descriptors
}
