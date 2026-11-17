import type { FC } from 'react'

import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { ThemeProvider } from '@renderer/components/ThemeProvider'
import { WindowFatalFallback } from '@renderer/components/WindowFatalFallback'
import { useCustomCss } from '@renderer/hooks/useCustomCss'
import { useLanguageSync } from '@renderer/hooks/useLanguageSync'
import { useUiClickTracking } from '@renderer/hooks/useUsageAnalytics'

import SelectionCapsuleStack from './SelectionCapsuleStack'

function SelectionCapsuleRuntime(): null {
  useLanguageSync()
  useUiClickTracking('selection')
  useCustomCss()
  return null
}

const SelectionCapsuleApp: FC = () => {
  return (
    <ErrorBoundary fallbackComponent={WindowFatalFallback}>
      <ThemeProvider>
        <SelectionCapsuleRuntime />
        <SelectionCapsuleStack />
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default SelectionCapsuleApp
