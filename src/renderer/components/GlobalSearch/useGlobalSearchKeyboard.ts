import { useCallback, useEffect, useMemo, useState } from 'react'

import type {
  GlobalMessageSearchPanelGroup,
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

export function useGlobalSearchKeyboard({
  groups,
  isMessageSearchMode,
  messageGroups,
  panelMode
}: {
  groups: readonly GlobalSearchPanelGroup[]
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
  const keyboardItems = isMessageSearchMode ? messageSelectableItems : selectableItems

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
