import { usePreference } from '@data/hooks/usePreference'
import { CodeStyleProvider } from '@renderer/components/CodeStyleProvider'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { PopupHost } from '@renderer/components/PopupHost'
import { ThemeProvider } from '@renderer/components/ThemeProvider'
import ToastHost from '@renderer/components/ToastHost'
import { useEffect } from 'react'

import HomeWindow from './home/HomeWindow'

// The <ToastHost/> below renders the toast viewport this window previously lacked
// (the toast black hole), so translate/copy toasts are finally visible.
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
          <PopupHost />
          <ToastHost />
        </ErrorBoundary>
      </CodeStyleProvider>
    </ThemeProvider>
  )
}

export default QuickAssistantApp
