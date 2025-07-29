import React from 'react'

export type QuickPanelCloseAction = 'enter' | 'click' | 'esc' | 'outsideclick' | 'enter_empty' | string | undefined
export type QuickPanelCallBackOptions = {
  symbol: string
  action: QuickPanelCloseAction
  item: QuickPanelListItem
  searchText?: string
  /** 是否处于多选状态 */
  multiple?: boolean
}

export type QuickPanelOpenOptions = {
  /** 显示在底部左边，类似于Placeholder */
  title?: string
  /** default: [] */
  list: QuickPanelListItem[]
  /** default: 0 */
  defaultIndex?: number
  /** default: 7 */
  pageSize?: number
  /** 是否支持按住cmd/ctrl键多选，default: false */
  multiple?: boolean
  /**
   * 用于标识是哪个快捷面板，不是用于触发显示
   * 可以是/@#符号，也可以是其他字符串
   */
  symbol: string
  beforeAction?: (options: QuickPanelCallBackOptions) => void
  afterAction?: (options: QuickPanelCallBackOptions) => void
  onClose?: (options: QuickPanelCallBackOptions) => void
}

export type QuickPanelListItem = {
  label: React.ReactNode | string
  description?: React.ReactNode | string
  /**
   * 由于title跟description可能是ReactNode，
   * 所以需要单独提供一个用于搜索过滤的文本,
   * 这个filterText可以是title跟description的字符串组合
   */
  filterText?: string
  icon: React.ReactNode | string
  suffix?: React.ReactNode | string
  isSelected?: boolean
  isMenu?: boolean
  disabled?: boolean
  action?: (options: QuickPanelCallBackOptions) => void
}

// 定义上下文类型
export interface QuickPanelContextType {
  readonly open: (options: QuickPanelOpenOptions) => void
  readonly close: (action?: QuickPanelCloseAction) => void
  readonly updateItemSelection: (targetItem: QuickPanelListItem, isSelected: boolean) => void
  readonly isVisible: boolean
  readonly symbol: string
  readonly list: QuickPanelListItem[]
  readonly title?: string
  readonly defaultIndex: number
  readonly pageSize: number
  readonly multiple: boolean

  readonly onClose?: (Options: QuickPanelCallBackOptions) => void
  readonly beforeAction?: (Options: QuickPanelCallBackOptions) => void
  readonly afterAction?: (Options: QuickPanelCallBackOptions) => void
}

export type QuickPanelScrollTrigger = 'initial' | 'keyboard' | 'none'
