import i18n from 'i18next'

import type { ConversationListSort } from '@shared/data/types/conversationList'
import { defaultLanguage } from '@shared/utils/languages'
import { createNameComparator } from '@shared/utils/nameOrdering'

export function getConversationListSortLocale() {
  return i18n.resolvedLanguage ?? defaultLanguage
}

export function conversationListSortQuery(sort: ConversationListSort, locale = getConversationListSortLocale()) {
  return {
    sortBy: sort.by,
    sortOrder: sort.by === 'orderKey' ? ('asc' as const) : sort.direction,
    ...(sort.by === 'name' ? { sortLocale: locale } : {})
  }
}

export function compareConversationListItems<
  T extends { id: string; name?: string; orderKey?: string; createdAt: string; lastActivityAt: string }
>(sort: ConversationListSort, locale = getConversationListSortLocale()): (a: T, b: T) => number {
  if (sort.by === 'name') return createNameComparator(locale, sort.direction)
  if (sort.by === 'orderKey') {
    return (a, b) => ((a.orderKey ?? '') < (b.orderKey ?? '') ? -1 : (a.orderKey ?? '') > (b.orderKey ?? '') ? 1 : 0)
  }
  const { by, direction } = sort
  return (a, b) => {
    const compared = Date.parse(a[by]) - Date.parse(b[by])
    return direction === 'asc' ? compared : -compared
  }
}
