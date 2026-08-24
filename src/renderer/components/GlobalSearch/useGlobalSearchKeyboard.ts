import { useCallback, useEffect, useMemo, useState } from 'react'

import type {
  GlobalMessageSearchPanelGroup,
  GlobalMessageSearchPanelItem,
  GlobalSearchPanelGroup,
  GlobalSearchPanelGroupFooter,
  GlobalSearchPanelItem
} from './globalSearchGroups'
import type { GlobalSearchPanelMode } from './useGlobalSearchPanelData'

export type GlobalSearchFooterPanelItem = {
  kind: 'footer'
  id: string
  footer: GlobalSearchPanelGroupFooter
}
export type GlobalSearchKeyboardItem =
  | Exclude<GlobalSearchPanelItem, { kind: 'message-parent' }>
  | GlobalSearchFooterPanelItem

export function getGlobalSearchFooterItemId(
  groupId: GlobalSearchPanelGroup['id'],
  footer: GlobalSearchPanelGroupFooter
) {
  return `footer:${groupId}:${footer.kind}`
}

export const GLOBAL_MESSAGE_SEARCH_LOAD_MORE_ITEM_ID = 'message-search:load-more'

export type GlobalMessageSearchLoadMoreItem = {
  kind: 'message-load-more'
  id: typeof GLOBAL_MESSAGE_SEARCH_LOAD_MORE_ITEM_ID
}
export type GlobalMessageSearchKeyboardItem = GlobalMessageSearchPanelItem | GlobalMessageSearchLoadMoreItem

/** Stable DOM id for a listbox option, so the search input can reference it via `aria-activedescendant`. */
export function getGlobalSearchOptionDomId(itemId: string) {
  return `global-search-option-${encodeURIComponent(itemId)}`
}

export function useGlobalSearchKeyboard({
  groups,
  hasMoreMessageResults,
  isMessageSearchMode,
  messageGroups,
  panelMode
}: {
  groups: readonly GlobalSearchPanelGroup[]
  hasMoreMessageResults: boolean
  isMessageSearchMode: boolean
  messageGroups: readonly GlobalMessageSearchPanelGroup[]
  panelMode: GlobalSearchPanelMode
}) {
  const [activeItemId, setActiveItemId] = useState<string | undefined>()
  const selectableItems = useMemo<GlobalSearchKeyboardItem[]>(() => {
    if (panelMode !== 'search') return []
    return groups.flatMap((group) => [
      ...group.items.filter((item) => item.kind !== 'message-parent'),
      ...(group.footer
        ? [
            {
              kind: 'footer' as const,
              id: getGlobalSearchFooterItemId(group.id, group.footer),
              footer: group.footer
            }
          ]
        : [])
    ])
  }, [groups, panelMode])
  const messageSelectableItems = useMemo(() => messageGroups.flatMap((group) => group.items), [messageGroups])
  const messageKeyboardItems = useMemo<GlobalMessageSearchKeyboardItem[]>(
    () =>
      hasMoreMessageResults
        ? [...messageSelectableItems, { kind: 'message-load-more', id: GLOBAL_MESSAGE_SEARCH_LOAD_MORE_ITEM_ID }]
        : messageSelectableItems,
    [hasMoreMessageResults, messageSelectableItems]
  )
  const keyboardItems = isMessageSearchMode ? messageKeyboardItems : selectableItems

  useEffect(() => {
    if (keyboardItems.length === 0) {
      setActiveItemId(undefined)
      return
    }

    setActiveItemId((current) =>
      current && keyboardItems.some((item) => item.id === current) ? current : keyboardItems[0].id
    )
  }, [keyboardItems])

  const moveActiveItem = useCallback(
    (direction: 1 | -1) => {
      if (keyboardItems.length === 0) return

      const currentIndex = Math.max(
        0,
        keyboardItems.findIndex((item) => item.id === activeItemId)
      )
      const nextIndex = (currentIndex + direction + keyboardItems.length) % keyboardItems.length
      setActiveItemId(keyboardItems[nextIndex].id)
    },
    [activeItemId, keyboardItems]
  )

  return {
    activeItemId,
    keyboardItems,
    messageSelectableItems,
    moveActiveItem,
    selectableItems,
    setActiveItemId
  }
}
