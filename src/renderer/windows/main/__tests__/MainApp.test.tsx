import '@testing-library/jest-dom/vitest'

import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../onboarding/OnboardingPage', () => ({
  default: ({ onComplete }: { onComplete: () => void }) => (
    <button type="button" data-testid="onboarding-page" onClick={onComplete}>
      onboarding
    </button>
  )
}))

vi.mock('@renderer/components/layout/TabsProvider', () => ({
  TabsProvider: ({ children }: { children: ReactNode }) => <div data-testid="tabs-provider">{children}</div>
}))

vi.mock('@renderer/components/layout/AppShell', () => ({
  AppShell: () => <div data-testid="app-shell">app-shell</div>
}))

vi.mock('@renderer/hooks/useWindowRuntime', () => ({ useWindowRuntime: () => {} }))
vi.mock('@renderer/hooks/useStorageMonitorNotification', () => ({ useStorageMonitorNotification: () => {} }))
vi.mock('../hooks/useTopicNamingErrorNotification', () => ({ useTopicNamingErrorNotification: () => {} }))
vi.mock('../hooks/useAppUpdateHandler', () => ({ useAppUpdateHandler: () => {} }))
vi.mock('@renderer/components/PopupHost', () => ({ PopupHost: () => null }))
vi.mock('@renderer/components/ToastHost', () => ({ default: () => null }))

vi.mock('@renderer/components/ThemeProvider', () => ({
  ThemeProvider: () => {
    throw new Error('theme provider boom')
  }
}))

import MainApp, { MainWindowContent } from '../MainApp'

describe('MainWindowContent', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders onboarding before the user completes first-run setup', () => {
    MockUsePreferenceUtils.setPreferenceValue('app.onboarding.completed', false)

    render(<MainWindowContent />)

    expect(screen.getByTestId('onboarding-page')).toBeInTheDocument()
    expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument()
  })

  it('marks onboarding complete when the flow completes', async () => {
    MockUsePreferenceUtils.setPreferenceValue('app.onboarding.completed', false)

    const { rerender } = render(<MainWindowContent />)
    fireEvent.click(screen.getByTestId('onboarding-page'))

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('app.onboarding.completed')).toBe(true)
    })

    rerender(<MainWindowContent />)
    expect(screen.getByTestId('app-shell')).toBeInTheDocument()
  })

  it('renders the normal app shell after onboarding is completed', () => {
    MockUsePreferenceUtils.setPreferenceValue('app.onboarding.completed', true)

    render(<MainWindowContent />)

    expect(screen.getByTestId('tabs-provider')).toBeInTheDocument()
    expect(screen.getByTestId('app-shell')).toBeInTheDocument()
    expect(screen.queryByTestId('onboarding-page')).not.toBeInTheDocument()
  })
})

describe('MainApp top-level error boundary', () => {
  it('shows the window fatal fallback instead of a white screen when a provider throws', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const spinner = document.createElement('div')
    spinner.id = 'spinner'
    document.body.appendChild(spinner)

    render(<MainApp />)

    expect(screen.getByRole('alert')).toHaveTextContent('theme provider boom')
    expect(document.getElementById('spinner')).toBeNull()
    consoleError.mockRestore()
  })
})
