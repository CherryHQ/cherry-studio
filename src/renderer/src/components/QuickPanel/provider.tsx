import React, { createContext, useCallback, useMemo, useState } from 'react'

import {
  QuickPanelCallBackOptions,
  QuickPanelCloseAction,
  QuickPanelContextType,
  QuickPanelListItem,
  QuickPanelOpenOptions
} from './types'

const QuickPanelContext = createContext<QuickPanelContextType | null>(null)

export const QuickPanelProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [isVisible, setIsVisible] = useState(false)
  const [symbol, setSymbol] = useState<string>('')

  const [list, setList] = useState<QuickPanelListItem[]>([])
  const [title, setTitle] = useState<string | undefined>()
  const [defaultIndex, setDefaultIndex] = useState<number>(0)
  const [pageSize, setPageSize] = useState<number>(7)
  const [multiple, setMultiple] = useState<boolean>(false)
  const [onClose, setOnClose] = useState<
    ((Options: Pick<QuickPanelCallBackOptions, 'symbol' | 'action'>) => void) | undefined
  >()
  const [beforeAction, setBeforeAction] = useState<((Options: QuickPanelCallBackOptions) => void) | undefined>()
  const [afterAction, setAfterAction] = useState<((Options: QuickPanelCallBackOptions) => void) | undefined>()

  const open = useCallback((options: QuickPanelOpenOptions) => {
    setTitle(options.title)
    setList(options.list)
    setDefaultIndex(options.defaultIndex ?? 0)
    setPageSize(options.pageSize ?? 7)
    setMultiple(options.multiple ?? false)
    setSymbol(options.symbol)

    setOnClose(() => options.onClose)
    setBeforeAction(() => options.beforeAction)
    setAfterAction(() => options.afterAction)

    setIsVisible(true)
  }, [])

  const close = useCallback(
    (action?: QuickPanelCloseAction) => {
      setIsVisible(false)
      onClose?.({ symbol, action })

      setTimeout(() => {
        setList([])
        setOnClose(undefined)
        setBeforeAction(undefined)
        setAfterAction(undefined)
        setTitle(undefined)
        setSymbol('')
      }, 200)
    },
    [onClose, symbol]
  )

  const value = useMemo(
    () => ({
      open,
      close,

      isVisible,
      symbol,

      list,
      title,
      defaultIndex,
      pageSize,
      multiple,
      onClose,
      beforeAction,
      afterAction
    }),
    [open, close, isVisible, symbol, list, title, defaultIndex, pageSize, multiple, onClose, beforeAction, afterAction]
  )

  return <QuickPanelContext value={value}>{children}</QuickPanelContext>
}

export { QuickPanelContext }
