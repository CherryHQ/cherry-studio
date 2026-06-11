import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  QuickPanelCallBackOptions,
  QuickPanelCloseAction,
  QuickPanelContextType,
  QuickPanelFilterFn,
  QuickPanelKeyDownEvent,
  QuickPanelKeyDownHandler,
  QuickPanelListItem,
  QuickPanelOpenOptions,
  QuickPanelSortFn,
  QuickPanelTriggerInfo
} from './types'
const QuickPanelContext = createContext<QuickPanelContextType | null>(null)

export const QuickPanelProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [isVisible, setIsVisible] = useState(false)
  const [symbol, setSymbol] = useState<string>('')

  const [list, setList] = useState<QuickPanelListItem[]>([])
  const [title, setTitle] = useState<string | undefined>()
  const [defaultIndex, setDefaultIndex] = useState<number>(-1)
  const [pageSize, setPageSize] = useState<number>(7)
  const [multiple, setMultiple] = useState<boolean>(false)
  const [readOnly, setReadOnly] = useState<boolean>(false)
  const [manageListExternally, setManageListExternally] = useState<boolean>(false)
  const [triggerInfo, setTriggerInfo] = useState<QuickPanelTriggerInfo | undefined>()
  const [queryAnchor, setQueryAnchor] = useState<number | undefined>()
  const [trackInputQuery, setTrackInputQuery] = useState<boolean>(false)
  const [parentPanel, setParentPanel] = useState<QuickPanelOpenOptions | undefined>()
  const [filterFn, setFilterFn] = useState<QuickPanelFilterFn | undefined>()
  const [sortFn, setSortFn] = useState<QuickPanelSortFn | undefined>()
  const [onClose, setOnClose] = useState<((Options: Partial<QuickPanelCallBackOptions>) => void) | undefined>()
  const [beforeAction, setBeforeAction] = useState<((Options: QuickPanelCallBackOptions) => void) | undefined>()
  const [afterAction, setAfterAction] = useState<((Options: QuickPanelCallBackOptions) => void) | undefined>()
  const [lastCloseAction, setLastCloseAction] = useState<QuickPanelCloseAction | undefined>(undefined)
  const [fillToAvailableHeight, setFillToAvailableHeight] = useState(false)

  const clearTimer = useRef<number | null>(null)
  const keyDownHandlerRef = useRef<QuickPanelKeyDownHandler | undefined>(undefined)
  const isMountedRef = useRef(true)
  const isVisibleRef = useRef(isVisible)
  const panelGenerationRef = useRef(0)
  const generatedItemIdsRef = useRef(new WeakMap<QuickPanelListItem, string>())
  const generatedItemIdCounterRef = useRef(0)

  isVisibleRef.current = isVisible

  const ensureListItemIds = useCallback((items: QuickPanelListItem[]) => {
    const usedIds = new Set<string>()

    return items.map((item, index) => {
      if (item.id && !usedIds.has(item.id)) {
        usedIds.add(item.id)
        return item
      }

      let id = generatedItemIdsRef.current.get(item)
      if (!id || usedIds.has(id)) {
        id = `quick-panel-item-${panelGenerationRef.current}-${index}-${generatedItemIdCounterRef.current}`
        generatedItemIdCounterRef.current += 1
        generatedItemIdsRef.current.set(item, id)
      }

      usedIds.add(id)
      return { ...item, id }
    })
  }, [])

  // 添加更新item选中状态的方法
  const updateItemSelection = useCallback((targetItem: QuickPanelListItem, isSelected: boolean) => {
    setList((prevList) => {
      // 先尝试引用匹配（快速路径）
      const refIndex = prevList.findIndex((item) => item === targetItem)
      if (refIndex !== -1) {
        return prevList.map((item, idx) => (idx === refIndex ? { ...item, isSelected } : item))
      }

      if (!targetItem.id) return prevList

      return prevList.map((item) => (item.id === targetItem.id ? { ...item, isSelected } : item))
    })
  }, [])

  // 添加更新整个列表的方法
  const updateList = useCallback(
    (newList: QuickPanelListItem[]) => {
      setList(ensureListItemIds(newList))
    },
    [ensureListItemIds]
  )

  const open = useCallback(
    (options: QuickPanelOpenOptions) => {
      if (clearTimer.current) {
        window.clearTimeout(clearTimer.current)
        clearTimer.current = null
      }

      panelGenerationRef.current += 1
      setLastCloseAction(undefined)
      setTitle(options.title)
      setList(ensureListItemIds(options.list))
      const nextDefaultIndex = typeof options.defaultIndex === 'number' ? Math.max(-1, options.defaultIndex) : -1
      setDefaultIndex(nextDefaultIndex)
      setPageSize(options.pageSize ?? 7)
      setMultiple(options.multiple ?? false)
      setReadOnly(options.readOnly ?? false)
      setManageListExternally(options.manageListExternally ?? false)
      setSymbol(options.symbol)
      setTriggerInfo(options.triggerInfo)
      setQueryAnchor(options.queryAnchor ?? options.triggerInfo?.position)
      setTrackInputQuery(options.trackInputQuery ?? false)
      setParentPanel(options.parentPanel)

      setOnClose(() => options.onClose)
      setBeforeAction(() => options.beforeAction)
      setAfterAction(() => options.afterAction)
      setFilterFn(() => options.filterFn)
      setSortFn(() => options.sortFn)

      // dispatchKeyDown is imperative and can run before React commits this state update.
      isVisibleRef.current = true
      setIsVisible(true)
    },
    [ensureListItemIds]
  )

  const close = useCallback(
    (action?: QuickPanelCloseAction, searchText?: string) => {
      if (!isMountedRef.current) return

      // Keep imperative key dispatch in sync with close before React commits.
      isVisibleRef.current = false
      setIsVisible(false)
      setManageListExternally(false)
      setTrackInputQuery(false)
      setReadOnly(false)
      setLastCloseAction(action)
      onClose?.({ action, searchText, item: {} as QuickPanelListItem, context: this })

      clearTimer.current = window.setTimeout(() => {
        clearTimer.current = null
        if (!isMountedRef.current) return

        setList([])
        setOnClose(undefined)
        setBeforeAction(undefined)
        setAfterAction(undefined)
        setFilterFn(undefined)
        setSortFn(undefined)
        setTitle(undefined)
        setSymbol('')
        setTriggerInfo(undefined)
        setQueryAnchor(undefined)
        setTrackInputQuery(false)
        setParentPanel(undefined)
        setManageListExternally(false)
        setReadOnly(false)
      }, 200)
    },
    [onClose]
  )

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
      if (clearTimer.current) {
        window.clearTimeout(clearTimer.current)
        clearTimer.current = null
      }
    }
  }, [])

  const registerKeyDownHandler = useCallback((handler: QuickPanelKeyDownHandler | undefined) => {
    keyDownHandlerRef.current = handler

    return () => {
      if (keyDownHandlerRef.current === handler) {
        keyDownHandlerRef.current = undefined
      }
    }
  }, [])

  const dispatchKeyDown = useCallback((event: QuickPanelKeyDownEvent) => {
    if (!isVisibleRef.current) return false
    return keyDownHandlerRef.current?.(event) ?? false
  }, [])

  const getPanelGeneration = useCallback(() => panelGenerationRef.current, [])

  const value = useMemo(
    () => ({
      open,
      close,
      updateItemSelection,
      updateList,

      isVisible,
      symbol,

      list,
      title,
      defaultIndex,
      pageSize,
      multiple,
      readOnly,
      manageListExternally,
      triggerInfo,
      queryAnchor,
      trackInputQuery,
      parentPanel,
      lastCloseAction,
      filterFn,
      sortFn,
      fillToAvailableHeight,
      setFillToAvailableHeight,
      dispatchKeyDown,
      getPanelGeneration,
      registerKeyDownHandler,
      onClose,
      beforeAction,
      afterAction
    }),
    [
      open,
      close,
      updateItemSelection,
      updateList,
      dispatchKeyDown,
      getPanelGeneration,
      registerKeyDownHandler,
      isVisible,
      symbol,
      list,
      title,
      defaultIndex,
      pageSize,
      multiple,
      readOnly,
      manageListExternally,
      triggerInfo,
      queryAnchor,
      trackInputQuery,
      parentPanel,
      lastCloseAction,
      filterFn,
      sortFn,
      fillToAvailableHeight,
      onClose,
      beforeAction,
      afterAction
    ]
  )

  return <QuickPanelContext value={value}>{children}</QuickPanelContext>
}

export { QuickPanelContext }
