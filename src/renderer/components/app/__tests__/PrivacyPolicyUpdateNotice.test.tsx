import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  PrivacyPopup: {
    show: vi.fn()
  },
  TopView: {
    hide: vi.fn(),
    show: vi.fn()
  },
  windowApi: {
    config: {
      set: vi.fn()
    }
  }
}))

vi.mock('@renderer/components/Popups/PrivacyPopup', () => ({
  default: mocks.PrivacyPopup
}))

vi.mock('@renderer/components/TopView', () => ({
  TopView: mocks.TopView
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    init: vi.fn(),
    type: '3rdParty'
  },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

async function renderNotice() {
  const { default: PrivacyPolicyUpdateNotice } = await import('../PrivacyPolicyUpdateNotice')

  const promise = PrivacyPolicyUpdateNotice.show()
  const rendered = mocks.TopView.show.mock.calls[0][0] as React.ReactNode

  render(<>{rendered}</>)
  return { promise }
}

describe('PrivacyPolicyUpdateNotice', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('api', mocks.windowApi)
    MockUsePreferenceUtils.resetMocks()
    mocks.windowApi.config.set.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('acknowledges the latest privacy policy and enables data collection', async () => {
    const { promise } = await renderNotice()

    fireEvent.click(screen.getByText('common.i_know'))

    expect(MockUsePreferenceUtils.getPreferenceValue('app.privacy.policy_version')).toBe('20260531')
    expect(MockUsePreferenceUtils.getPreferenceValue('app.privacy.data_collection.enabled')).toBe(true)
    expect(mocks.windowApi.config.set).toHaveBeenCalledWith('enableDataCollection', true)

    act(() => {
      vi.advanceTimersByTime(200)
    })
    await expect(promise).resolves.toEqual({})
    expect(mocks.TopView.hide).toHaveBeenCalledWith('PrivacyPolicyUpdateNotice')
  })

  it('opens the full policy popup and acknowledges when accepted there', async () => {
    await renderNotice()

    fireEvent.click(screen.getByText('privacy_policy_update.policy'))

    expect(mocks.PrivacyPopup.show).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptButtonText: 'common.i_know',
        force: true,
        modal: true,
        quitOnDecline: false,
        showDeclineButton: false
      })
    )

    const showParams = mocks.PrivacyPopup.show.mock.calls[0][0]
    showParams.onAccepted()

    expect(MockUsePreferenceUtils.getPreferenceValue('app.privacy.policy_version')).toBe('20260531')
    expect(MockUsePreferenceUtils.getPreferenceValue('app.privacy.data_collection.enabled')).toBe(true)
    expect(mocks.windowApi.config.set).toHaveBeenCalledWith('enableDataCollection', true)
  })
})
