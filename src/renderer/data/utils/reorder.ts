/**
 * @fileoverview Pure helpers for optimistic reorder flows.
 *
 * Backs the renderer-side `useReorder` hook with two SWR/DOM-free functions:
 *
 * - {@link reorderLocally}    — apply a single anchor move to a list clone.
 * - {@link computeMinimalMoves} — diff two list orderings via LIS and emit
 *   the minimum set of anchor-based moves to transform one into the other.
 *
 * Both functions are pure: inputs are never mutated and no external services
 * are touched. They are consumed by the renderer optimistic-update layer and
 * by tests that verify round-trip correctness.
 *
 * Identity field:
 * Both helpers identify items by a string-valued field. By default they read
 * `item.id`. Callers whose primary key is exposed under a different name
 * (e.g. miniapp's `appId`) pass `idKey: 'appId'` as the final argument — the
 * argument flows through from `useReorder`'s `idKey` option and stays
 * consistent across `reorderLocally` and `computeMinimalMoves`.
 */

import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'

const DEFAULT_ID_KEY = 'id' as const

function readItemId<T extends Record<string, unknown>>(item: T, idKey: string): string {
  const value = item[idKey]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`reorder utils: item is missing a non-empty string at idKey="${idKey}"`)
  }
  return value
}

/**
 * Returns a new array with the item whose identity (by `idKey`, default `'id'`)
 * equals `id` moved to the slot described by `anchor`. The input array is not
 * mutated.
 *
 * Throws when:
 * - the target id is not present
 * - the anchor id (`before`/`after`) is not present
 * - the anchor id equals the target id (self-reference)
 * - any item is missing a string value at the `idKey` field
 */
export function reorderLocally<T extends Record<string, unknown>>(
  items: T[],
  id: string,
  anchor: OrderRequest,
  idKey: string = DEFAULT_ID_KEY
): T[] {
  const fromIndex = items.findIndex((item) => readItemId(item, idKey) === id)
  if (fromIndex === -1) {
    throw new Error(`reorderLocally: target id "${id}" not found in list`)
  }

  // Splice the target out first so `anchor` indices are resolved against the
  // remaining items — this makes "move X before Y" semantics unambiguous when
  // Y currently sits adjacent to X.
  const next = items.slice()
  const [target] = next.splice(fromIndex, 1)

  let insertIndex: number
  if ('position' in anchor) {
    insertIndex = anchor.position === 'first' ? 0 : next.length
  } else if ('before' in anchor) {
    if (anchor.before === id) {
      throw new Error(`reorderLocally: cannot anchor item "${id}" before itself`)
    }
    const anchorIndex = next.findIndex((item) => readItemId(item, idKey) === anchor.before)
    if (anchorIndex === -1) {
      throw new Error(`reorderLocally: anchor id "${anchor.before}" not found (moving "${id}")`)
    }
    insertIndex = anchorIndex
  } else {
    if (anchor.after === id) {
      throw new Error(`reorderLocally: cannot anchor item "${id}" after itself`)
    }
    const anchorIndex = next.findIndex((item) => readItemId(item, idKey) === anchor.after)
    if (anchorIndex === -1) {
      throw new Error(`reorderLocally: anchor id "${anchor.after}" not found (moving "${id}")`)
    }
    insertIndex = anchorIndex + 1
  }

  next.splice(insertIndex, 0, target)
  return next
}

/**
 * Computes the minimum set of anchor-based moves required to transform
 * `currentList` into `newList`. Items are identified by the `idKey` field
 * (default `'id'`) — the same field must be used for both lists.
 *
 * Requires that `newList` is a permutation of `currentList` (same id set).
 * Throws otherwise.
 *
 * Strategy:
 * 1. Map each id in `newList` to its index in `currentList`.
 * 2. Find a Longest Increasing Subsequence (LIS) over those indices —
 *    items in the LIS are already in a relatively correct order and can
 *    stay put.
 * 3. Every other item needs exactly one move; anchor it on its predecessor
 *    in `newList` (or `position: 'first'` if it lands at index 0).
 *
 * Moves are emitted in ascending new-position order so that a server
 * applying them sequentially always finds the anchor already in place.
 */
