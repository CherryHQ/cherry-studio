import '@renderer/databases'

import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { ToastPortal } from '@renderer/components/ToastPortal'
import { getToastUtilities } from '@renderer/components/TopView/toast'
import { HeroUIProvider } from '@renderer/context/HeroUIProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import store, { persistor } from '@renderer/store'
import { useEffect } from 'react'
import { Provider } from 'react-redux'
import { PersistGate } from 'redux-persist/integration/react'

import AntdProvider from '../../context/AntdProvider'
import { CodeStyleProvider } from '../../context/CodeStyleProvider'
import { ThemeProvider } from '../../context/ThemeProvider'
import HomeWindow from './home/HomeWindow'

// Inner component that uses the hook after Redux is initialized
function MiniWindowContent(): React.ReactElement {
  const { customCss } = useSettings()

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

function MiniWindow(): React.ReactElement {
  useEffect(() => {
    window.toast = getToastUtilities()
  }, [])

  return (
    <Provider store={store}>
      <HeroUIProvider>
        <ThemeProvider>
          <AntdProvider>
            <CodeStyleProvider>
              <PersistGate loading={null} persistor={persistor}>
                <ErrorBoundary>
                  <MiniWindowContent />
                </ErrorBoundary>
              </PersistGate>
            </CodeStyleProvider>
          </AntdProvider>
        </ThemeProvider>
        <ToastPortal />
      </HeroUIProvider>
    </Provider>
  )
}

export default MiniWindow
