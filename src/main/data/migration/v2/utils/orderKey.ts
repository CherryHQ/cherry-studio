/**
 * Migrator-layer pure helpers for stamping `orderKey` onto rows being inserted
 * during the v2 Redux/Dexie -> SQLite one-shot migration.
 *
 * Relationship to `@data/services/utils/orderKey`:
 *
 * | Dimension   | services/utils/orderKey.ts      | migration/v2/utils/orderKey.ts (this file) |
 * | ----------- | ------------------------------- | ------------------------------------------ |
 * | Runtime     | DataApi runtime (user actions)  | One-shot migration (v2 upgrade)            |
 * | Touches DB? | Yes (tx param)                  | No -- pure functions                       |
 * | Input       | Table + anchor/values           | Already-flattened JS arrays                |
 * | Output      | DB writes + returned row        | New array with `orderKey` attached         |
 *
 * Import rule: the shared low-level primitive `generateOrderKeySequence` must
 * be imported from `@data/services/utils/orderKey`. Importing
 * `fractional-indexing` directly from this file is forbidden -- the service
 * module is the sole import site for that package.
 */

import { generateOrderKeySequence } from '@data/services/utils/orderKey'

/**
 * Assign fractional-indexing `orderKey` values to a list of rows in the given
 * order. Returns a new array; the input is not mutated.
 */
export function assignOrderKeysInSequence<T>(rows: T[]): Array<T & { orderKey: string }> {
  if (rows.length === 0) return []
  const keys = generateOrderKeySequence(rows.length)
  return rows.map((row, i) => ({ ...row, orderKey: keys[i] }))
}

/**
 * Bucket rows by scope and assign `orderKey` values within each bucket using
 * an independent key space. The input order is preserved in the output;
 * within a single scope, keys are strictly increasing.
 */
export function assignOrderKeysByScope<T, S>(rows: T[], getScope: (row: T) => S): Array<T & { orderKey: string }> {
  if (rows.length === 0) return []

  // Collect per-scope indices in input order.
  const indicesByScope = new Map<S, number[]>()
  for (let i = 0; i < rows.length; i++) {
    const scope = getScope(rows[i])
    const bucket = indicesByScope.get(scope)
    if (bucket) {
      bucket.push(i)
    } else {
      indicesByScope.set(scope, [i])
    }
  }

  // Generate keys per bucket and splice them back in original order.
  const result: Array<T & { orderKey: string }> = new Array(rows.length)
  for (const [, indices] of indicesByScope) {
    const keys = generateOrderKeySequence(indices.length)
    for (let k = 0; k < indices.length; k++) {
      const originalIndex = indices[k]
      result[originalIndex] = { ...rows[originalIndex], orderKey: keys[k] }
    }
  }
  return result
}
