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
