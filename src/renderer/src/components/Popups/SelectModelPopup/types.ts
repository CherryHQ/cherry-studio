import { Model } from '@renderer/types'
import { ReactNode } from 'react'

// 列表项类型，组名也作为列表项
export type ListItemType = 'group' | 'model'

// 滚动触发来源类型
export type ScrollTrigger = 'initial' | 'search' | 'keyboard' | 'none'

// 扁平化列表项接口
export interface FlatListItem {
  key: string
  type: ListItemType
  icon?: ReactNode
  name: ReactNode
  tags?: ReactNode
  model?: Model
  isPinned?: boolean
  isSelected?: boolean
}

// 滚动和焦点相关的状态类型
export interface ScrollState {
  focusedItemKey: string
  scrollTrigger: ScrollTrigger
  lastScrollOffset: number
  stickyGroup: FlatListItem | null
  isMouseOver: boolean
}

// 滚动和焦点相关的 action 类型
export type ScrollAction =
  | { type: 'SET_FOCUSED_ITEM_KEY'; payload: string }
  | { type: 'SET_SCROLL_TRIGGER'; payload: ScrollTrigger }
  | { type: 'SET_LAST_SCROLL_OFFSET'; payload: number }
  | { type: 'SET_STICKY_GROUP'; payload: FlatListItem | null }
  | { type: 'SET_IS_MOUSE_OVER'; payload: boolean }
  | { type: 'FOCUS_NEXT_ITEM'; payload: { modelItems: FlatListItem[]; step: number } }
  | { type: 'FOCUS_PAGE'; payload: { modelItems: FlatListItem[]; currentIndex: number; step: number } }
  | { type: 'SEARCH_CHANGED'; payload: { searchText: string } }
  | { type: 'FOCUS_ON_LIST_CHANGE'; payload: { modelItems: FlatListItem[] } }
