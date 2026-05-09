import '@renderer/databases'

import { usePreference } from '@data/hooks/usePreference'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { ToastProvider, useToasts } from '@renderer/components/TopView/toast'
import store, { persistor } from '@renderer/store'
import { useEffect } from 'react'
import { Provider } from 'react-redux'
import { PersistGate } from 'redux-persist/integration/react'

import AntdProvider from '../../context/AntdProvider'
import { CodeStyleProvider } from '../../context/CodeStyleProvider'
import { ThemeProvider } from '../../context/ThemeProvider'
import HomeWindow from './home/HomeWindow'

// Inner component that uses the hook after Redux is initialized
function QuickAssistantContent(): React.ReactElement {
  const [customCss] = usePreference('ui.custom_css')
  const toast = useToasts()

  useEffect(() => {
    window.toast = toast
  }, [toast])

  useEffect(() => {
    let customCssElement = document.getElementById('user-defined-custom-css') as HTMLStyleElement
    if (customCssElement) {
      customCssElement.remove()
    }

    if (customCss) {
      customCssElement = document.createElement('style')
      customCssElement.id = 'user-defined-custom-css'
      customCssElement.textContent = customCss
      document.head.appendChild(customCssElement)
    }
  }, [customCss])

  return <HomeWindow />
}

function QuickAssistantApp(): React.ReactElement {
  return (
    <Provider store={store}>
      <ThemeProvider>
        <AntdProvider>
          <CodeStyleProvider>
            <PersistGate loading={null} persistor={persistor}>
              <ErrorBoundary>
                <ToastProvider>
                  <QuickAssistantContent />
                </ToastProvider>
              </ErrorBoundary>
            </PersistGate>
          </CodeStyleProvider>
        </AntdProvider>
      </ThemeProvider>
    </Provider>
  )
}

export default QuickAssistantApp
