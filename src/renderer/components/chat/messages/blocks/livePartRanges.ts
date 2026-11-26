import { concat, single, type Range } from '@renderer/utils/message/projectionRange'

export interface Runs<T extends { key: string }> {
  first: T
  middle?: Range<T>
  last?: T
}

// Only the two adjacent ends can form a new group. The interior retains its layout and React identity.
export function joinRuns<T extends { key: string }>(
  a: Runs<T> | undefined,
  b: Runs<T> | undefined,
  merge: (left: T, right: T) => T | undefined
): Runs<T> | undefined {
  if (!a || !b) return a ?? b
  const x = a.last ?? a.first
  const y = b.first
  const joined = merge(x, y)
  if (joined && !a.last && !b.last) return { first: joined }
  const middle = joined
    ? a.last && b.last && single(joined.key, joined)
    : concat(a.last && single(x.key, x), b.last && single(y.key, y))
  return {
    first: (!a.last && joined) || a.first,
    middle: concat(concat(a.middle, middle), b.middle),
    last: b.last ?? joined ?? y
  }
}
