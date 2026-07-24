import '@testing-library/jest-dom/vitest'

import { LATEST_PRIVACY_POLICY_VERSION } from '@shared/utils/constants'
import { mockUsePreference, MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const toastErrorMock = vi.fn()
const defaultUsePreferenceImplementation = mockUsePreference.getMockImplementation()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/services/toast', () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args)
  }
}))

vi.mock('../PrivacyPolicyDialog', () => ({
  PrivacyPolicyDialog: ({ open, onAccept }: { open: boolean; onAccept: () => void }) =>
    open ? (
      <button type="button" data-testid="full-policy" onClick={onAccept}>
        full-policy
      </button>
    ) : null
}))

import { PrivacyPolicyUpdateGate } from '../PrivacyPolicyUpdateGate'

describe('PrivacyPolicyUpdateGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    if (defaultUsePreferenceImplementation) {
      mockUsePreference.mockImplementation(defaultUsePreferenceImplementation)
    }
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('app.privacy.policy_version', '')
  })

  it('shows an acknowledgement notice and opens the full policy', () => {
    render(<PrivacyPolicyUpdateGate />)

    expect(screen.getByRole('heading', { name: 'privacy_policy_update.title' })).toBeInTheDocument()
    expect(screen.queryByTestId('full-policy')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'privacy_policy_update.policy' }))

    expect(screen.getByTestId('full-policy')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'privacy_policy_update.title' })).not.toBeInTheDocument()
  })

  it('does not show the gate when the latest policy is already acknowledged', () => {
    MockUsePreferenceUtils.setPreferenceValue('app.privacy.policy_version', LATEST_PRIVACY_POLICY_VERSION)

    render(<PrivacyPolicyUpdateGate />)

    expect(screen.queryByRole('heading', { name: 'privacy_policy_update.title' })).not.toBeInTheDocument()
  })

  it('acknowledges the update from the notice without changing data collection', async () => {
    MockUsePreferenceUtils.setPreferenceValue('app.privacy.data_collection.enabled', false)
    render(<PrivacyPolicyUpdateGate />)

    fireEvent.click(screen.getByRole('button', { name: 'common.i_know' }))

    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('app.privacy.policy_version')).toBe(
        LATEST_PRIVACY_POLICY_VERSION
      )
    )
    expect(MockUsePreferenceUtils.getPreferenceValue('app.privacy.data_collection.enabled')).toBe(false)
  })

  it('keeps the gate open and reports an error when acknowledgement fails', async () => {
    MockUsePreferenceUtils.mockPreferenceError('app.privacy.policy_version', new Error('write failed'))
    render(<PrivacyPolicyUpdateGate />)

    fireEvent.click(screen.getByRole('button', { name: 'common.i_know' }))

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('privacy_policy_update.acknowledge_failed'))
    expect(screen.getByRole('heading', { name: 'privacy_policy_update.title' })).toBeInTheDocument()
  })

  it('cannot be dismissed with Escape or an outside pointer action', () => {
    render(<PrivacyPolicyUpdateGate />)

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    fireEvent.pointerDown(document.body)

    expect(screen.getByRole('heading', { name: 'privacy_policy_update.title' })).toBeInTheDocument()
    expect(MockUsePreferenceUtils.getPreferenceValue('app.privacy.policy_version')).toBe('')
  })

  it('acknowledges the update after reviewing the full policy', async () => {
    render(<PrivacyPolicyUpdateGate />)

    fireEvent.click(screen.getByRole('button', { name: 'privacy_policy_update.policy' }))
    fireEvent.click(screen.getByTestId('full-policy'))

    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('app.privacy.policy_version')).toBe(
        LATEST_PRIVACY_POLICY_VERSION
      )
    )
  })
})
