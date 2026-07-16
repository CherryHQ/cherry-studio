import { DynamicVirtualList, type DynamicVirtualListRef } from '@renderer/components/VirtualList'
import { isMac } from '@renderer/utils/platform'
import { classNames } from '@renderer/utils/style'
import { t } from 'i18next'
import React, { use, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { defaultFilterFn, defaultSortFn } from './defaultStrategies'
import {
  getQuickPanelHeights,
  QUICK_PANEL_BODY_CHROME_VERTICAL_SPACE,
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

function isInputQueryTerminated(searchText: string) {
  return INPUT_QUERY_TERMINATOR_REGEX.test(searchText.slice(1))
}

function isInputQueryRestarted(searchText: string, triggerSymbol?: string) {
  return Boolean(triggerSymbol && searchText.slice(triggerSymbol.length).includes(triggerSymbol))
}

function isInputQueryCursorAtEnd(text: string, cursorOffset: number) {
  const nextChar = text.slice(cursorOffset, cursorOffset + 1)
  return nextChar.length === 0 || /\s/.test(nextChar)
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
    const lowerSearchText = _searchText.toLowerCase()
    const fuzzyPattern = lowerSearchText
      .split('')
      .map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')
    const fuzzyRegex = new RegExp(fuzzyPattern, 'ig')

    // Split pinned items (not filtered) from regular items.
    const pinnedItems = flowItems.filter((item) => item.alwaysVisible)
    const normalItems = flowItems.filter((item) => !item.alwaysVisible)

    // Filter normal items using injected filter function
    const filteredNormalItems = normalItems.filter((item) => {
      return filterFn(item, _searchText, fuzzyRegex, pinyinCacheRef.current)
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

    if (ctx.triggerInfo?.type === 'button') {
      const currentInputQuery = text.slice(queryAnchor, cursorOffset)
      if (!activeSearchQuery || currentInputQuery !== activeSearchQuery) return
    }

    inputAdapter.deleteTriggerRange({ from: queryAnchor, to: cursorOffset })
  }, [activeSearchQuery, ctx.queryAnchor, ctx.triggerInfo?.type, inputAdapter])

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
      if (ctx.readOnly) return
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

        consumeInputQueryOnce()
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
      if (ctx.multiple) return

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
      handleClose
    ]
  )

  const updateSearchFromInput = useCallback(() => {
    if (!isPanelVisible || !inputAdapter || !isTrackedInputPanel) return

    const queryAnchor = queryAnchorRef.current
    if (queryAnchor === undefined) return

    const text = inputAdapter.getText()
    const cursorOffset = inputAdapter.getCursorOffset?.() ?? text.length
    const shouldRequireInputTrigger = ctx.triggerInfo?.type === 'input' && inputTriggerSymbol !== undefined

    if (cursorOffset < queryAnchor) {
      closePanel('input_session_invalid')
      return
    }

    if (ctx.triggerInfo?.type === 'input' && !isInputQueryAnchorAllowed(text, queryAnchor)) {
      closePanel('input_prefix_invalid')
      return
    }

    if (
      shouldRequireInputTrigger &&
      !inputTriggerConsumedRef.current &&
      text.slice(queryAnchor, queryAnchor + inputTriggerSymbol.length) !== inputTriggerSymbol
    ) {
      closePanel('input_trigger_removed')
      return
    }

    const nextSearchText = text.slice(queryAnchor, cursorOffset)
    if (ctx.triggerInfo?.type === 'input' && isInputQueryTerminated(nextSearchText)) {
      closePanel('input_query_terminated')
      return
    }

    if (ctx.triggerInfo?.type === 'input' && isInputQueryRestarted(nextSearchText, inputTriggerSymbol)) {
      closePanel('input_trigger_restarted')
      return
    }

    if (ctx.triggerInfo?.type === 'input' && !isInputQueryCursorAtEnd(text, cursorOffset)) {
      closePanel('input_cursor_invalid')
      return
    }

    setInputSearchText(
      getTrackedInputSearchText({
        triggerType: ctx.triggerInfo?.type,
        inputSearchText: nextSearchText,
        initialSearchText: ctx.initialSearchText
      })
    )
  }, [
    closePanel,
    ctx.initialSearchText,
    ctx.triggerInfo?.type,
    inputAdapter,
    inputTriggerSymbol,
    isPanelVisible,
    isTrackedInputPanel
  ])

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

    if (ctx.triggerInfo?.type === 'input' && inputTriggerSymbol !== undefined) {
      inputTriggerConsumedRef.current = false
    }

    queryAnchorRef.current = queryAnchor
    if (!isTrackedInputPanel) {
      setInputSearchText('')
      inputAdapter.focus()
      return
    }

    if (ctx.triggerInfo?.type === 'input' && !isInputQueryAnchorAllowed(text, queryAnchor)) {
      closePanel('input_prefix_invalid')
      return
    }

    if (inputTriggerSymbol && text.slice(queryAnchor, queryAnchor + inputTriggerSymbol.length) !== inputTriggerSymbol) {
      closePanel('input_trigger_removed')
      return
    }

    const nextSearchText = text.slice(queryAnchor, cursorOffset)
    if (ctx.triggerInfo?.type === 'input' && isInputQueryTerminated(nextSearchText)) {
      closePanel('input_query_terminated')
      return
    }

    if (ctx.triggerInfo?.type === 'input' && isInputQueryRestarted(nextSearchText, inputTriggerSymbol)) {
      closePanel('input_trigger_restarted')
      return
    }

    if (ctx.triggerInfo?.type === 'input' && !isInputQueryCursorAtEnd(text, cursorOffset)) {
      closePanel('input_cursor_invalid')
      return
    }

    setInputSearchText(
      getTrackedInputSearchText({
        triggerType: ctx.triggerInfo?.type,
        inputSearchText: nextSearchText,
        initialSearchText: ctx.initialSearchText
      })
    )
    inputAdapter.focus()

    return inputAdapter.subscribeInput?.((event) => {
      if (event?.isComposing) return
      updateSearchFromInput()
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
      if (
        ctx.readOnly &&
        ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Tab', 'Enter', 'NumpadEnter'].includes(e.key)
      ) {
        e.preventDefault()
        e.stopPropagation()
        setIsMouseOver(false)
        return true
      }
      if (ctx.readOnly && e.key === 'ArrowRight' && assistivePressed) {
        e.preventDefault()
        e.stopPropagation()
        setIsMouseOver(false)
        return true
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
          const nonPinnedCount = list.filter((i) => !i.alwaysVisible && !i.fixedToBottom).length
          const isCollapsed = !ctx.manageListExternally && hasSearch && nonPinnedCount === 0
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
          const nonPinnedCount = list.filter((i) => !i.alwaysVisible && !i.fixedToBottom).length
          const isCollapsed = !ctx.manageListExternally && hasSearch && nonPinnedCount === 0
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
    if (!footerRef.current) return

    const footerElement = footerRef.current
    const updateFooterMetrics = () => {
      setFooterWidth(footerElement.clientWidth)
      const nextChromeHeight =
        footerElement.clientHeight > 0 ? footerElement.clientHeight + QUICK_PANEL_BODY_CHROME_VERTICAL_SPACE : null
      setMeasuredChromeHeight((prev) => (prev === nextChromeHeight ? prev : nextChromeHeight))
    }

    updateFooterMetrics()
    if (typeof ResizeObserver === 'undefined') return

    const resizeObserver = new ResizeObserver(updateFooterMetrics)
    resizeObserver.observe(footerElement)

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
  const visibleNonPinnedCount = useMemo(
    () => list.filter((item) => !item.alwaysVisible && !item.fixedToBottom).length,
    [list]
  )
  const collapsed = !ctx.manageListExternally && hasSearchText && visibleNonPinnedCount === 0
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
            focused: !ctx.readOnly && itemIndex === activeIndex,
            selected: !ctx.readOnly && item.isSelected,
            disabled: item.disabled
          })}
          active={!ctx.readOnly && itemIndex === activeIndex}
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
        ctx.isVisible ? 'transition-[max-height] duration-200 ease-in-out' : 'transition-none',
        ctx.isVisible ? 'overflow-visible' : 'overflow-hidden',
        ctx.isVisible && 'visible',
        ctx.isVisible ? 'pointer-events-auto' : 'pointer-events-none'
      )}
      data-testid="quick-panel">
      <div
        ref={bodyRef}
        data-testid="quick-panel-body"
        style={constrainBody ? { height: panelMaxHeight } : undefined}
        className={classNames(
          'relative isolate transform-gpu rounded-xl border border-border/80 bg-popover py-1.25 text-popover-foreground transition-[translate,scale,opacity,box-shadow] duration-200 ease-out will-change-transform motion-reduce:translate-y-0 motion-reduce:scale-100 motion-reduce:opacity-100 motion-reduce:transition-none [&::-webkit-scrollbar]:w-0.75',
          constrainBody && 'flex flex-col justify-end',
          ctx.isVisible
            ? classNames('translate-y-0 scale-100 opacity-100', 'shadow-none')
            : 'translate-y-3 scale-[0.985] opacity-0 shadow-none'
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
        {!collapsed || fixedBottomItems.length > 0 ? (
          <div
            className="relative shrink-0"
            data-testid="quick-panel-list-region"
            style={{ height: (collapsed ? 0 : listHeight) + fixedBottomHeight }}>
            {!collapsed ? (
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
            ) : null}
            {fixedBottomItems.length > 0 ? (
              <div className="absolute right-0 bottom-0 left-0 bg-popover" data-testid="quick-panel-fixed-bottom">
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
