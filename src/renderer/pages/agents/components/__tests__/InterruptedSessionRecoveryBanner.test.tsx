import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'

import { InterruptedSessionRecoveryBanner } from '../InterruptedSessionRecoveryBanner'

const { useQueryMock, useMutationMock, navigateMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
  useMutationMock: vi.fn(),
  navigateMock: vi.fn()
}))

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigateMock }))

const dismissTrigger = vi.fn()

function setupQueryResponse(data: unknown, isLoading = false) {
  useQueryMock.mockReturnValue({ data, isLoading, mutate: vi.fn() })
  useMutationMock.mockReturnValue({ trigger: dismissTrigger, isLoading: false, error: undefined })
}

const recovery = {
  kind: 'crash' as const,
  detectedAt: new Date(0).toISOString(),
  items: [
    {
      sessionId: 'session-1',
      agentId: 'agent-1',
      agentName: 'Research Agent',
      sessionName: 'Pipeline refactor',
      sessionType: 'conversation' as const,
      workspacePath: '/tmp/ws',
      interruptedAt: new Date(0).toISOString(),
      summary: 'Bash'
    },
    {
      sessionId: 'session-2',
      agentId: null,
      agentName: null,
      sessionName: '',
      sessionType: 'background' as const,
      workspacePath: null,
      interruptedAt: null,
      summary: null
    }
  ]
}

describe('InterruptedSessionRecoveryBanner', () => {
  beforeEach(() => {
    navigateMock.mockReset()
    dismissTrigger.mockReset()
  })

  it('renders nothing without a recovery record', () => {
    setupQueryResponse(undefined, false)
    const view = render(<InterruptedSessionRecoveryBanner />)
    expect(view.container.firstChild).toBeNull()
  })

  it('renders nothing while loading', () => {
    setupQueryResponse(recovery, true)
    const view = render(<InterruptedSessionRecoveryBanner />)
    expect(view.container.firstChild).toBeNull()
  })

  it('lists interrupted sessions and navigates on open', async () => {
    const user = userEvent.setup()
    setupQueryResponse(recovery)
    render(<InterruptedSessionRecoveryBanner />)

    expect(screen.getByText(i18n.t('agent.recovery.noticeTitle.crash', { count: 2 }))).toBeInTheDocument()
    expect(screen.getByText('Pipeline refactor')).toBeInTheDocument()
    expect(screen.getByText('Bash')).toBeInTheDocument()
    expect(screen.getByText(i18n.t('agent.recovery.backgroundBadge'))).toBeInTheDocument()

    await user.click(screen.getByTestId('interrupted-session-recovery-banner').querySelectorAll('button')[1])
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/app/agents',
      search: { sessionId: 'session-1', agentId: 'agent-1' }
    })
  })

  it('dismisses via DELETE', async () => {
    const user = userEvent.setup()
    setupQueryResponse(recovery)
    render(<InterruptedSessionRecoveryBanner />)

    await user.click(screen.getByRole('button', { name: i18n.t('agent.recovery.dismiss') }))
    expect(dismissTrigger).toHaveBeenCalledOnce()
  })
})
