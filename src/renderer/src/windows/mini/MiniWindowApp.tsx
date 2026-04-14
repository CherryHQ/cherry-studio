import '@renderer/databases'

import { usePreference } from '@data/hooks/usePreference'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { getToastUtilities } from '@renderer/components/TopView/toast'
import { useEffect } from 'react'

import AntdProvider from '../../context/AntdProvider'
import { CodeStyleProvider } from '../../context/CodeStyleProvider'
import { ThemeProvider } from '../../context/ThemeProvider'
import HomeWindow from './home/HomeWindow'

// Initialize toast once at module level (advanced-init-once)
window.toast = getToastUtilities()

// Inner component that uses the hook after Redux is initialized
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

function MiniWindow(): React.ReactElement {
  return (
    <ThemeProvider>
      <AntdProvider>
        <CodeStyleProvider>
          <ErrorBoundary>
            <MiniWindowContent />
          </ErrorBoundary>
        </CodeStyleProvider>
      </AntdProvider>
    </ThemeProvider>
  )
}

export default MiniWindow
