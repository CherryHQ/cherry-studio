import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const toastErrorMock = vi.fn()

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
  })

  it('shows an acknowledgement notice and opens the full policy', () => {
    render(<PrivacyPolicyUpdateGate open onAcknowledge={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'privacy_policy_update.title' })).toBeInTheDocument()
    expect(screen.queryByTestId('full-policy')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'privacy_policy_update.policy' }))

    expect(screen.getByTestId('full-policy')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'privacy_policy_update.title' })).not.toBeInTheDocument()
  })

  it('acknowledges the update from the notice', async () => {
    const onAcknowledge = vi.fn().mockResolvedValue(undefined)
    render(<PrivacyPolicyUpdateGate open onAcknowledge={onAcknowledge} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.i_know' }))

    await waitFor(() => expect(onAcknowledge).toHaveBeenCalledTimes(1))
  })

  it('keeps the gate open and reports an error when acknowledgement fails', async () => {
    const onAcknowledge = vi.fn().mockRejectedValue(new Error('write failed'))
    render(<PrivacyPolicyUpdateGate open onAcknowledge={onAcknowledge} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.i_know' }))

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('privacy_policy_update.acknowledge_failed'))
    expect(screen.getByRole('heading', { name: 'privacy_policy_update.title' })).toBeInTheDocument()
  })

  it('acknowledges the update after reviewing the full policy', async () => {
    const onAcknowledge = vi.fn().mockResolvedValue(undefined)
    render(<PrivacyPolicyUpdateGate open onAcknowledge={onAcknowledge} />)

    fireEvent.click(screen.getByRole('button', { name: 'privacy_policy_update.policy' }))
    fireEvent.click(screen.getByTestId('full-policy'))

    await waitFor(() => expect(onAcknowledge).toHaveBeenCalledTimes(1))
  })
})
