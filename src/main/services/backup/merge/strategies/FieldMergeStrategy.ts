import type { FieldMergePolicy } from '@main/data/db/backup/contributorTypes'

/** A physical SQLite row returned by the raw backup/work database queries. */
type MergeRow = Readonly<Record<string, unknown>>

/** A physical field policy after the engine converts contributor camelCase names for raw SQL. */
export interface FieldMergeColumnPolicy {
  readonly column: string
  readonly strategy: FieldMergePolicy['strategy']
}

/** Input required to apply contributor-owned field policies without mutating either row. */
export interface FieldMergeInput {
  readonly localRow: MergeRow
  readonly remoteRow: MergeRow
  readonly policies: readonly FieldMergeColumnPolicy[]
  /** Primary and identity columns always retain the local canonical value. */
  readonly protectedColumns: ReadonlySet<string>
}

/** A declared JSON merge policy received a value that cannot safely be merged. */
export class FieldMergeStrategyError extends Error {
  constructor(column: string, detail: string) {
    super(`field merge failed for '${column}': ${detail}`)
    this.name = 'FieldMergeStrategyError'
  }
}

/** True when a value is a plain JSON object rather than an array or scalar. */
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Parse a JSON object column and fail closed when a declared deep merge is unsafe. */
const parseJsonObject = (column: string, value: unknown): Readonly<Record<string, unknown>> => {
  if (isRecord(value)) return value
  if (typeof value !== 'string') {
    throw new FieldMergeStrategyError(column, 'expected a JSON object')
  }

  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed)) {
      throw new FieldMergeStrategyError(column, 'expected a JSON object')
    }
    return parsed
  } catch (error) {
    if (error instanceof FieldMergeStrategyError) throw error
    throw new FieldMergeStrategyError(column, 'contains invalid JSON')
  }
}

/** Recursively merge remote object defaults with local leaf values taking precedence. */
const mergeJsonObjects = (
  remote: Readonly<Record<string, unknown>>,
  local: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> => {
  const merged: Record<string, unknown> = { ...remote }
  for (const [key, localValue] of Object.entries(local)) {
    const remoteValue = remote[key]
    merged[key] = isRecord(remoteValue) && isRecord(localValue) ? mergeJsonObjects(remoteValue, localValue) : localValue
  }
  return merged
}

/** Detect the preset auth object that has a type but no usable credentials. */
const isAuthSkeleton = (value: Readonly<Record<string, unknown>>): boolean => {
  if (typeof value.type !== 'string') return false
  const credentialKeys = Object.keys(value).filter((key) => !['type', 'required', 'headerName', 'prefix'].includes(key))
  return credentialKeys.every((key) => isEmptyValue(value[key]))
}

/** Determine whether a local value is absent, an empty JSON container, or an auth skeleton. */
const isEmptyValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') {
    if (value.trim() === '') return true
    try {
      return isEmptyValue(JSON.parse(value) as unknown)
    } catch {
      return false
    }
  }
  if (Array.isArray(value)) return value.length === 0
  if (isRecord(value)) return Object.keys(value).length === 0 || isAuthSkeleton(value)
  return false
}

/** Apply field policies while preserving the local canonical primary and identity keys. */
export class FieldMergeStrategy {
  merge({ localRow, remoteRow, policies, protectedColumns }: FieldMergeInput): Readonly<Record<string, unknown>> {
    const merged: Record<string, unknown> = { ...localRow }

    for (const { column, strategy } of policies) {
      if (protectedColumns.has(column)) continue
      const localValue = localRow[column]
      const remoteValue = remoteRow[column]
      if (remoteValue === undefined) continue

      switch (strategy) {
        case 'remote-fills-local-null':
          if (localValue === null || localValue === undefined) merged[column] = remoteValue
          break
        case 'remote-fills-local-empty':
          if (isEmptyValue(localValue)) merged[column] = remoteValue
          break
        case 'deep-merge':
          if (localValue === null || localValue === undefined) {
            if (remoteValue !== null && remoteValue !== undefined) {
              // Validate and normalize remote JSON even when it wholly backfills local state.
              merged[column] = JSON.stringify(parseJsonObject(column, remoteValue))
            }
          } else if (remoteValue !== null && remoteValue !== undefined) {
            const remoteObject = parseJsonObject(column, remoteValue)
            const localObject = parseJsonObject(column, localValue)
            merged[column] = JSON.stringify(mergeJsonObjects(remoteObject, localObject))
          }
          break
        case 'local-priority':
          if (isEmptyValue(localValue)) merged[column] = remoteValue
          break
      }
    }

    return merged
  }
}
