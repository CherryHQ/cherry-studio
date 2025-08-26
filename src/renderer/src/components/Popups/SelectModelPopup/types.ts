import { Model } from '@renderer/types'
import { ReactNode } from 'react'

// 列表项类型，组名也作为列表项
export type ListItemType = 'group' | 'model'

// 滚动触发来源类型
export type ScrollTrigger = 'initial' | 'search' | 'keyboard' | 'none'

// 扁平化列表项
export type FlatListBaseItem = {
  key: string
  type: ListItemType
  name: ReactNode
  icon?: ReactNode
  isSelected?: boolean
}

export type FlatListGroup = FlatListBaseItem & {
  type: 'group'
  actions?: ReactNode
}

export type FlatListModel = FlatListBaseItem & {
  type: 'model'
  model: Model
  tags?: ReactNode
  isPinned?: boolean
}

export type FlatListItem = FlatListGroup | FlatListModel
