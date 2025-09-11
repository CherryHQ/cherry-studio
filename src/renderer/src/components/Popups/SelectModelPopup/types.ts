import { Model } from '@renderer/types'
import { ReactNode } from 'react'

/**
 * 滚动触发来源类型
 */
export type ScrollTrigger = 'initial' | 'search' | 'keyboard' | 'none'

/**
 * 列表项分类，组名也作为列表项
 */
export type ListItemType = 'group' | 'model'

/**
 * 扁平化列表项基础类型
 */
export type FlatListBaseItem = {
  key: string
  type: ListItemType
  name: ReactNode
  icon?: ReactNode
  isSelected?: boolean
}

/**
 * 模型分组列表项
 */
export type FlatListGroup = FlatListBaseItem & {
  type: 'group'
  actions?: ReactNode
}

/**
 * 模型列表项
 */
export type FlatListModel = FlatListBaseItem & {
  type: 'model'
  model: Model
  tags?: ReactNode
  isPinned?: boolean
}

/**
 * 扁平化列表项
 */
export type FlatListItem = FlatListGroup | FlatListModel
