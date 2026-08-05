import { DynamicVirtualList, type DynamicVirtualListRef } from '@renderer/components/VirtualList'
import { isMac } from '@renderer/utils/platform'
import { classNames } from '@renderer/utils/style'
import { t } from 'i18next'
import React, { use, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { defaultFilterFn, defaultSortFn } from './defaultStrategies'
import {
  getQuickPanelBodyVerticalSpace,
  getQuickPanelHeights,
  QUICK_PANEL_ITEM_HEIGHT,
  QUICK_PANEL_SAFE_MARGIN
} from './heights'
import {
  firstQuickPanelSelectableIndex,
  moveQuickPanelSelectableIndex,
  QuickPanelFooter,
  QuickPanelReadOnlyHeader,
  QuickPanelRow
} from './list'
import { QuickPanelContext } from './QuickPanelProvider'
import {
  type QuickPanelCallBackOptions,
  type QuickPanelCloseAction,
  type QuickPanelFilterFn,
  type QuickPanelInputAdapter,
  type QuickPanelKeyDownEvent,
  type QuickPanelListItem,
  type QuickPanelOpenOptions,
  type QuickPanelScrollTrigger,
  type QuickPanelTriggerInfo
} from './types'

const ITEM_HEIGHT = QUICK_PANEL_ITEM_HEIGHT

const INPUT_QUERY_TERMINATOR_REGEX = /\s/

function isInputQueryAnchorAllowed(text: string, queryAnchor: number) {
  if (queryAnchor === 0) return true
  return /\s/.test(text.slice(queryAnchor - 1, queryAnchor))
}

function isInputQueryTerminated(searchText: string, skipLength: number) {
  return INPUT_QUERY_TERMINATOR_REGEX.test(searchText.slice(skipLength))
}

function isInputQueryRestarted(searchText: string, triggerSymbol?: string) {
  return Boolean(triggerSymbol && searchText.slice(triggerSymbol.length).includes(triggerSymbol))
}

function isInputQueryCursorAtEnd(text: string, cursorOffset: number) {
  const nextChar = text.slice(cursorOffset, cursorOffset + 1)
  return nextChar.length === 0 || /\s/.test(nextChar)
}

/**
 * A searching panel with no ordinary matches collapses to "No results": the virtual list and the
 * pinned footer rows are both dropped. Keyboard handling has to agree with the render, or keys would
 * act on rows nobody can see — so both read this.
 */
function isQuickPanelCollapsed(options: {
  manageListExternally?: boolean
  hasSearchText: boolean
  visibleNonPinnedCount: number
}) {
  return !options.manageListExternally && options.hasSearchText && options.visibleNonPinnedCount === 0
}

function countVisibleNonPinned(list: QuickPanelListItem[]) {
  return list.filter((item) => !item.alwaysVisible && !item.fixedToBottom).length
}

function buildFuzzyRegex(searchText: string) {
  const pattern = searchText
    .toLowerCase()
    .split('')
    .map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(pattern, 'ig')
}

/** Ordinary matches for a query — the pinned and bottom-fixed rows never take part in filtering. */
function selectMatchingItems(options: {
  items: QuickPanelListItem[]
  searchText: string
  filterFn: QuickPanelFilterFn
  pinyinCache: WeakMap<QuickPanelListItem, string>
}) {
  const fuzzyRegex = buildFuzzyRegex(options.searchText)
  return options.items
    .filter((item) => !item.alwaysVisible && !item.fixedToBottom)
    .filter((item) => options.filterFn(item, options.searchText, fuzzyRegex, options.pinyinCache))
}

function getInputQueryText(searchText: string, triggerSymbol?: string) {
  if (!triggerSymbol) return searchText
  return searchText.startsWith(triggerSymbol) ? searchText.slice(triggerSymbol.length) : searchText
}

function getTrackedInputSearchText(options: {
  triggerType?: QuickPanelTriggerInfo['type']
  inputSearchText: string
  initialSearchText?: string
}) {
  if (options.triggerType === 'button' && options.inputSearchText.length === 0 && options.initialSearchText) {
    return options.initialSearchText
  }
  return options.inputSearchText
}

/**
 * Single source of truth for "is this input query session still valid, and what is the query".
 * Evaluated both when the panel opens (`source: 'initial'`) and on every input update
 * (`source: 'input'`); `searchText` is null when the query cannot be derived at all.
 *
 * Trigger-symbol-dependent rules stay exclusive to input-triggered panels — button panels have
 * no trigger symbol, so those rules are meaningless there. The remaining rules (whitespace ends
 * the query, cursor left the query) describe "the user moved on to writing a message" and apply
 * to button panels too.
 */
function evaluateInputQuerySession(params: {
  text: string
  cursorOffset: number
  queryAnchor: number
  triggerType?: QuickPanelTriggerInfo['type']
  inputTriggerSymbol?: string
  inputTriggerConsumed: boolean
  source: 'initial' | 'input'
}): { closeAction: QuickPanelCloseAction | null; searchText: string | null } {
  const { text, cursorOffset, queryAnchor, triggerType, inputTriggerSymbol, inputTriggerConsumed, source } = params
  const isInputTrigger = triggerType === 'input'
  const requiresTriggerSymbol = isInputTrigger && inputTriggerSymbol !== undefined

  if (source === 'input' && cursorOffset < queryAnchor) {
    return { closeAction: 'input_session_invalid', searchText: null }
  }

  if (isInputTrigger && !isInputQueryAnchorAllowed(text, queryAnchor)) {
    return { closeAction: 'input_prefix_invalid', searchText: null }
  }

  // Only meaningful once the user is typing: it catches them backspacing the trigger away. On open
  // the symbol is legitimately already gone whenever a submenu inherits its parent's input trigger
  // (the parent consumed it on the way in), and closing a panel the instant it opens is never right.
  if (
    source === 'input' &&
    requiresTriggerSymbol &&
    !inputTriggerConsumed &&
    text.slice(queryAnchor, queryAnchor + inputTriggerSymbol.length) !== inputTriggerSymbol
  ) {
    return { closeAction: 'input_trigger_removed', searchText: null }
  }

  const searchText = text.slice(queryAnchor, cursorOffset)

  // Whitespace only means "the user moved on" once they are actually typing; a button panel is often
  // summoned while the composer already holds a sentence, and closing on that pre-existing text would
  // make the panel unopenable.
  const enforcesUserMovedOn = isInputTrigger || source === 'input'

  // Input-triggered queries still carrying their trigger symbol must not mistake it for query
  // content. Once it has been consumed (a submenu was opened) the query starts at the caret like a
  // button panel's does — skipping a character there would swallow the user's first real space.
  const querySymbolPrefixLength = requiresTriggerSymbol && !inputTriggerConsumed ? inputTriggerSymbol.length : 0

  if (enforcesUserMovedOn && isInputQueryTerminated(searchText, querySymbolPrefixLength)) {
    return { closeAction: 'input_query_terminated', searchText }
  }

  if (isInputTrigger && isInputQueryRestarted(searchText, inputTriggerSymbol)) {
    return { closeAction: 'input_trigger_restarted', searchText }
  }

  // Button panels are allowed to run mid-sentence: summoning one with the caret inside a word is a
  // legitimate way to insert a reference there, so the caret rule stays exclusive to input triggers,
  // where the query must remain the tail of the text it was typed into. Moving the caret back past
  // the anchor still ends the session via the check at the top.
  if (isInputTrigger && !isInputQueryCursorAtEnd(text, cursorOffset)) {
    return { closeAction: 'input_cursor_invalid', searchText }
  }

  return { closeAction: null, searchText }
}

interface Props {
  inputAdapter?: QuickPanelInputAdapter
}

/**
 * @description Quick panel content view.
 * Avoid adding props here to keep coupling low.
 * This component reads data only from QuickPanelContext.
 */
export const QuickPanelView: React.FC<Props> = ({ inputAdapter }) => {
  const ctx = use(QuickPanelContext)

  if (!ctx) {
    throw new Error('QuickPanel must be used within a QuickPanelProvider')
  }

  const closePanel = ctx.close
  const isPanelVisible = ctx.isVisible
  // Keep close animation layout mounted until provider clears the panel payload.
  const isPanelPresent = ctx.isVisible || Boolean(ctx.symbol)
  const registerKeyDownHandler = ctx.registerKeyDownHandler
  const getPanelGeneration = ctx.getPanelGeneration

  const ASSISTIVE_KEY = isMac ? '⌘' : 'Ctrl'
  const [isAssistiveKeyPressed, setIsAssistiveKeyPressed] = useState(false)

  // Prevent the mouse from interfering during page up/down navigation.
  const [isMouseOver, setIsMouseOver] = useState(false)

  const scrollTriggerRef = useRef<QuickPanelScrollTrigger>('initial')
  const [activeIndex, setActiveIndex] = useState(-1)

  const panelRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<DynamicVirtualListRef>(null)
  const footerRef = useRef<HTMLDivElement>(null)
  // Home placement only: the available height cap between the input and frame top.
  const [availableHeight, setAvailableHeight] = useState<number | null>(null)
  // Fill (home placement) is pushed in explicitly by the composer via context.
  const fill = ctx.fillToAvailableHeight

  const [inputSearchText, setInputSearchText] = useState('')
  const queryAnchorRef = useRef<number | undefined>(undefined)
  const inputTriggerConsumedRef = useRef(false)
  const inputQueryConsumedRef = useRef(false)
  const prevPanelGenerationRef = useRef<number | undefined>(undefined)
  const inputTriggerSymbol = ctx.triggerInfo?.originalText?.slice(0, 1)
  const isTrackedInputPanel = Boolean(
    ctx.trackInputQuery && (ctx.triggerInfo?.type === 'input' || ctx.triggerInfo?.type === 'button')
  )
  const activeSearchText = isTrackedInputPanel ? inputSearchText : ''
  const activeSearchQuery = getInputQueryText(activeSearchText, inputTriggerSymbol)

  // Cache pinyin text by item to avoid repeated conversion.
  const pinyinCacheRef = useRef<WeakMap<QuickPanelListItem, string>>(new WeakMap())

  // Track the previous search text and symbol to decide whether to reset index.
  const prevSearchTextRef = useRef('')
  const prevSymbolRef = useRef('')

  // Use injected filter and sort functions, or fall back to defaults
  const filterFn = ctx.filterFn || defaultFilterFn
  const sortFn = ctx.sortFn || defaultSortFn
  // Handle search and filtering while keeping alwaysVisible items at the top
  // and fixedToBottom actions outside the searchable result set.
  const list = useMemo(() => {
    // Reset stale state when panel fully closes (both isVisible false AND symbol cleared)
    if (!ctx.isVisible && !ctx.symbol) {
      return []
    }

    const baseList = (ctx.list || []).filter((item) => !item.hidden)
    const fixedBottomItems = baseList.filter((item) => item.fixedToBottom)
    const flowItems = baseList.filter((item) => !item.fixedToBottom)

    if (ctx.manageListExternally || !isTrackedInputPanel) {
      return [...flowItems, ...fixedBottomItems]
    }

    const _searchText = activeSearchQuery

    // Pinned items are not filtered.
    const pinnedItems = flowItems.filter((item) => item.alwaysVisible)
    const filteredNormalItems = selectMatchingItems({
      items: flowItems,
      searchText: _searchText,
      filterFn,
      pinyinCache: pinyinCacheRef.current
    })

    // Sort filtered items using injected sort function
    const sortedNormalItems = sortFn(filteredNormalItems, _searchText)

    // Pinned items first, followed by sorted regular items and bottom-fixed actions.
    return [...pinnedItems, ...sortedNormalItems, ...fixedBottomItems]
  }, [
    ctx.isVisible,
    ctx.symbol,
    ctx.manageListExternally,
    ctx.list,
    isTrackedInputPanel,
    activeSearchQuery,
    filterFn,
    sortFn
  ])
  const fixedBottomItems = useMemo(() => list.filter((item) => item.fixedToBottom), [list])
  const scrollableItems = useMemo(() => list.filter((item) => !item.fixedToBottom), [list])

  useLayoutEffect(() => {
    if (!ctx.isVisible && !ctx.symbol) {
      prevSymbolRef.current = ''
      prevSearchTextRef.current = ''
      queryAnchorRef.current = undefined
      inputTriggerConsumedRef.current = false
      inputQueryConsumedRef.current = false
      prevPanelGenerationRef.current = undefined
      setActiveIndex(-1)
      return
    }

    if (!ctx.isVisible) return

    const panelGeneration = getPanelGeneration()
    const isPanelGenerationChanged = prevPanelGenerationRef.current !== panelGeneration
    if (isPanelGenerationChanged) {
      listRef.current?.scrollToOffset?.(0, { align: 'start' })
      inputQueryConsumedRef.current = false
      prevPanelGenerationRef.current = panelGeneration
    }

    if (ctx.readOnly) {
      setActiveIndex(-1)
      prevSearchTextRef.current = activeSearchQuery
      prevSymbolRef.current = ctx.symbol
      return
    }

    if (ctx.manageListExternally) {
      const isSearchChanged = prevSearchTextRef.current !== activeSearchQuery
      const isSymbolChanged = prevSymbolRef.current !== ctx.symbol
      if (isSymbolChanged || (ctx.trackInputQuery && (isSearchChanged || isPanelGenerationChanged))) {
        setActiveIndex(firstQuickPanelSelectableIndex(list))
      } else {
        setActiveIndex((prevIndex) => (prevIndex >= list.length ? (list.length > 0 ? list.length - 1 : -1) : prevIndex))
      }

      prevSearchTextRef.current = activeSearchQuery
      prevSymbolRef.current = ctx.symbol
      return
    }

    // Reset index only when the search text or panel symbol changes.
    const isSearchChanged = prevSearchTextRef.current !== activeSearchQuery
    const isSymbolChanged = prevSymbolRef.current !== ctx.symbol

    if (isSearchChanged || isSymbolChanged) {
      setActiveIndex(firstQuickPanelSelectableIndex(list))
    } else {
      // Clamp the current index into the valid range.
      setActiveIndex((prevIndex) => (prevIndex >= list.length ? (list.length > 0 ? list.length - 1 : -1) : prevIndex))
    }

    prevSearchTextRef.current = activeSearchQuery
    prevSymbolRef.current = ctx.symbol
  }, [
    ctx.isVisible,
    ctx.manageListExternally,
    ctx.readOnly,
    ctx.symbol,
    ctx.trackInputQuery,
    getPanelGeneration,
    activeSearchQuery,
    list
  ])

  const handleClose = useCallback(
    (action?: QuickPanelCloseAction) => {
      const cleanSearchText = activeSearchQuery.trim()
      ctx.close(action, cleanSearchText)
      scrollTriggerRef.current = 'initial'
    },
    [ctx, activeSearchQuery]
  )

  const getCurrentPanelOptions = useCallback(
    (defaultIndex?: number): QuickPanelOpenOptions => ({
      title: ctx.title,
      list: ctx.list,
      symbol: ctx.symbol,
      multiple: ctx.multiple,
      readOnly: ctx.readOnly,
      defaultIndex,
      pageSize: ctx.pageSize,
      queryAnchor: queryAnchorRef.current ?? ctx.queryAnchor,
      parentPanel: ctx.parentPanel,
      triggerInfo: ctx.triggerInfo,
      trackInputQuery: ctx.trackInputQuery,
      initialSearchText: activeSearchQuery,
      beforeAction: ctx.beforeAction,
      afterAction: ctx.afterAction,
      onClose: ctx.onClose,
      manageListExternally: ctx.manageListExternally,
      filterFn: ctx.filterFn,
      sortFn: ctx.sortFn
    }),
    [activeSearchQuery, ctx]
  )

  const consumeInputQuery = useCallback(() => {
    if (!inputAdapter) return

    const queryAnchor = queryAnchorRef.current ?? ctx.queryAnchor
    if (queryAnchor === undefined) return

    const text = inputAdapter.getText()
    const cursorOffset = inputAdapter.getCursorOffset?.() ?? text.length
    if (cursorOffset <= queryAnchor) return

    // A panel that knows its live query only ever deletes text that is still exactly that query: a
    // multi-select panel keeps running after a pick, and by then the anchored range can hold the
    // token that was just inserted rather than a search word.
    if (isTrackedInputPanel || ctx.triggerInfo?.type === 'button') {
      if (!activeSearchText || text.slice(queryAnchor, cursorOffset) !== activeSearchText) return
    }

    inputAdapter.deleteTriggerRange({ from: queryAnchor, to: cursorOffset })
  }, [activeSearchText, ctx.queryAnchor, ctx.triggerInfo?.type, inputAdapter, isTrackedInputPanel])

  const consumeInputQueryOnce = useCallback(() => {
    if (inputQueryConsumedRef.current) return
    inputQueryConsumedRef.current = true
    consumeInputQuery()
  }, [consumeInputQuery])

  const consumeInputTriggerSymbol = useCallback(() => {
    if (!inputAdapter) return

    const queryAnchor = queryAnchorRef.current ?? ctx.queryAnchor
    if (queryAnchor === undefined) return

    const text = inputAdapter.getText()
    const cursorOffset = inputAdapter.getCursorOffset?.() ?? text.length
    if (cursorOffset <= queryAnchor) return

    if (!inputTriggerSymbol) return

    const triggerSymbol = text.slice(queryAnchor, queryAnchor + inputTriggerSymbol.length)
    if (triggerSymbol !== inputTriggerSymbol) return

    inputTriggerConsumedRef.current = true
    inputAdapter.deleteTriggerRange({ from: queryAnchor, to: queryAnchor + inputTriggerSymbol.length })
    queryAnchorRef.current = queryAnchor
    setInputSearchText(text.slice(queryAnchor + inputTriggerSymbol.length, cursorOffset))
  }, [ctx.queryAnchor, inputAdapter, inputTriggerSymbol])

  const handleItemAction = useCallback(
    (item: QuickPanelListItem, action?: QuickPanelCloseAction) => {
      // Read-only panels (e.g. MCP status) stay non-interactive, except for pinned footer actions
      // like "open config" which are the panel's one intentional affordance.
      if (ctx.readOnly && !item.fixedToBottom) return
      if (item.disabled) return
      const cleanSearchText = activeSearchQuery
      const parentPanel = getCurrentPanelOptions(activeIndex)
      const queryAnchor = queryAnchorRef.current ?? ctx.queryAnchor
      const panelGenerationBeforeAction = ctx.getPanelGeneration()

      // In multi-select mode, update selection state first.
      if (ctx.multiple && !item.isMenu) {
        const newSelectedState = !item.isSelected
        ctx.updateItemSelection(item, newSelectedState)

        // Create the updated item object for callbacks.
        const updatedItem = { ...item, isSelected: newSelectedState }
        const quickPanelCallBackOptions: QuickPanelCallBackOptions = {
          context: ctx,
          action,
          item: updatedItem,
          parentPanel,
          queryAnchor,
          searchText: cleanSearchText,
          inputAdapter
        }

        // A panel that follows typing lets the user search again after a pick, so every pick has to
        // clear the word that led to it — a once-only cleanup strands the second search word between
        // two inserted tokens as message text. Panels that do not follow typing have no second
        // search to clear, and clearing them twice would eat the token instead.
        if (isTrackedInputPanel) {
          consumeInputQuery()
        } else {
          consumeInputQueryOnce()
        }
        ctx.beforeAction?.(quickPanelCallBackOptions)
        item?.action?.(quickPanelCallBackOptions)
        ctx.afterAction?.(quickPanelCallBackOptions)
        queryAnchorRef.current = inputAdapter?.getCursorOffset?.() ?? queryAnchor
        setInputSearchText('')
        return
      }

      const quickPanelCallBackOptions: QuickPanelCallBackOptions = {
        context: ctx,
        action,
        item,
        parentPanel,
        queryAnchor,
        searchText: cleanSearchText,
        inputAdapter
      }

      if (item.isMenu) {
        if (ctx.triggerInfo?.type === 'button' && ctx.trackInputQuery) {
          consumeInputQueryOnce()
        } else {
          consumeInputTriggerSymbol()
        }
      } else {
        consumeInputQuery()
      }
      ctx.beforeAction?.(quickPanelCallBackOptions)
      item?.action?.(quickPanelCallBackOptions)
      ctx.afterAction?.(quickPanelCallBackOptions)

      if (item.isMenu) {
        return
      }

      // Keep the panel open in multi-select mode.
      if (ctx.multiple || item.keepOpenOnAction) return

      if (ctx.getPanelGeneration() !== panelGenerationBeforeAction) {
        return
      }

      handleClose(action)
    },
    [
      ctx,
      activeSearchQuery,
      getCurrentPanelOptions,
      activeIndex,
      consumeInputTriggerSymbol,
      consumeInputQuery,
      consumeInputQueryOnce,
      inputAdapter,
      isTrackedInputPanel,
      handleClose
    ]
  )

  const updateSearchFromInput = useCallback(
    (options?: { skipCloseChecks?: boolean }) => {
      if (!isPanelVisible || !inputAdapter || !isTrackedInputPanel) return

      const queryAnchor = queryAnchorRef.current
      if (queryAnchor === undefined) return

      const text = inputAdapter.getText()
      const cursorOffset = inputAdapter.getCursorOffset?.() ?? text.length

      const { closeAction, searchText } = evaluateInputQuerySession({
        text,
        cursorOffset,
        queryAnchor,
        triggerType: ctx.triggerInfo?.type,
        inputTriggerSymbol,
        inputTriggerConsumed: inputTriggerConsumedRef.current,
        source: 'input'
      })

      if (closeAction && !options?.skipCloseChecks) {
        closePanel(closeAction)
        return
      }

      if (searchText === null) return

      setInputSearchText(
        getTrackedInputSearchText({
          triggerType: ctx.triggerInfo?.type,
          inputSearchText: searchText,
          initialSearchText: ctx.initialSearchText
        })
      )
    },
    [
      closePanel,
      ctx.initialSearchText,
      ctx.triggerInfo?.type,
      inputAdapter,
      inputTriggerSymbol,
      isPanelVisible,
      isTrackedInputPanel
    ]
  )

  useEffect(() => {
    if (!ctx.isVisible) return

    if (!inputAdapter) {
      queryAnchorRef.current = undefined
      setInputSearchText('')
      return
    }

    const text = inputAdapter.getText()
    const cursorOffset = inputAdapter.getCursorOffset?.() ?? text.length
    const queryAnchor = Math.max(
      0,
      Math.min(ctx.queryAnchor ?? ctx.triggerInfo?.position ?? cursorOffset, cursorOffset)
    )

    // A submenu inherits its parent's input triggerInfo, but the parent already deleted the trigger
    // symbol on the way in. Re-deriving "was it consumed?" from the text is the only reading that
    // survives that hand-off: a fresh "/" session still has its symbol at the anchor, a submenu does
    // not. Blindly clearing the flag here would make every keystroke in a submenu look like the user
    // had backspaced the trigger away, closing the panel on the first character they type.
    if (ctx.triggerInfo?.type === 'input' && inputTriggerSymbol !== undefined) {
      inputTriggerConsumedRef.current =
        text.slice(queryAnchor, queryAnchor + inputTriggerSymbol.length) !== inputTriggerSymbol
    }

    queryAnchorRef.current = queryAnchor
    if (!isTrackedInputPanel) {
      setInputSearchText('')
      inputAdapter.focus()
      return
    }

    const { closeAction, searchText } = evaluateInputQuerySession({
      text,
      cursorOffset,
      queryAnchor,
      triggerType: ctx.triggerInfo?.type,
      inputTriggerSymbol,
      inputTriggerConsumed: inputTriggerConsumedRef.current,
      source: 'initial'
    })

    if (closeAction) {
      closePanel(closeAction)
      return
    }

    setInputSearchText(
      getTrackedInputSearchText({
        triggerType: ctx.triggerInfo?.type,
        inputSearchText: searchText ?? '',
        initialSearchText: ctx.initialSearchText
      })
    )
    inputAdapter.focus()

    return inputAdapter.subscribeInput?.((event) => {
      // Programmatic edits (token sync after a selection) are not the user moving on, and their text
      // would pollute the query — but they do move the caret, and a multi-select re-anchors before the
      // token lands. Re-anchor here or the inserted token's separator space would sit inside the next
      // query and read as "user started writing a message", closing the panel on the very next keystroke.
      if (event?.cause === 'state-sync') {
        queryAnchorRef.current = inputAdapter.getCursorOffset?.() ?? queryAnchorRef.current
        return
      }
      // While an IME composition is in flight the query must still track the text so the list
      // filters along with the pinyin, but close checks are skipped: many IMEs commit with a
      // space, which "whitespace ends the query" would otherwise read as the user moving on.
      updateSearchFromInput({ skipCloseChecks: event?.isComposing })
    })
  }, [
    ctx.isVisible,
    ctx.queryAnchor,
    ctx.symbol,
    ctx.initialSearchText,
    ctx.triggerInfo?.originalText,
    ctx.triggerInfo?.position,
    ctx.triggerInfo?.type,
    ctx.trackInputQuery,
    closePanel,
    inputAdapter,
    inputTriggerSymbol,
    isTrackedInputPanel,
    updateSearchFromInput
  ])

  useEffect(() => {
    if (ctx.isVisible) return

    const timer = setTimeout(() => {
      setInputSearchText('')
      queryAnchorRef.current = undefined
      inputTriggerConsumedRef.current = false
      inputQueryConsumedRef.current = false
      prevPanelGenerationRef.current = undefined
    }, 200)

    return () => clearTimeout(timer)
  }, [ctx.isVisible])

  useLayoutEffect(() => {
    if (!listRef.current || activeIndex < 0 || scrollTriggerRef.current === 'none') return

    if (activeIndex >= scrollableItems.length) {
      scrollTriggerRef.current = 'none'
      return
    }

    const alignment = scrollTriggerRef.current === 'keyboard' ? 'auto' : activeIndex === 0 ? 'start' : 'center'
    listRef.current?.scrollToIndex(activeIndex, { align: alignment })

    scrollTriggerRef.current = 'none'
  }, [activeIndex, scrollableItems.length])

  const handlePanelKeyDown = useCallback(
    (e: QuickPanelKeyDownEvent) => {
      const assistivePressed = isMac ? e.metaKey : e.ctrlKey

      if (assistivePressed) {
        setIsAssistiveKeyPressed(true)
      }

      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Escape'].includes(e.key)) {
        e.preventDefault()
        e.stopPropagation()
        setIsMouseOver(false)
      }
      if (e.key === 'ArrowRight' && assistivePressed) {
        e.preventDefault()
        e.stopPropagation()
        setIsMouseOver(false)
      }
      if (ctx.readOnly) {
        // Read-only panels are non-interactive except for pinned footer actions (e.g. "Configure
        // MCP"), which stay keyboard-selectable: ▲▼ moves onto them and Enter/Tab activates the
        // highlighted one. Everything else is swallowed so the status list stays inert.
        // With no matches the footer rows are not rendered, so they must not stay keyboard-reachable
        // either — otherwise Enter would fire an action that is nowhere on screen.
        const footerRowsRendered = !isQuickPanelCollapsed({
          manageListExternally: ctx.manageListExternally,
          hasSearchText: activeSearchQuery.length > 0,
          visibleNonPinnedCount: countVisibleNonPinned(list)
        })
        const footerNavItems = list.map((item) => ({
          disabled: !(footerRowsRendered && item.fixedToBottom && !!item.action && !item.disabled)
        }))
        const hasFooterAction = footerNavItems.some((item) => !item.disabled)
        if (hasFooterAction && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(e.key)) {
          e.preventDefault()
          e.stopPropagation()
          setIsMouseOver(false)
          const dir = e.key === 'ArrowUp' || e.key === 'PageUp' ? -1 : 1
          setActiveIndex((prev) => moveQuickPanelSelectableIndex(footerNavItems, prev, dir, { wrap: true }))
          return true
        }
        if (hasFooterAction && !e.shiftKey && ['Enter', 'NumpadEnter', 'Tab'].includes(e.key)) {
          e.preventDefault()
          e.stopPropagation()
          setIsMouseOver(false)
          const activeItem = list?.[activeIndex]
          if (activeItem?.fixedToBottom && activeItem.action) handleItemAction(activeItem, 'enter')
          return true
        }
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Tab', 'Enter', 'NumpadEnter'].includes(e.key)) {
          e.preventDefault()
          e.stopPropagation()
          setIsMouseOver(false)
          return true
        }
        if (e.key === 'ArrowRight' && assistivePressed) {
          e.preventDefault()
          e.stopPropagation()
          setIsMouseOver(false)
          return true
        }
      }

      switch (e.key) {
        case 'ArrowUp':
          scrollTriggerRef.current = 'keyboard'
          setActiveIndex((prev) =>
            moveQuickPanelSelectableIndex(list, prev, assistivePressed ? -ctx.pageSize : -1, { wrap: true })
          )
          return true

        case 'ArrowDown':
          scrollTriggerRef.current = 'keyboard'
          setActiveIndex((prev) =>
            moveQuickPanelSelectableIndex(list, prev, assistivePressed ? ctx.pageSize : 1, { wrap: true })
          )
          return true

        case 'PageUp':
          scrollTriggerRef.current = 'keyboard'
          setActiveIndex((prev) => moveQuickPanelSelectableIndex(list, prev, -ctx.pageSize, { wrap: false }))
          return true

        case 'PageDown':
          scrollTriggerRef.current = 'keyboard'
          setActiveIndex((prev) => moveQuickPanelSelectableIndex(list, prev, ctx.pageSize, { wrap: false }))
          return true

        case 'ArrowRight':
          if (!assistivePressed) return false
          if (!list?.[activeIndex]?.isMenu) return false
          scrollTriggerRef.current = 'initial'
          handleItemAction(list[activeIndex], 'enter')
          return true

        case 'Tab': {
          const isComposing = 'nativeEvent' in e ? e.nativeEvent.isComposing : e.isComposing
          if (isComposing || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false

          e.preventDefault()
          e.stopPropagation()
          setIsMouseOver(false)

          const hasSearch = activeSearchQuery.length > 0
          const isCollapsed = isQuickPanelCollapsed({
            manageListExternally: ctx.manageListExternally,
            hasSearchText: hasSearch,
            visibleNonPinnedCount: countVisibleNonPinned(list)
          })
          if (!isCollapsed && list?.[activeIndex]) {
            handleItemAction(list[activeIndex], 'enter')
          }
          return true
        }

        case 'Enter':
        case 'NumpadEnter': {
          const isComposing = 'nativeEvent' in e ? e.nativeEvent.isComposing : e.isComposing
          if (isComposing) return false

          if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
            setIsMouseOver(false)
            return false
          }

          // Intercept while collapsed/soft-hidden so query input is not sent as a message.
          const hasSearch = activeSearchQuery.length > 0
          const isCollapsed = isQuickPanelCollapsed({
            manageListExternally: ctx.manageListExternally,
            hasSearchText: hasSearch,
            visibleNonPinnedCount: countVisibleNonPinned(list)
          })
          if (isCollapsed) {
            e.preventDefault()
            e.stopPropagation()
            setIsMouseOver(false)
            return true
          }

          // When visible and not collapsed, intercept every Enter variant.
          // Plain Enter selects an item; modified Enter is only intercepted.
          if (e.ctrlKey || e.metaKey || e.altKey) {
            e.preventDefault()
            e.stopPropagation()
            setIsMouseOver(false)
            return true
          }

          if (list?.[activeIndex]) {
            e.preventDefault()
            e.stopPropagation()
            setIsMouseOver(false)

            handleItemAction(list[activeIndex], 'enter')
          } else {
            e.preventDefault()
            e.stopPropagation()
          }
          return true
        }
        case 'Escape':
          e.preventDefault()
          e.stopPropagation()
          handleClose('esc')
          return true
      }

      return false
    },
    [activeIndex, ctx, list, handleItemAction, handleClose, activeSearchQuery]
  )

  useLayoutEffect(() => {
    if (!isPanelVisible) return
    return registerKeyDownHandler(handlePanelKeyDown)
  }, [isPanelVisible, registerKeyDownHandler, handlePanelKeyDown])

  useEffect(() => {
    if (!isPanelVisible) return

    const handleGlobalEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return
      handlePanelKeyDown(event)
    }

    window.addEventListener('keydown', handleGlobalEscape, true)
    return () => window.removeEventListener('keydown', handleGlobalEscape, true)
  }, [handlePanelKeyDown, isPanelVisible])

  const handlePanelKeyUp = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isMac ? !e.metaKey : !e.ctrlKey) {
      setIsAssistiveKeyPressed(false)
    }
  }, [])

  useEffect(() => {
    if (!ctx.isVisible) {
      setIsAssistiveKeyPressed(false)
      return
    }

    const handleAssistiveKeyUp = (event: KeyboardEvent) => {
      if (isMac ? event.key === 'Meta' || !event.metaKey : event.key === 'Control' || !event.ctrlKey) {
        setIsAssistiveKeyPressed(false)
      }
    }
    const resetAssistiveKey = () => setIsAssistiveKeyPressed(false)

    window.addEventListener('keyup', handleAssistiveKeyUp)
    window.addEventListener('blur', resetAssistiveKey)
    document.addEventListener('visibilitychange', resetAssistiveKey)

    return () => {
      window.removeEventListener('keyup', handleAssistiveKeyUp)
      window.removeEventListener('blur', resetAssistiveKey)
      document.removeEventListener('visibilitychange', resetAssistiveKey)
    }
  }, [ctx.isVisible])

  useEffect(() => {
    if (!ctx.isVisible) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('#inputbar')) return
      if (bodyRef.current && !bodyRef.current.contains(target)) {
        handleClose('outsideclick')
      }
    }

    window.addEventListener('click', handleClickOutside, true)

    return () => {
      window.removeEventListener('click', handleClickOutside, true)
    }
  }, [ctx.isVisible, handleClose])

  const [footerWidth, setFooterWidth] = useState(0)
  const [measuredChromeHeight, setMeasuredChromeHeight] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (!isPanelPresent || ctx.readOnly) {
      setMeasuredChromeHeight(null)
      return
    }
    if (!footerRef.current || !bodyRef.current) return

    const footerElement = footerRef.current
    const bodyElement = bodyRef.current
    const updateFooterMetrics = () => {
      setFooterWidth(footerElement.clientWidth)
      const nextChromeHeight =
        footerElement.clientHeight > 0
          ? footerElement.clientHeight + getQuickPanelBodyVerticalSpace(getComputedStyle(bodyElement))
          : null
      setMeasuredChromeHeight((prev) => (prev === nextChromeHeight ? prev : nextChromeHeight))
    }

    updateFooterMetrics()
    if (typeof ResizeObserver === 'undefined') return

    const resizeObserver = new ResizeObserver(updateFooterMetrics)
    resizeObserver.observe(footerElement)
    resizeObserver.observe(bodyElement)

    return () => resizeObserver.disconnect()
  }, [isPanelPresent, ctx.readOnly])

  // Fill (home placement) measures the available height above the input against the dock layer.
  // Docked composers keep the original fixed height and skip this cap.
  useLayoutEffect(() => {
    if (!isPanelPresent || !ctx.fillToAvailableHeight) {
      setAvailableHeight(null)
      return
    }
    const panel = panelRef.current
    if (!panel) return

    const dockEl = panel.closest('[data-composer-dock-layer]')
    if (!dockEl) {
      setAvailableHeight(null)
      return
    }

    // The panel bottom is anchored above the input by -top-1 -translate-y-full,
    // so it stays stable while the panel height changes.
    const syncPlacementMetrics = () => {
      const panelBottom = panel.getBoundingClientRect().bottom
      const dockTop = dockEl.getBoundingClientRect().top
      const next = panelBottom - dockTop - QUICK_PANEL_SAFE_MARGIN
      setAvailableHeight((prev) => (prev === next ? prev : next))
    }

    syncPlacementMetrics()

    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncPlacementMetrics)
    resizeObserver?.observe(dockEl)
    if (panel.parentElement) resizeObserver?.observe(panel.parentElement)

    window.addEventListener('resize', syncPlacementMetrics)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', syncPlacementMetrics)
    }
  }, [isPanelPresent, ctx.fillToAvailableHeight])

  const hasSearchText = useMemo(() => activeSearchQuery.length > 0, [activeSearchQuery])
  // Collapse is based only on regular matches. Pinned-only results still count as no match.
  const visibleNonPinnedCount = useMemo(() => countVisibleNonPinned(list), [list])
  const collapsed = isQuickPanelCollapsed({
    manageListExternally: ctx.manageListExternally,
    hasSearchText,
    visibleNonPinnedCount
  })
  // Read-only panels keep the original fixed height to avoid header offset changes.
  const fillEffective = fill && !ctx.readOnly
  const { panelMaxHeight, listHeight } = getQuickPanelHeights({
    isVisible: isPanelPresent,
    collapsed,
    readOnly: ctx.readOnly ?? false,
    pageSize: ctx.pageSize,
    fixedItemCount: fixedBottomItems.length,
    itemCount: scrollableItems.length,
    availableHeight,
    fill: fillEffective,
    chromeHeight: measuredChromeHeight ?? undefined
  })
  const listContentHeight =
    Math.min(Math.max(0, ctx.pageSize - fixedBottomItems.length), scrollableItems.length) * ITEM_HEIGHT
  const fixedBottomHeight = fixedBottomItems.length * ITEM_HEIGHT
  // Home/fill constrains the body only when content overflows and the list shrinks.
  const constrainBody = fillEffective && !collapsed && ctx.isVisible && listHeight < listContentHeight

  const estimateSize = useCallback(() => ITEM_HEIGHT, [])

  const handlePanelMouseMove = useCallback(() => {
    scrollTriggerRef.current = 'initial'
    if (!ctx.readOnly) {
      setActiveIndex((active) => (active === -1 ? active : -1))
    }
    setIsMouseOver((prev) => (prev ? prev : true))
  }, [ctx.readOnly])

  const rowRenderer = useCallback(
    (item: QuickPanelListItem, itemIndex: number) => {
      if (!item) return null

      return (
        <QuickPanelRow
          className={classNames({
            // In read-only panels only the pinned footer action can be highlighted (via keyboard).
            focused: (!ctx.readOnly || item.fixedToBottom) && itemIndex === activeIndex,
            selected: !ctx.readOnly && item.isSelected,
            disabled: item.disabled
          })}
          active={(!ctx.readOnly || !!item.fixedToBottom) && itemIndex === activeIndex}
          contentClassName="max-w-[60%]"
          dataId={item.id}
          hoverEnabled={isMouseOver}
          item={item}
          readOnly={ctx.readOnly}
          reserveIconSlot
          selected={!ctx.readOnly && item.isSelected}
          onSelect={() => handleItemAction(item, 'click')}
        />
      )
    },
    [activeIndex, ctx.readOnly, handleItemAction, isMouseOver]
  )

  return (
    <div
      ref={panelRef}
      style={{ maxHeight: panelMaxHeight }}
      className={classNames(
        '-top-1 -translate-y-full absolute right-2 left-2 flex origin-bottom flex-col justify-end',
        ctx.isVisible
          ? 'transition-[max-height] duration-200 ease-in-out motion-reduce:transition-none'
          : 'transition-none',
        ctx.isVisible ? 'overflow-visible' : 'overflow-hidden',
        ctx.isVisible && 'visible',
        ctx.isVisible ? 'pointer-events-auto' : 'pointer-events-none'
      )}
      data-testid="quick-panel">
      <div
        ref={bodyRef}
        data-slot="quick-panel-content"
        data-testid="quick-panel-body"
        style={constrainBody ? { height: panelMaxHeight } : undefined}
        className={classNames(
          'relative isolate transform-gpu overflow-hidden rounded-xl bg-[color-mix(in_srgb,var(--card)_76%,transparent)] py-1.25 text-card-foreground backdrop-blur-2xl transition-[translate,opacity] will-change-[translate,opacity] [border:0.5px_solid_var(--border)] motion-reduce:translate-y-0 motion-reduce:transition-none dark:bg-[color:color-mix(in_srgb,color-mix(in_srgb,var(--card)_95%,var(--foreground)_5%)_90%,transparent)] [&::-webkit-scrollbar]:w-0.75',
          constrainBody && 'flex flex-col justify-end',
          ctx.isVisible
            ? 'translate-y-0 opacity-100 shadow-none duration-[140ms,200ms] ease-[cubic-bezier(0.16,1,0.3,1),ease-out]'
            : 'translate-y-2 opacity-0 shadow-none duration-[80ms,100ms] ease-[cubic-bezier(0.4,0,1,1),ease-out] [transition-delay:0ms,80ms]'
        )}
        onKeyDown={handlePanelKeyDown}
        onKeyUp={handlePanelKeyUp}
        onMouseMove={handlePanelMouseMove}>
        {ctx.readOnly ? <QuickPanelReadOnlyHeader title={ctx.title} onClose={() => handleClose('click')} /> : null}
        {collapsed ? (
          <div className="p-4 text-center text-[13px] text-muted-foreground">
            {t('settings.quickPanel.noResult', 'No results')}
          </div>
        ) : null}
        {/* With no matches the panel shows only "No results" — a pinned footer action would
            otherwise linger below it, clickable by mouse yet inert to Enter (which is swallowed
            while collapsed). */}
        {!collapsed ? (
          <div
            className="relative shrink-0"
            data-testid="quick-panel-list-region"
            style={{ height: listHeight + fixedBottomHeight }}>
            <DynamicVirtualList
              ref={listRef}
              list={scrollableItems}
              size={listHeight}
              estimateSize={estimateSize}
              overscan={5}
              scrollerStyle={{
                pointerEvents: isMouseOver ? 'auto' : 'none'
              }}>
              {rowRenderer}
            </DynamicVirtualList>
            {fixedBottomItems.length > 0 ? (
              <div className="absolute right-0 bottom-0 left-0 bg-transparent" data-testid="quick-panel-fixed-bottom">
                {fixedBottomItems.map((item, index) => (
                  <div key={item.id ?? index}>{rowRenderer(item, scrollableItems.length + index)}</div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {!ctx.readOnly ? (
          <QuickPanelFooter
            containerRef={footerRef}
            title={ctx.title}
            assistiveKey={footerWidth >= 500 ? ASSISTIVE_KEY : undefined}
            assistiveKeyActive={isAssistiveKeyPressed}
            showPageHint
            confirmLabel={ctx.multiple ? t('settings.quickPanel.multiple') : undefined}
          />
        ) : null}
      </div>
    </div>
  )
}
