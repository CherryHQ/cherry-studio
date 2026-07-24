// junctionDeriver — derive the pure-junction JunctionDescriptors the global junction phase
// (B4) consumes. A "pure junction" table has 2+ `kind:'junction'` references AND is NOT an
// include-member of any selected aggregate (include-members like assistant_mcp_server /
// chat_message_file_ref are already imported via root/member cascade; re-importing here
// would double-write). entity_tag is naturally excluded (its only ref is kind:'owning').
//
// Endpoints are resolved via `getForeignKeys` — `EntityReference` carries `referencedDomain`
// only, not the target table. Stage-4 output: 3 descriptors — agent_skill, agent_mcp_server,
// agent_channel_task — all ownerDomain AGENTS, all endpoints root tables (no member-table
// endpoint among pure junctions; member-table endpoints belong to include-member junctions).
//
// Source vs target is resolved by explicit `EntityReference.junctionRole` (finalize #27a),
// NOT by declaration order — a cosmetic reorder of the two junction refs is a silent no-op.

import type { EntityReference, ReadonlyBackupRegistry } from '@main/data/db/backup/contributorTypes'
import type { DbTableName } from '@main/data/db/backup/dbSchemaRefs'
import type { BackupDomain } from '@main/data/db/backup/domains'

import type { JunctionDescriptor, JunctionEndpoint } from './types'

/** Resolve an endpoint's target table + aggregatePath for a junction FK column. */
const resolveEndpoint = (
  registry: ReadonlyBackupRegistry,
  table: DbTableName,
  ref: EntityReference
): JunctionEndpoint => {
  const fk = registry.getForeignKeys(table).find((f) => f.columns.includes(ref.column))
  if (!fk) {
    throw new Error(`junctionDeriver: no FK on '${table}' for column '${ref.column}' (ref → ${ref.referencedDomain})`)
  }
  // Stage-4 pure-junction endpoints are all root tables (agent, agent_global_skill, mcp_server,
  // agent_channel, job_schedule). Member-table endpoints (message/painting via file_ref) belong
  // to include-member junctions, excluded by the caller.
  return { table: fk.targetTable, fkColumn: ref.column, aggregatePath: 'root' }
}

/**
 * Derive the pure-junction descriptors for the global junction phase. Pure: reads the registry
 * only, no DB access. Excludes include-member tables (already cascaded) and tables with < 2
 * junction refs. Source/target endpoints come from explicit `junctionRole` (finalize #27).
 */
export const deriveJunctionDescriptors = (
  registry: ReadonlyBackupRegistry,
  selectedDomains: readonly BackupDomain[]
): JunctionDescriptor[] => {
  // Include-member tables across selected domains — excluded (already imported via cascade).
  const memberTables = new Set<DbTableName>()
  for (const d of selectedDomains) {
    for (const agg of registry.getAggregatesForDomain(d)) {
      for (const m of agg.members ?? []) {
        if (m.cascade === 'include') memberTables.add(m.table)
      }
    }
  }

  // Group junction refs by their declaring table.
  const refsByTable = new Map<DbTableName, EntityReference[]>()
  for (const d of selectedDomains) {
    for (const ref of registry.getReferencesForDomain(d)) {
      if (ref.kind !== 'junction') continue
      let bucket = refsByTable.get(ref.table)
      if (!bucket) {
        bucket = []
        refsByTable.set(ref.table, bucket)
      }
      bucket.push(ref)
    }
  }

  const out: JunctionDescriptor[] = []
  for (const [table, refs] of refsByTable) {
    if (memberTables.has(table) || refs.length < 2) continue
    const ownerDomain = registry.getTableOwner(table)
    if (ownerDomain === 'excluded' || ownerDomain === 'infrastructure') continue

    const sourceRef = refs.find((r) => r.junctionRole === 'source')
    const targetRef = refs.find((r) => r.junctionRole === 'target')
    if (!sourceRef || !targetRef) {
      // finalize #27a should have caught this; reaching here is a contributor bug.
      throw new Error(
        `junctionDeriver: junction-phase table '${table}' missing junctionRole source/target ` +
          `(source=${sourceRef?.column ?? '∅'} target=${targetRef?.column ?? '∅'})`
      )
    }

    out.push({
      table,
      ownerDomain,
      sourceEndpoint: resolveEndpoint(registry, table, sourceRef),
      targetEndpoint: resolveEndpoint(registry, table, targetRef)
    })
  }
  return out
}
