import { ToastProvider, useToasts } from '@renderer/components/TopView/toast'
import AntdProvider from '@renderer/context/AntdProvider'
import { CodeStyleProvider } from '@renderer/context/CodeStyleProvider'
import { ThemeProvider } from '@renderer/context/ThemeProvider'
import store from '@renderer/store'
import type { FC } from 'react'
import { useEffect } from 'react'
import { Provider } from 'react-redux'

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
    <Provider store={store}>
      <ThemeProvider>
        <AntdProvider>
          <CodeStyleProvider>
            <ToastProvider>
              <SelectionActionToastBridge />
            </ToastProvider>
          </CodeStyleProvider>
        </AntdProvider>
      </ThemeProvider>
    </Provider>
  )
}

export default SelectionActionApp
