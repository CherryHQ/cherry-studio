import { ToastProvider, useToasts } from '@renderer/components/TopView/toast'
import { CodeStyleProvider } from '@renderer/context/CodeStyleProvider'
import { ThemeProvider } from '@renderer/context/ThemeProvider'
import type { FC } from 'react'
import { useEffect } from 'react'

import ActionWindow from './ActionWindow'

const SelectionActionToastBridge: FC = () => {
  const toast = useToasts()

  useEffect(() => {
    window.toast = toast
  }, [toast])

  return <ActionWindow />
}

const SelectionActionApp: FC = () => {
  return (
    <ThemeProvider>
      <CodeStyleProvider>
        <ToastProvider>
          <SelectionActionToastBridge />
        </ToastProvider>
      </CodeStyleProvider>
    </ThemeProvider>
  )
}

export default SelectionActionApp
