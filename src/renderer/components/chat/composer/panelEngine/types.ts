import React from 'react'

// Named reasons keep autocomplete/typo-protection; `(string & {})` still allows custom
// reasons (e.g. 'input_prefix_invalid') without collapsing the union to bare `string`.
export type QuickPanelKnownCloseAction = 'enter' | 'click' | 'esc' | 'outsideclick' | 'enter_empty'
export type QuickPanelCloseAction = QuickPanelKnownCloseAction | (string & {}) | undefined
export type QuickPanelTriggerInfo = {
  type: 'input' | 'button'
  position?: number
  originalText?: string
}

export interface QuickPanelInputAdapter {
  getText: () => string
  getCursorOffset?: () => number
  insertText: (text: string) => void
  insertToken?: (token: unknown) => void
  deleteTriggerRange: (range: { from: number; to: number }) => void
  focus: () => void
  subscribeInput?: (listener: (event?: QuickPanelInputEvent) => void) => () => void
}

export interface QuickPanelInputEvent {
  isComposing?: boolean
  cause?: 'user-input' | 'state-sync'
}

export type QuickPanelCallBackOptions = {
  context: QuickPanelContextType
  action: QuickPanelCloseAction
  item: QuickPanelListItem
  parentPanel?: QuickPanelOpenOptions
  queryAnchor?: number
  searchText?: string
  inputAdapter?: QuickPanelInputAdapter
}

export type QuickPanelKeyDownEvent = KeyboardEvent | React.KeyboardEvent<HTMLElement>
export type QuickPanelKeyDownHandler = (event: QuickPanelKeyDownEvent) => boolean

/**
 * Filter function type
 * @param item - The item to check
 * @param searchText - The search text (without leading symbol)
 * @param fuzzyRegex - Fuzzy matching regex
 * @param pinyinCache - Cache for pinyin conversions
 * @returns true if item matches the search
 */
export type QuickPanelFilterFn = (
  item: QuickPanelListItem,
  searchText: string,
  fuzzyRegex: RegExp,
  pinyinCache: WeakMap<QuickPanelListItem, string>
) => boolean

/**
 * Sort function type
 * @param items - The filtered items to sort
 * @param searchText - The search text (without leading symbol)
 * @returns sorted items
 */
export type QuickPanelSortFn = (items: QuickPanelListItem[], searchText: string) => QuickPanelListItem[]

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
  /** Read-only panels display list content without row selection or action execution. */
  readOnly?: boolean
  /**
   * 用于标识是哪个快捷面板，不是用于触发显示
   * 可以是 /、# 符号，也可以是其他字符串
   */
  symbol: string
  /** 触发信息，记录面板是如何被打开的 */
  triggerInfo?: QuickPanelTriggerInfo
  /** Input text offset where the current composer-driven query starts. */
  queryAnchor?: number
  /** Whether this panel tracks and consumes an input trigger query such as `/foo` or `@file`. */
  trackInputQuery?: boolean
  beforeAction?: (options: QuickPanelCallBackOptions) => void
  afterAction?: (options: QuickPanelCallBackOptions) => void
  onClose?: (options: QuickPanelCallBackOptions) => void
  /** Panel to show when navigating back from this panel. */
  parentPanel?: QuickPanelOpenOptions
  /** Tool manages list + collapse behavior externally (skip filtering/auto-close) */
  manageListExternally?: boolean
  /** Custom filter function for items (follows open-closed principle) */
  filterFn?: QuickPanelFilterFn
  /** Custom sort function for filtered items (follows open-closed principle) */
  sortFn?: QuickPanelSortFn
}

export type QuickPanelListItem = {
  /** Stable identity for selection updates and DOM keys. */
  id?: string
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
  hidden?: boolean
  /**
   * 固定显示项：不参与过滤，始终出现在列表顶部。
   * 例如“清除”按钮可设置为 alwaysVisible，从而在有匹配项时始终可见；
   * 折叠判定依然仅依据非固定项数量，从而在无匹配时整体折叠隐藏。
   */
  alwaysVisible?: boolean
  action?: (options: QuickPanelCallBackOptions) => void
}

// 定义上下文类型
export interface QuickPanelContextType {
  readonly open: (options: QuickPanelOpenOptions) => void
  readonly close: (action?: QuickPanelCloseAction, searchText?: string) => void
  readonly updateItemSelection: (targetItem: QuickPanelListItem, isSelected: boolean) => void
  readonly updateList: (newList: QuickPanelListItem[]) => void
  readonly isVisible: boolean
  readonly symbol: string
  readonly list: QuickPanelListItem[]
  readonly title?: string
  readonly defaultIndex: number
  readonly pageSize: number
  readonly multiple: boolean
  readonly readOnly?: boolean
  readonly triggerInfo?: QuickPanelTriggerInfo
  readonly queryAnchor?: number
  readonly trackInputQuery?: boolean
  readonly parentPanel?: QuickPanelOpenOptions
  readonly manageListExternally?: boolean
  readonly lastCloseAction?: QuickPanelCloseAction
  readonly filterFn?: QuickPanelFilterFn
  readonly sortFn?: QuickPanelSortFn

  /** Ambient layout hint: when true, the panel fills the available height above the input (home placement). */
  readonly fillToAvailableHeight: boolean
  readonly setFillToAvailableHeight: (fill: boolean) => void

  readonly dispatchKeyDown: (event: QuickPanelKeyDownEvent) => boolean
  readonly getPanelGeneration: () => number
  readonly registerKeyDownHandler: (handler: QuickPanelKeyDownHandler | undefined) => () => void
  readonly onClose?: (Options: QuickPanelCallBackOptions) => void
  readonly beforeAction?: (Options: QuickPanelCallBackOptions) => void
  readonly afterAction?: (Options: QuickPanelCallBackOptions) => void
}

export type QuickPanelScrollTrigger = 'initial' | 'keyboard' | 'none'
