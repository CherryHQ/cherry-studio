import { ToastProvider, useToasts } from '@renderer/components/TopView/toast'
import AntdProvider from '@renderer/context/AntdProvider'
import { CodeStyleProvider } from '@renderer/context/CodeStyleProvider'
import { ThemeProvider } from '@renderer/context/ThemeProvider'
import store, { persistor } from '@renderer/store'
import type { FC } from 'react'
import { useEffect } from 'react'
import { Provider } from 'react-redux'
import { PersistGate } from 'redux-persist/integration/react'

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
            <PersistGate loading={null} persistor={persistor}>
              <ToastProvider>
                <SelectionActionToastBridge />
              </ToastProvider>
            </PersistGate>
          </CodeStyleProvider>
        </AntdProvider>
      </ThemeProvider>
    </Provider>
  )
}

export default SelectionActionApp
