import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'

const request = vi.hoisted(() => vi.fn())
vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))
vi.mock('@cherrystudio/ui', async (original) => original())

import BlacklistSubscriptionSettings from '../components/BlacklistSubscriptionSettings'

// Protect AC1/AC2 and repeated Enter: invalid input must never reach persistence,
// and a pending add must not create duplicate sources even though Enter bypasses a disabled button.
describe('BlacklistSubscriptionSettings', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
    request.mockReset()
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.blacklist_subscriptions', [])
  })

  it('rejects a non-HTTP URL, then adds once and displays the stored rule count', async () => {
    const user = userEvent.setup()
    const view = render(<BlacklistSubscriptionSettings />)
    const input = screen.getByRole('textbox', { name: 'Blacklist subscriptions' })
    await user.type(input, 'file:///tmp/list')
    await user.click(screen.getByRole('button', { name: 'Add', exact: true }))
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Enter a valid HTTP(S) subscription URL')).toBeVisible()
    expect(request).not.toHaveBeenCalled()

    await user.clear(input)
    await user.type(input, 'https://lists.example/block.txt')
    let finish!: (value: unknown) => void
    request.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    await user.keyboard('{Enter}{Enter}{Enter}')
    expect(request.mock.calls).toEqual([
      ['web_search.blacklist_subscriptions.add', { url: 'https://lists.example/block.txt' }]
    ])
    expect(screen.getByRole('button', { name: 'Add', exact: true })).toBeDisabled()
    const stored = {
      id: 'source-1',
      url: 'https://lists.example/block.txt',
      rules: ['*://*.spam.example/*', '/ads/'],
      updatedAt: '2026-11-21T11:00:00Z'
    }
    await act(async () => {
      finish(stored)
    })
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.blacklist_subscriptions', [stored])
    view.rerender(<BlacklistSubscriptionSettings />)
    expect(input).toHaveValue('')
    expect(screen.getByText(/^2 rules/)).toBeVisible()
    expect(screen.getByText(stored.url)).toBeVisible()
    expect(toast.info).toHaveBeenCalledWith(expect.objectContaining({ title: 'Subscription added (2 rules)' }))
  })

  it('keeps a failed source visible with cached rules and permits retry/removal', async () => {
    const user = userEvent.setup()
    const stored = {
      id: 'source-1',
      url: 'https://lists.example/block.txt',
      rules: ['*://*.spam.example/*'],
      lastError: 'HTTP error: 503'
    }
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.blacklist_subscriptions', [stored])
    render(<BlacklistSubscriptionSettings />)
    expect(screen.getByText('1 rules')).toBeVisible()
    expect(screen.getByText('Last refresh failed: HTTP error: 503')).toBeVisible()
    request.mockResolvedValue(stored)
    await user.click(screen.getByRole('button', { name: 'Refresh', exact: true }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Delete', exact: true }))
    expect(request.mock.calls).toEqual([
      ['web_search.blacklist_subscriptions.refresh', { id: stored.id }],
      ['web_search.blacklist_subscriptions.remove', { id: stored.id }]
    ])
  })
})
