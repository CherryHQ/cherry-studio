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

// Initialise toast utilities once at module import (advanced-init-once). The
// selection-toolbar window follows the same pattern — consistent across
// detached windows that don't have a dedicated entry-point bootstrap line.
window.toast = getToastUtilities()

function QuickAssistantContent(): React.ReactElement {
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
 * No react-redux `<Provider>` — the quick-assistant window intentionally stays
 * Redux-Provider-free (continuation of b5343606a). All legacy `state.*` accesses
 * downstream are routed through synchronous helpers (`getAssistantById`,
 * `getDefaultModel`, `getTranslateModel` in `AssistantService`) that read
 * `store.getState()` directly. That only requires the store singleton to be
 * rehydrated, which the single `<PersistGate>` below waits for — no nested
 * gate needed.
 *
 * Why not migrate further to DataApi `useQuery('/assistants/:id')`: see the
 * design note above `currentAssistant` in HomeWindow.
 */
function QuickAssistantApp(): React.ReactElement {
  return (
    // TODO: remove this persistgate after v2 refactor
    <PersistGate loading={null} persistor={persistor}>
      <ThemeProvider>
        <AntdProvider>
          <CodeStyleProvider>
            <ErrorBoundary>
              <QuickAssistantContent />
            </ErrorBoundary>
          </CodeStyleProvider>
        </AntdProvider>
      </ThemeProvider>
    </PersistGate>
  )
}

export default QuickAssistantApp
