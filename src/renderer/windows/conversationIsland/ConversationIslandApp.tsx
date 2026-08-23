import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { ThemeProvider } from '@renderer/components/ThemeProvider'
import { useCustomCss } from '@renderer/hooks/useCustomCss'
import { useLanguageSync } from '@renderer/hooks/useLanguageSync'
import { ipcApi } from '@renderer/ipc'
import { useEffect } from 'react'

import ConversationIsland from './ConversationIsland'

function ConversationIslandRuntime(): null {
  useLanguageSync()
  useCustomCss()
  return null
}

function DismissOnFatalError(): null {
  useEffect(() => {
    void ipcApi.request('window.close')
  }, [])
  return null
}

export default function ConversationIslandApp() {
  return (
    <ErrorBoundary fallbackComponent={DismissOnFatalError}>
      <ThemeProvider>
        <ConversationIslandRuntime />
        <ConversationIsland />
      </ThemeProvider>
    </ErrorBoundary>
  )
}
