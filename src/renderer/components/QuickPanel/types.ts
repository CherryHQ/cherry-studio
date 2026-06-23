import React from 'react'

export type QuickPanelCloseAction = 'enter' | 'click' | 'esc' | 'outsideclick' | 'enter_empty' | string | undefined
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
  /** Displayed at the bottom left, similar to a placeholder. */
  title?: string
  /** default: [] */
  list: QuickPanelListItem[]
  /** default: 0 */
  defaultIndex?: number
  /** default: 7 */
  pageSize?: number
  /** Whether Cmd/Ctrl multi-select is supported, default: false. */
  multiple?: boolean
  /** Read-only panels display list content without row selection or action execution. */
  readOnly?: boolean
  /**
   * Identifies the quick panel, not used to trigger display.
   * Can be `/`, `#`, or another string.
   */
  symbol: string
  /** Trigger info describing how the panel was opened. */
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
   * Since title and description can be ReactNode values, provide separate text
   * for search filtering. This can combine the title and description strings.
   */
  filterText?: string
  icon: React.ReactNode | string
  suffix?: React.ReactNode | string
  isSelected?: boolean
  isMenu?: boolean
  disabled?: boolean
  hidden?: boolean
  /**
   * Pinned items do not participate in filtering and always appear at the top.
   * For example, a clear button can be alwaysVisible so it remains visible with
   * matches. Collapse checks still use only regular items, so the panel hides
   * when there are no matches.
   */
  alwaysVisible?: boolean
  action?: (options: QuickPanelCallBackOptions) => void
}

// Context type definition.
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
