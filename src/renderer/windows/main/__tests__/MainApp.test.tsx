import '@testing-library/jest-dom/vitest'

import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tabsProviderProps = vi.hoisted(() => ({
  initialDefaultTab: undefined as { url: string } | undefined
}))

vi.mock('../onboarding/OnboardingPage', () => ({
  default: () => <div data-testid="onboarding-page">onboarding</div>
}))

vi.mock('../privacy/PrivacyPolicyUpdateGate', () => ({
  PrivacyPolicyUpdateGate: () => <div data-testid="privacy-policy-gate">privacy-policy-gate</div>
}))

vi.mock('@renderer/components/layout/TabsProvider', () => ({
  TabsProvider: ({ children, initialDefaultTab }: { children: ReactNode; initialDefaultTab?: { url: string } }) => {
    tabsProviderProps.initialDefaultTab = initialDefaultTab
    return <div data-testid="tabs-provider">{children}</div>
  }
}))

vi.mock('@renderer/components/layout/AppShell', () => ({
  AppShell: () => <div data-testid="app-shell">app-shell</div>
}))

vi.mock('@renderer/hooks/useWindowRuntime', () => ({ useWindowRuntime: () => {} }))
vi.mock('@renderer/hooks/tab', () => ({ useMainWindowNavigation: () => {} }))
vi.mock('@renderer/hooks/useStorageMonitorNotification', () => ({ useStorageMonitorNotification: () => {} }))
vi.mock('../hooks/useAutoBackupEvents', () => ({ useAutoBackupEvents: () => {} }))
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

function appendBootSpinner() {
  const spinner = document.createElement('div')
  spinner.id = 'spinner'
  document.body.appendChild(spinner)
}

describe('MainWindowContent', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders onboarding before the user completes first-run setup', () => {
    MockUsePreferenceUtils.setPreferenceValue('app.onboarding.provider_setup.status', 'pending')
    appendBootSpinner()

    render(<MainWindowContent />)

    expect(screen.getByTestId('onboarding-page')).toBeInTheDocument()
    expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument()
    expect(screen.queryByTestId('privacy-policy-gate')).not.toBeInTheDocument()
    expect(document.getElementById('spinner')).toBeNull()
  })

  it.each(['completed', 'skipped'] as const)('renders the normal app shell when onboarding is %s', (status) => {
    MockUsePreferenceUtils.setPreferenceValue('app.onboarding.provider_setup.status', status)

    render(<MainWindowContent />)

    expect(screen.getByTestId('tabs-provider')).toBeInTheDocument()
    expect(screen.getByTestId('app-shell')).toBeInTheDocument()
    expect(screen.queryByTestId('onboarding-page')).not.toBeInTheDocument()
    expect(screen.getByTestId('privacy-policy-gate')).toBeInTheDocument()
  })

  it('lands on the first visible sidebar app as the default tab', () => {
    MockUsePreferenceUtils.setPreferenceValue('ui.sidebar.favorites', [{ type: 'app', id: 'translate' }])
    MockUsePreferenceUtils.setPreferenceValue('feature.paintings.default_provider', 'zhipu')

    render(<MainWindowContent />)

    expect(tabsProviderProps.initialDefaultTab).toMatchObject({ id: 'home', url: '/app/translate' })
  })

  it('resolves the default tab with the paintings provider route for the paintings app', () => {
    MockUsePreferenceUtils.setPreferenceValue('ui.sidebar.favorites', [{ type: 'app', id: 'paintings' }])
    MockUsePreferenceUtils.setPreferenceValue('feature.paintings.default_provider', 'zhipu')

    render(<MainWindowContent />)

    expect(tabsProviderProps.initialDefaultTab).toMatchObject({ id: 'home', url: '/app/paintings/zhipu' })
  })

  it('falls back to the chat assistant when no sidebar app is visible', () => {
    MockUsePreferenceUtils.setPreferenceValue('ui.sidebar.favorites', [{ type: 'mini_app', id: 'calculator' }])

    render(<MainWindowContent />)

    expect(tabsProviderProps.initialDefaultTab).toMatchObject({ id: 'home', url: '/app/chat' })
  })
})

describe('MainApp top-level error boundary', () => {
  it('shows the window fatal fallback instead of a white screen when a provider throws', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    appendBootSpinner()

    render(<MainApp />)

    expect(screen.getByRole('alert')).toHaveTextContent('theme provider boom')
    expect(document.getElementById('spinner')).toBeNull()
    consoleError.mockRestore()
  })
})
