import '@testing-library/jest-dom/vitest'

import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAutoBackupDispose, mockAutoBackupInitialize } = vi.hoisted(() => ({
  mockAutoBackupDispose: vi.fn(),
  mockAutoBackupInitialize: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../onboarding/OnboardingPage', () => ({
  default: () => <div data-testid="onboarding-page">onboarding</div>
}))

vi.mock('../privacy/PrivacyPolicyUpdateGate', () => ({
  PrivacyPolicyUpdateGate: () => <div data-testid="privacy-policy-gate">privacy-policy-gate</div>
}))

vi.mock('@renderer/components/layout/TabsProvider', () => ({
  TabsProvider: ({ children }: { children: ReactNode }) => <div data-testid="tabs-provider">{children}</div>
}))

vi.mock('@renderer/components/layout/AppShell', () => ({
  AppShell: () => <div data-testid="app-shell">app-shell</div>
}))

vi.mock('@renderer/hooks/useWindowRuntime', () => ({ useWindowRuntime: () => {} }))
vi.mock('@renderer/hooks/tab', () => ({ useMainWindowNavigation: () => {} }))
vi.mock('@renderer/hooks/useStorageMonitorNotification', () => ({ useStorageMonitorNotification: () => {} }))
vi.mock('../hooks/useTopicNamingErrorNotification', () => ({ useTopicNamingErrorNotification: () => {} }))
vi.mock('../hooks/useAppUpdateHandler', () => ({ useAppUpdateHandler: () => {} }))
vi.mock('@renderer/components/PopupHost', () => ({ PopupHost: () => null }))
vi.mock('@renderer/components/ToastHost', () => ({ default: () => null }))
vi.mock('@renderer/services/AutoBackupService', () => ({
  autoBackupService: {
    dispose: mockAutoBackupDispose,
    initialize: mockAutoBackupInitialize
  }
}))

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
    mockAutoBackupDispose.mockClear()
    mockAutoBackupInitialize.mockClear()
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

  it('owns the automatic backup scheduler for the main-window lifetime', () => {
    MockUsePreferenceUtils.setPreferenceValue('app.onboarding.provider_setup.status', 'completed')

    const { unmount } = render(<MainWindowContent />)

    expect(mockAutoBackupInitialize).toHaveBeenCalledOnce()
    unmount()
    expect(mockAutoBackupDispose).toHaveBeenCalledOnce()
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
