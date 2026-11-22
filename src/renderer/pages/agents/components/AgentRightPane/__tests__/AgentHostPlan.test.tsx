import { mockDataApiService, MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import en from '@renderer/i18n/locales/en-us.json'
import type { AgentPlanEntity, AgentPlanHistoryEntity } from '@shared/data/api/schemas/agentPlans'

import { AgentHostPlan } from '../AgentHostPlan'

vi.mock('@cherrystudio/ui', async () => vi.importActual('@cherrystudio/ui/components/primitives/button'))
const i18n = i18next.createInstance()
await i18n.init({ lng: 'en-US', resources: { 'en-US': { translation: en } }, keySeparator: false })
const plan: AgentPlanEntity = {
  id: '11111111-1111-4111-8111-111111111111',
  sessionId: 'session-one',
  revision: 8,
  state: {
    objective: 'Saved user objective',
    steps: [
      { id: '22222222-2222-4222-8222-222222222222', title: 'Inspect source', dependencyIds: [], status: 'completed' },
      {
        id: '33333333-3333-4333-8333-333333333333',
        title: 'Check result',
        dependencyIds: ['22222222-2222-4222-8222-222222222222'],
        status: 'pending'
      }
    ]
  },
  createdAt: '2026-11-21T00:00:00Z',
  updatedAt: '2026-11-22T01:00:00Z',
  delivery: 'unsupported'
}
const entry = (revision: number): AgentPlanHistoryEntity => ({
  id: `44444444-4444-4444-8444-${String(revision).padStart(12, '0')}`,
  planId: plan.id,
  revision,
  state: { ...plan.state, objective: `Historical objective ${revision}` },
  origin: 'user-edit',
  createdAt: plan.createdAt
})
const component = (sessionId = 'session-one') => (
  <I18nextProvider i18n={i18n}>
    <AgentHostPlan sessionId={sessionId} />
  </I18nextProvider>
)
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(() => {
  MockDataApiUtils.resetMocks()
  mockDataApiService.get.mockImplementation(async (path) =>
    path.endsWith('/history') ? { items: [entry(8)], nextCursor: 'older-cursor' } : { plan: structuredClone(plan) }
  )
})

describe('read-only saved host plan', () => {
  // Saved statuses must not imply actual delivery, execution, or imported native history.
  it('shows saved provenance, exact identity/dependencies and unsupported delivery without write controls', async () => {
    render(component())
    expect(await screen.findByText('Saved user objective')).toBeVisible()
    expect(screen.getByText(/Runtime delivery is unsupported/)).toBeVisible()
    expect(screen.getByText('Recorded: completed')).toBeVisible()
    expect(screen.getByText('Recorded: pending')).toBeVisible()
    expect(screen.getByText('Prerequisites: 22222222-2222-4222-8222-222222222222')).toBeVisible()
    expect(screen.getByText('Saved revision 8')).toBeVisible()
    expect(mockDataApiService.get.mock.calls.every(([path]) => !path.endsWith('/history'))).toBe(true)
    expect(mockDataApiService.put).not.toHaveBeenCalled()
    expect(mockDataApiService.post).not.toHaveBeenCalled()
  })

  it('loads history only on request, replaces bounded pages and never restores or starts work', async () => {
    const user = userEvent.setup()
    render(component())
    const toggle = await screen.findByRole('button', { name: 'Saved revision history' })
    toggle.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByText('Historical objective 8')).toBeVisible()
    expect(screen.getAllByText('Origin: user edit')).toHaveLength(2)
    expect(mockDataApiService.get).toHaveBeenLastCalledWith('/agent-sessions/session-one/plan/history', {
      query: { limit: 5 }
    })
    mockDataApiService.get.mockResolvedValueOnce({ items: [entry(3)] })
    await user.click(screen.getByRole('button', { name: 'Older revisions' }))
    expect(await screen.findByText('Historical objective 3')).toBeVisible()
    expect(screen.queryByText('Historical objective 8')).not.toBeInTheDocument()
    expect(mockDataApiService.get).toHaveBeenLastCalledWith('/agent-sessions/session-one/plan/history', {
      query: { limit: 5, cursor: 'older-cursor' }
    })
    await user.click(toggle)
    expect(screen.queryByText('Historical objective 3')).not.toBeInTheDocument()
    expect(mockDataApiService.put).not.toHaveBeenCalled()
    expect(mockDataApiService.post).not.toHaveBeenCalled()
  })

  it('drops earlier session reads and history after switching away and back', async () => {
    const user = userEvent.setup()
    const lateHistory = deferred<unknown>(),
      latePlan = deferred<unknown>()
    const { rerender } = render(component())
    await screen.findByText('Saved user objective')
    mockDataApiService.get.mockReturnValueOnce(lateHistory.promise)
    await user.click(screen.getByRole('button', { name: 'Saved revision history' }))
    mockDataApiService.get.mockReturnValueOnce(latePlan.promise)
    rerender(component('session-two'))
    expect(screen.queryByText('Saved user objective')).not.toBeInTheDocument()
    rerender(component())
    expect(await screen.findByText('Saved user objective')).toBeVisible()
    await act(async () => {
      lateHistory.resolve({ items: [entry(99)] })
      latePlan.resolve({ plan: { ...plan, state: { ...plan.state, objective: 'Other session secret' } } })
    })
    expect(screen.queryByText('Historical objective 99')).not.toBeInTheDocument()
    expect(screen.queryByText('Other session secret')).not.toBeInTheDocument()
  })

  it('hides former content on access failure and refreshes scoped notifications without stale history', async () => {
    const user = userEvent.setup()
    render(component())
    await screen.findByText('Saved user objective')
    await user.click(screen.getByRole('button', { name: 'Saved revision history' }))
    await screen.findByText('Historical objective 8')
    mockDataApiService.get.mockRejectedValueOnce(new Error('private transport detail'))
    await act(async () =>
      MockDataApiUtils.emitDataChange([
        {
          endpoint: '/agent-sessions/:sessionId/plan',
          routeParams: { sessionId: 'session-one' }
        }
      ])
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('Saved plan unavailable')
    expect(screen.queryByText('Saved user objective')).not.toBeInTheDocument()
    expect(screen.queryByText('Historical objective 8')).not.toBeInTheDocument()
    expect(screen.queryByText('private transport detail')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('Saved user objective')).toBeVisible()
  })

  it('keeps history failures separate from current plan and permits an explicit retry', async () => {
    const user = userEvent.setup()
    render(component())
    await screen.findByText('Saved user objective')
    mockDataApiService.get.mockRejectedValueOnce(new Error('history unavailable'))
    await user.click(screen.getByRole('button', { name: 'Saved revision history' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('History unavailable')
    expect(screen.getByText('Saved user objective')).toBeVisible()
    const region = screen.getByLabelText('Saved revision history')
    await user.click(within(region).getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('Historical objective 8')).toBeVisible()
  })

  it('distinguishes an empty saved plan from native cards and never imports them', async () => {
    mockDataApiService.get.mockResolvedValueOnce({ plan: null })
    render(component())
    expect(await screen.findByText(/No saved host plan/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Saved revision history' })).not.toBeInTheDocument()
    expect(mockDataApiService.put).not.toHaveBeenCalled()
  })

  it('refuses another session plan and mismatched history instead of exposing returned content', async () => {
    const user = userEvent.setup()
    mockDataApiService.get.mockResolvedValueOnce({ plan: { ...plan, sessionId: 'foreign' } })
    render(component())
    expect(await screen.findByRole('alert')).toHaveTextContent('Saved plan unavailable')
    expect(screen.queryByText('Saved user objective')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await screen.findByText('Saved user objective')
    mockDataApiService.get.mockResolvedValueOnce({
      items: [{ ...entry(7), planId: '55555555-5555-4555-8555-555555555555' }]
    })
    await user.click(screen.getByRole('button', { name: 'Saved revision history' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('History unavailable')
    expect(screen.queryByText('Historical objective 7')).not.toBeInTheDocument()
  })

  it('ignores unrelated notifications but invalidates old history when this session changes', async () => {
    const user = userEvent.setup()
    render(component())
    await screen.findByText('Saved user objective')
    await user.click(screen.getByRole('button', { name: 'Saved revision history' }))
    await screen.findByText('Historical objective 8')
    await act(async () =>
      MockDataApiUtils.emitDataChange([
        {
          endpoint: '/agent-sessions/:sessionId/plan',
          routeParams: { sessionId: 'another' }
        }
      ])
    )
    expect(screen.getByText('Historical objective 8')).toBeVisible()
    mockDataApiService.get.mockResolvedValueOnce({
      plan: { ...plan, revision: 9, state: { ...plan.state, objective: 'New accepted objective' } }
    })
    await act(async () =>
      MockDataApiUtils.emitDataChange([
        {
          endpoint: '/agent-sessions/:sessionId/plan',
          routeParams: { sessionId: 'session-one' }
        }
      ])
    )
    expect(await screen.findByText('New accepted objective')).toBeVisible()
    expect(screen.queryByText('Historical objective 8')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Saved revision history' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('does not reveal late history after closing it and fetches a fresh page when reopened', async () => {
    const user = userEvent.setup()
    render(component())
    const toggle = await screen.findByRole('button', { name: 'Saved revision history' })
    const pending = deferred<{ items: AgentPlanHistoryEntity[] }>()
    mockDataApiService.get.mockReturnValueOnce(pending.promise)
    await user.click(toggle)
    await user.click(toggle)
    await act(async () => pending.resolve({ items: [entry(2)] }))
    expect(screen.queryByText('Historical objective 2')).not.toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(await screen.findByText('Historical objective 8')).toBeVisible()
    expect(screen.queryByText('Historical objective 2')).not.toBeInTheDocument()
  })

  it('refuses malformed snapshots without displaying unvalidated plan text', async () => {
    mockDataApiService.get.mockResolvedValueOnce({
      plan: { ...plan, delivery: 'delivered', state: { ...plan.state, objective: 'Unvalidated objective' } }
    })
    render(component())
    expect(await screen.findByRole('alert')).toHaveTextContent('Saved plan unavailable')
    expect(screen.queryByText('Unvalidated objective')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Saved revision history' })).not.toBeInTheDocument()
  })
})