export function computeMinimalMoves<T extends Record<string, unknown>>(
  currentList: T[],
  newList: T[],
  idKey: string = DEFAULT_ID_KEY
): Array<{ id: string; anchor: OrderRequest }> {
  if (currentList.length !== newList.length) {
    throw new Error(
      `computeMinimalMoves: newList is not a permutation of currentList (length ${newList.length} vs ${currentList.length})`
    )
  }

  if (currentList.length === 0) {
    return []
  }

  const currentIndexById = new Map<string, number>()
  for (let i = 0; i < currentList.length; i++) {
    currentIndexById.set(readItemId(currentList[i], idKey), i)
  }

  // Build the permutation array: position in newList -> index in currentList.
  // Simultaneously validate that every id in newList exists in currentList.
  const perm: number[] = new Array(newList.length)
  for (let i = 0; i < newList.length; i++) {
    const newId = readItemId(newList[i], idKey)
    const idx = currentIndexById.get(newId)
    if (idx === undefined) {
      throw new Error(`computeMinimalMoves: newList id "${newId}" does not exist in currentList (not a permutation)`)
    }
    perm[i] = idx
  }

  // Detect duplicates / missing ids: a valid permutation has every current
  // index represented exactly once. Summing uniques via Set is sufficient
  // because we already verified length equality above.
  if (new Set(perm).size !== perm.length) {
    throw new Error('computeMinimalMoves: newList is not a permutation of currentList (duplicate ids)')
  }

  // Fast path: identity permutation => no moves.
  let isIdentity = true
  for (let i = 0; i < perm.length; i++) {
    if (perm[i] !== i) {
      isIdentity = false
      break
    }
  }
  if (isIdentity) {
    return []
  }

  const lisIndexSet = longestIncreasingSubsequenceIndices(perm)

  const moves: Array<{ id: string; anchor: OrderRequest }> = []
  for (let i = 0; i < newList.length; i++) {
    if (lisIndexSet.has(i)) continue
    const id = readItemId(newList[i], idKey)
    if (i === 0) {
      moves.push({ id, anchor: { position: 'first' } })
    } else {
      moves.push({ id, anchor: { after: readItemId(newList[i - 1], idKey) } })
    }
  }

  return moves
}

/**
 * Standard O(n log n) patience-sort LIS that returns the set of input
 * indices belonging to one valid longest increasing subsequence.
 *
 * Any LIS yields a correct minimal-move result, so tie-breaking is
 * irrelevant to callers.
 */
function longestIncreasingSubsequenceIndices(values: number[]): Set<number> {
  const n = values.length
  if (n === 0) return new Set()

  // `tailIndices[k]` = index in `values` of the smallest possible tail of
  // an increasing subsequence of length k+1 seen so far.
  const tailIndices: number[] = []
  // `prev[i]` = predecessor index of `i` in the LIS, for reconstruction.
  const prev: Array<number | -1> = new Array(n).fill(-1)

  for (let i = 0; i < n; i++) {
    const v = values[i]

    // Binary search for the first tail whose value is >= v.
    let lo = 0
    let hi = tailIndices.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (values[tailIndices[mid]] < v) {
        lo = mid + 1
      } else {
        hi = mid
      }
    }

    if (lo > 0) {
      prev[i] = tailIndices[lo - 1]
    }
    if (lo === tailIndices.length) {
      tailIndices.push(i)
    } else {
      tailIndices[lo] = i
    }
  }

  // Reconstruct LIS by walking back from the last tail.
  const result = new Set<number>()
  let cursor: number = tailIndices[tailIndices.length - 1]
  while (cursor !== -1) {
    result.add(cursor)
    cursor = prev[cursor]
  }
  return result
}
