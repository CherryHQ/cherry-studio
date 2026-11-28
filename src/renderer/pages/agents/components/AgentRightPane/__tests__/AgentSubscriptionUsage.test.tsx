import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import type { OutputFor } from '@shared/ipc/types'

import { AgentSubscriptionUsage } from '../AgentSubscriptionUsage'

type SubscriptionUsage = OutputFor<'ai.local_agents.subscription_usage'>

const usage = (agentLabel: string, usedRatio: number): SubscriptionUsage => ({
  status: 'available',
  readAt: 1,
  windows: [{ id: '5h', label: agentLabel, usedRatio, resetsAt: Date.UTC(2026, 10, 28) }]
})

beforeEach(async () => {
  await i18n.changeLanguage('en-US')
})

afterEach(() => vi.restoreAllMocks())

it('keeps the section hidden while the first lookup is pending and after it reports unsupported', async () => {
  const waiting = Promise.withResolvers<SubscriptionUsage>()
  vi.spyOn(ipcApi, 'request').mockReturnValue(waiting.promise)
  render(<AgentSubscriptionUsage agentId="account-without-quotas" />)

  expect(screen.queryByRole('region', { name: 'Subscription quota' })).not.toBeInTheDocument()
  await act(async () => waiting.resolve({ status: 'unsupported' }))
  expect(screen.queryByRole('region', { name: 'Subscription quota' })).not.toBeInTheDocument()
})

it('shows the model group once and labels each quota bar by its period', async () => {
  vi.spyOn(ipcApi, 'request').mockResolvedValue({
    status: 'available',
    readAt: 1,
    windows: [
      { id: 'five-hour', groupLabel: 'Gemini', label: 'Five Hour Limit', durationMinutes: 300, usedRatio: 0.25 },
      { id: 'week', groupLabel: 'Gemini', label: 'Weekly Limit', durationMinutes: 10080, usedRatio: 0.1 }
    ]
  })
  render(<AgentSubscriptionUsage agentId="antigravity" />)

  expect(await screen.findByRole('heading', { name: 'Gemini' })).toBeVisible()
  expect(screen.getAllByText('Gemini')).toHaveLength(1)
  expect(screen.getByRole('progressbar', { name: 'Gemini · 5 hours' })).toHaveAttribute(
    'aria-valuetext',
    '75% remaining'
  )
  expect(screen.getByRole('progressbar', { name: 'Gemini · Weekly limit' })).toHaveAttribute(
    'aria-valuetext',
    '90% remaining'
  )
})

it('refreshes the quota bar and discards a result that belongs to the previously selected Agent', async () => {
  const waiting = Promise.withResolvers<OutputFor<'ai.local_agents.subscription_usage'>>()
  const request = vi
    .spyOn(ipcApi, 'request')
    .mockResolvedValueOnce(usage('Native five-hour limit', 0.25))
    .mockReturnValueOnce(waiting.promise)
    .mockResolvedValueOnce({ status: 'unsupported' })
  const user = userEvent.setup()
  const { rerender } = render(<AgentSubscriptionUsage key="local-a" agentId="local-a" />)
  const bar = await screen.findByRole('progressbar', { name: 'Native five-hour limit' })
  expect(bar).toHaveAttribute('aria-valuetext', '75% remaining')
  const refresh = screen.getByRole('button', { name: 'Refresh' })
  await user.click(refresh)
  expect(refresh).toBeDisabled()
  expect(bar).toBeVisible()
  expect(request).toHaveBeenLastCalledWith('ai.local_agents.subscription_usage', { agentId: 'local-a' })
  rerender(<AgentSubscriptionUsage key="local-b" agentId="local-b" />)
  await act(async () => waiting.resolve(usage('Old limit', 0.5)))
  expect(screen.queryByRole('progressbar', { name: 'Old limit' })).not.toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Subscription quota' })).not.toBeInTheDocument()
})
