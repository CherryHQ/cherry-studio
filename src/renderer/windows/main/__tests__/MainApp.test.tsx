import '@testing-library/jest-dom/vitest'

import { LATEST_PRIVACY_POLICY_VERSION } from '@shared/utils/constants'
import { mockUseMultiplePreferences, MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../onboarding/OnboardingPage', () => ({
  default: ({
    onComplete
  }: {
    onComplete: (status: 'completed' | 'skipped', dataCollectionEnabled: boolean) => Promise<void>
  }) => (
    <>
      <button
        type="button"
        data-testid="onboarding-page"
        onClick={() => {
          void onComplete('completed', false).catch(() => {})
        }}>
        onboarding
      </button>
      <button
        type="button"
        data-testid="skip-onboarding"
        onClick={() => {
          void onComplete('skipped', true).catch(() => {})
        }}>
        skip
      </button>
    </>
  )
}))

vi.mock('../privacy/PrivacyPolicyUpdateGate', () => ({
  PrivacyPolicyUpdateGate: ({ open, onAcknowledge }: { open: boolean; onAcknowledge: () => Promise<void> }) =>
    open ? (
      <button type="button" data-testid="privacy-policy-gate" onClick={() => void onAcknowledge()}>
        privacy-policy-gate
      </button>
    ) : null
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
    MockUsePreferenceUtils.setPreferenceValue('app.onboarding.provider_setup.status', 'pending')

    render(<MainWindowContent />)

    expect(screen.getByTestId('onboarding-page')).toBeInTheDocument()
    expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument()
    expect(screen.queryByTestId('privacy-policy-gate')).not.toBeInTheDocument()
  })

  it('atomically records completion, the latest policy, and the current data collection choice', async () => {
    MockUsePreferenceUtils.setPreferenceValue('app.onboarding.provider_setup.status', 'pending')
    MockUsePreferenceUtils.setPreferenceValue('app.privacy.data_collection.enabled', false)

    const { rerender } = render(<MainWindowContent />)
    fireEvent.click(screen.getByTestId('onboarding-page'))

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('app.onboarding.provider_setup.status')).toBe('completed')
    })
    expect(MockUsePreferenceUtils.getPreferenceValue('app.privacy.policy_version')).toBe(LATEST_PRIVACY_POLICY_VERSION)
    expect(MockUsePreferenceUtils.getPreferenceValue('app.privacy.data_collection.enabled')).toBe(false)

    rerender(<MainWindowContent />)
    expect(screen.getByTestId('app-shell')).toBeInTheDocument()
  })

  it('marks onboarding skipped when the user chooses to set it up later', async () => {
    MockUsePreferenceUtils.setPreferenceValue('app.onboarding.provider_setup.status', 'pending')

    const { rerender } = render(<MainWindowContent />)
    fireEvent.click(screen.getByTestId('skip-onboarding'))

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('app.onboarding.provider_setup.status')).toBe('skipped')
    })
    expect(MockUsePreferenceUtils.getPreferenceValue('app.privacy.policy_version')).toBe(LATEST_PRIVACY_POLICY_VERSION)

    rerender(<MainWindowContent />)
    expect(screen.getByTestId('app-shell')).toBeInTheDocument()
  })

  it('stays on onboarding when the completion batch fails', async () => {
    const updatePreferences = vi.fn().mockRejectedValue(new Error('write failed'))
    mockUseMultiplePreferences.mockReturnValueOnce([
      {
        providerSetupStatus: 'pending',
        dataCollectionEnabled: true,
        policyVersion: ''
      },
      updatePreferences
    ])

    render(<MainWindowContent />)
    fireEvent.click(screen.getByTestId('onboarding-page'))

    await waitFor(() => expect(updatePreferences).toHaveBeenCalled())
    expect(screen.getByTestId('onboarding-page')).toBeInTheDocument()
    expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument()
  })

  it.each(['completed', 'skipped'] as const)('renders the normal app shell when onboarding is %s', (status) => {
    MockUsePreferenceUtils.setPreferenceValue('app.onboarding.provider_setup.status', status)
    MockUsePreferenceUtils.setPreferenceValue('app.privacy.policy_version', LATEST_PRIVACY_POLICY_VERSION)

    render(<MainWindowContent />)

    expect(screen.getByTestId('tabs-provider')).toBeInTheDocument()
    expect(screen.getByTestId('app-shell')).toBeInTheDocument()
    expect(screen.queryByTestId('onboarding-page')).not.toBeInTheDocument()
    expect(screen.queryByTestId('privacy-policy-gate')).not.toBeInTheDocument()
  })

  it('shows the non-dismissible privacy update gate over the normal app for an outdated policy', () => {
    MockUsePreferenceUtils.setPreferenceValue('app.onboarding.provider_setup.status', 'completed')
    MockUsePreferenceUtils.setPreferenceValue('app.privacy.policy_version', '20240101')

    render(<MainWindowContent />)

    expect(screen.getByTestId('app-shell')).toBeInTheDocument()
    expect(screen.getByTestId('privacy-policy-gate')).toBeInTheDocument()
  })

  it('acknowledges the latest policy and resets data collection to enabled', async () => {
    MockUsePreferenceUtils.setPreferenceValue('app.onboarding.provider_setup.status', 'completed')
    MockUsePreferenceUtils.setPreferenceValue('app.privacy.policy_version', '')
    MockUsePreferenceUtils.setPreferenceValue('app.privacy.data_collection.enabled', false)

    render(<MainWindowContent />)
    fireEvent.click(screen.getByTestId('privacy-policy-gate'))

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('app.privacy.policy_version')).toBe(
        LATEST_PRIVACY_POLICY_VERSION
      )
    })
    expect(MockUsePreferenceUtils.getPreferenceValue('app.privacy.data_collection.enabled')).toBe(true)
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
