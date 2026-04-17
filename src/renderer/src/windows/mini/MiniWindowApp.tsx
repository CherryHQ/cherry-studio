import '@renderer/databases'

import { usePreference } from '@data/hooks/usePreference'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { getToastUtilities } from '@renderer/components/TopView/toast'
import { persistor } from '@renderer/store'
import { useEffect } from 'react'
import { PersistGate } from 'redux-persist/integration/react'

import AntdProvider from '../../context/AntdProvider'
import { CodeStyleProvider } from '../../context/CodeStyleProvider'
import { ThemeProvider } from '../../context/ThemeProvider'
import HomeWindow from './home/HomeWindow'

// Initialize toast once at module level (advanced-init-once)
window.toast = getToastUtilities()

function MiniWindowContent(): React.ReactElement {
  const [customCss] = usePreference('ui.custom_css')

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

/**
 * No react-redux `<Provider>`: assistant data reads via DataApi (useQuery),
 * the remaining legacy synchronous accesses (e.g. `getTranslateModel()` reading
 * `store.getState().llm`) only need the store singleton to be rehydrated.
 * PersistGate waits for that rehydration.
 */
function MiniWindow(): React.ReactElement {
  return (
    // TODO: remove this persistgate after v2 refactor
    <PersistGate loading={null} persistor={persistor}>
      <ThemeProvider>
        <AntdProvider>
          <CodeStyleProvider>
            <ErrorBoundary>
              <MiniWindowContent />
            </ErrorBoundary>
          </CodeStyleProvider>
        </AntdProvider>
      </ThemeProvider>
    </PersistGate>
  )
}

export default MiniWindow
