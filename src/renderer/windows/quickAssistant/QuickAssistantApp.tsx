import { usePreference } from '@data/hooks/usePreference'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { getToastUtilities, useToasts } from '@renderer/components/TopView/toast'
import { useEffect } from 'react'

import { CodeStyleProvider } from '../../context/CodeStyleProvider'
import { ThemeProvider } from '../../context/ThemeProvider'
import HomeWindow from './home/HomeWindow'

// Initialise toast utilities once at module import (advanced-init-once). The
// selection-toolbar window follows the same pattern — consistent across
// detached windows that don't have a dedicated entry-point bootstrap line.
window.toast = getToastUtilities()

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

/**
 * No Redux `<Provider>` — the quick-assistant window intentionally stays
 * Redux-Provider-free (continuation of b5343606a). Downstream assistant/model
 * data now comes from the v2 Preference + DataApi layer (`usePreference`,
 * `useQuery('/models/:id')` via assistant hooks / `useDefaultModel`), so
 * there is no dependency on Redux rehydration and no `<PersistGate>` is needed.
 *
 * Why not migrate further to DataApi `useQuery('/assistants/:id')`: see the
 * design note above `currentAssistant` in HomeWindow.
 */
function QuickAssistantApp(): React.ReactElement {
  return (
    <ThemeProvider>
      <CodeStyleProvider>
        <ErrorBoundary>
          <QuickAssistantContent />
        </ErrorBoundary>
      </CodeStyleProvider>
    </ThemeProvider>
  )
}

export default QuickAssistantApp
