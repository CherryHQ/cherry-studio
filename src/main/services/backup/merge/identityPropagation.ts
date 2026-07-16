import type { ReadonlyBackupRegistry } from '@main/data/db/backup/contributorTypes'
import type { DbColumnName, DbTableName } from '@main/data/db/backup/dbSchemaRefs'

import type { IdentityMap } from './types'

/** JSON values used when safely rewriting required workspace references. */
type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }

/** A required identity JSON reference is malformed and cannot be safely rewritten. */
export class IdentityPropagationError extends Error {
  constructor(table: DbTableName, column: string, detail: string) {
    super(`identity propagation failed for '${table}.${column}': ${detail}`)
    this.name = 'IdentityPropagationError'
  }
}

/** Convert a contributor logical column name into the physical SQLite column name. */
const physicalColumn = (logical: string): string => logical.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`)

/** Required JSON workspace references have a stable schema-owned location. */
const REQUIRED_WORKSPACE_JSON_COLUMNS: Partial<Record<DbTableName, { logical: DbColumnName; physical: string }>> = {
  agent_channel: { logical: 'workspace' as DbColumnName, physical: 'workspace' },
  job_schedule: { logical: 'jobInputTemplate' as DbColumnName, physical: 'job_input_template' }
}

/** Ensure a parsed JSON value has the object shape required by workspace references. */
const isJsonObject = (value: JsonValue): value is { readonly [key: string]: JsonValue } =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Parse a required JSON column while preserving a fail-closed detached merge. */
const parseRequiredJson = (table: DbTableName, column: string, value: unknown): JsonValue => {
  if (typeof value !== 'string') {
    throw new IdentityPropagationError(table, column, 'expected a JSON string')
  }

  try {
    const parsed: unknown = JSON.parse(value)
    if (!isJsonObject(parsed as JsonValue)) {
      throw new IdentityPropagationError(table, column, 'expected a JSON object')
    }
    return parsed as JsonValue
  } catch (error) {
    if (error instanceof IdentityPropagationError) throw error
    throw new IdentityPropagationError(table, column, 'contains invalid JSON')
  }
}

/** Recursively rewrite workspaceId values to their local canonical id, collecting any that cannot be resolved. */
const rewriteWorkspaceIds = (
  value: JsonValue,
  workspaceMap: ReadonlyMap<string, string>,
  unresolved: Set<string>
): JsonValue => {
  if (Array.isArray(value)) return value.map((item) => rewriteWorkspaceIds(item, workspaceMap, unresolved))
  if (!isJsonObject(value)) return value

  const rewritten: Record<string, JsonValue> = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === 'workspaceId' && typeof child === 'string') {
      // Required workspace references MUST resolve to a local canonical id.
      // An unresolved workspaceId would commit a dangling JSON soft-reference
      // (no SQL FK catches it), so collect it and let the caller fail closed.
      const canonical = workspaceMap.get(child)
      if (canonical === undefined) unresolved.add(child)
      rewritten[key] = canonical ?? child
      continue
    }
    rewritten[key] = rewriteWorkspaceIds(child, workspaceMap, unresolved)
  }
  return rewritten
}

/**
 * Rewrite scalar FK and required JSON references from backup identifiers to their
 * local canonical identities immediately before the row is inserted or updated.
 */
export const propagateIdentityReferences = (
  registry: Pick<ReadonlyBackupRegistry, 'getForeignKeys' | 'getJsonSoftReference'>,
  table: DbTableName,
  row: Readonly<Record<string, unknown>>,
  identityMap: IdentityMap
): Readonly<Record<string, unknown>> => {
  let propagated: Readonly<Record<string, unknown>> = row

  for (const fk of registry.getForeignKeys(table)) {
    if (fk.columns.length !== 1) continue
    const sourceColumn = physicalColumn(fk.columns[0])
    const sourceValue = row[sourceColumn]
    if (typeof sourceValue !== 'string' && typeof sourceValue !== 'number') continue
    const canonical = identityMap.targetMap.get(fk.targetTable)?.get(String(sourceValue))
    if (canonical === undefined || canonical === sourceValue) continue
    propagated = { ...propagated, [sourceColumn]: canonical }
  }

  const jsonColumn = REQUIRED_WORKSPACE_JSON_COLUMNS[table]
  if (!jsonColumn || registry.getJsonSoftReference(table, jsonColumn.logical)?.kind !== 'required') return propagated

  const workspaceMap = identityMap.targetMap.get('agent_workspace')
  const jsonValue = propagated[jsonColumn.physical]
  if (jsonValue === undefined) return propagated

  // Required workspace references fail closed: every workspaceId must resolve to
  // a local canonical id. A missing agent_workspace mapping means the referenced
  // workspace is neither imported nor pre-existing locally — any workspaceId in
  // the JSON is dangling, so abort the merge instead of committing it.
  const unresolved = new Set<string>()
  const rewritten = rewriteWorkspaceIds(
    parseRequiredJson(table, jsonColumn.physical, jsonValue),
    workspaceMap ?? new Map(),
    unresolved
  )
  if (unresolved.size > 0) {
    throw new IdentityPropagationError(
      table,
      jsonColumn.physical,
      `unresolved required workspaceId(s): ${[...unresolved].join(', ')} (no canonical mapping in agent_workspace)`
    )
  }
  const serialized = JSON.stringify(rewritten)
  if (serialized === jsonValue) return propagated
  return { ...propagated, [jsonColumn.physical]: serialized }
}
