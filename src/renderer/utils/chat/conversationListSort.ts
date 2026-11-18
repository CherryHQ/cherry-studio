import type { ConversationListSort } from '@shared/data/types/conversationList'

function compareNames(left: string, right: string) {
  // SQLite's binary name order follows Unicode code points, not UTF-16 code units.
  const a = Array.from(left, (character) => character.codePointAt(0) ?? 0)
  const b = Array.from(right, (character) => character.codePointAt(0) ?? 0)
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return a.length - b.length
}

export function conversationListSortQuery(sort: ConversationListSort) {
  return { sortBy: sort.by, sortOrder: sort.by === 'orderKey' ? ('asc' as const) : sort.direction }
}

export function compareConversationListItems<
  T extends { name?: string; orderKey?: string; createdAt: string; lastActivityAt: string }
>(sort: ConversationListSort): (a: T, b: T) => number {
  return (a, b) => {
    if (sort.by === 'orderKey') {
      return (a.orderKey ?? '') < (b.orderKey ?? '') ? -1 : (a.orderKey ?? '') > (b.orderKey ?? '') ? 1 : 0
    }
    const compared =
      sort.by === 'name' ? compareNames(a.name ?? '', b.name ?? '') : Date.parse(a[sort.by]) - Date.parse(b[sort.by])
    return sort.direction === 'asc' ? compared : -compared
  }
}
