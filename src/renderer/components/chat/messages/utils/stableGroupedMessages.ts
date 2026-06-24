/**
 * Structural-sharing variant of `Object.entries(groupMessageListItems(messages))`.
 *
 * `groupMessageListItems` returns a fresh object every call, and `Object.entries`
 * always allocates a fresh outer array. The result is that downstream
 * `React.memo(MessageGroup)`'s shallow-compare on `messages` (the per-group
 * slice) busts every render — even when nothing about that group changed.
 *
 * This helper memoizes the per-key inner arrays: when the next render produces
 * a group whose contents are element-wise identical to the previous render's
 * group of the same key, the previous array reference is reused. The outer
 * tuple list is also reused if no group changed (covers the common
 * "composer state flipped, list didn't" path).
 *
 * Designed to be paired with `useMemo` at the call site so the helper is
 * cheap to invoke each render — it does at most one walk over the input
 * groups plus element-wise comparisons.
 */

import type { MessageListItem } from '../types'
import { groupMessageListItems } from './messageGroupKey'

type GroupedEntry = [string, MessageListItem[]]

function arraysShallowEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function entriesShallowEqual(a: readonly GroupedEntry[], b: readonly GroupedEntry[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const [ak, av] = a[i]
    const [bk, bv] = b[i]
    if (ak !== bk) return false
    if (av !== bv) return false
  }
  return true
}

export interface StableGroupedMessagesCache {
  prevEntries: GroupedEntry[]
  prevByKey: Map<string, MessageListItem[]>
}

export function createStableGroupedMessagesCache(): StableGroupedMessagesCache {
  return { prevEntries: [], prevByKey: new Map() }
}

export function stableGroupedMessages(
  messages: readonly MessageListItem[],
  cache: StableGroupedMessagesCache
): GroupedEntry[] {
  // groupMessageListItems expects a mutable array; the cache helper does not
  // mutate it, but the underlying signature is typed that way, hence the cast.
  const grouped = groupMessageListItems(messages as MessageListItem[])
  const nextEntries: GroupedEntry[] = []
  const nextByKey = new Map<string, MessageListItem[]>()

  for (const key of Object.keys(grouped)) {
    const candidate = grouped[key]
    const prev = cache.prevByKey.get(key)
    const adopted = prev && arraysShallowEqual(prev, candidate) ? prev : candidate
    nextEntries.push([key, adopted])
    nextByKey.set(key, adopted)
  }

  cache.prevByKey = nextByKey

  if (entriesShallowEqual(cache.prevEntries, nextEntries)) {
    return cache.prevEntries
  }
  cache.prevEntries = nextEntries
  return nextEntries
}
