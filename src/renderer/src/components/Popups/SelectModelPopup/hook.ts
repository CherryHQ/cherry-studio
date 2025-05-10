import { useMemo, useReducer } from 'react'

import { initialScrollState, scrollReducer } from './reducer'
import { FlatListItem, ScrollTrigger } from './types'

/**
 * 管理滚动和焦点状态的 hook
 */
export function useScrollState() {
  const [state, dispatch] = useReducer(scrollReducer, initialScrollState)

  const actions = useMemo(
    () => ({
      setFocusedItemKey: (key: string) => dispatch({ type: 'SET_FOCUSED_ITEM_KEY', payload: key }),
      setScrollTrigger: (trigger: ScrollTrigger) => dispatch({ type: 'SET_SCROLL_TRIGGER', payload: trigger }),
      setLastScrollOffset: (offset: number) => dispatch({ type: 'SET_LAST_SCROLL_OFFSET', payload: offset }),
      setStickyGroup: (group: FlatListItem | null) => dispatch({ type: 'SET_STICKY_GROUP', payload: group }),
      setIsMouseOver: (isMouseOver: boolean) => dispatch({ type: 'SET_IS_MOUSE_OVER', payload: isMouseOver }),
      focusNextItem: (modelItems: FlatListItem[], step: number) =>
        dispatch({ type: 'FOCUS_NEXT_ITEM', payload: { modelItems, step } }),
      focusPage: (modelItems: FlatListItem[], currentIndex: number, step: number) =>
        dispatch({ type: 'FOCUS_PAGE', payload: { modelItems, currentIndex, step } }),
      searchChanged: (searchText: string) => dispatch({ type: 'SEARCH_CHANGED', payload: { searchText } }),
      updateOnListChange: (modelItems: FlatListItem[]) =>
        dispatch({ type: 'UPDATE_ON_LIST_CHANGE', payload: { modelItems } }),
      initScroll: () => dispatch({ type: 'INIT_SCROLL' })
    }),
    []
  )

  return {
    // 状态
    focusedItemKey: state.focusedItemKey,
    scrollTrigger: state.scrollTrigger,
    lastScrollOffset: state.lastScrollOffset,
    stickyGroup: state.stickyGroup,
    isMouseOver: state.isMouseOver,
    // 操作
    ...actions
  }
}
