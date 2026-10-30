import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SelectionAgentCapsule } from '@shared/types/selection'

const mocks = vi.hoisted(() => ({ ipcRequest: vi.fn() }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key}:${JSON.stringify(options)}` : key)
  })
}))
vi.mock('@renderer/hooks/useWindowInitData', () => ({ useWindowInitData: () => ({ displayId: 7 }) }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.ipcRequest } }))

const { default: SelectionCapsuleStack } = await import('../SelectionCapsuleStack')

const capsule = (windowId: string, overrides: Partial<SelectionAgentCapsule> = {}): SelectionAgentCapsule => ({
  windowId,
  agentName: `Agent ${windowId}`,
  agentAvatar: '🛠️',
  status: 'running',
  steps: 0,
  ...overrides
})
const showStack = (capsules: SelectionAgentCapsule[]) => {
  MockUseCacheUtils.setSharedCacheValue('selection.agent_capsules.7', capsules)
  return render(<SelectionCapsuleStack />)
}
const requestsTo = (route: string) => mocks.ipcRequest.mock.calls.filter(([name]) => name === route)

describe('SelectionCapsuleStack', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUseCacheUtils.resetMocks()
  })

  it('shows the five nearest the corner and folds the rest into +N, which expands them and folds them back', () => {
    showStack(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => capsule(id)))

    expect(screen.getByText('Agent e')).toBeInTheDocument()
    expect(screen.queryByText('Agent f')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('selection.agent.capsule.more:{"count":2}'))

    expect(screen.getByText('Agent g')).toBeInTheDocument()
    expect(screen.queryByText(/selection.agent.capsule.more/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('selection.agent.capsule.show_less'))

    expect(screen.queryByText('Agent f')).not.toBeInTheDocument()
    expect(screen.getByText('selection.agent.capsule.more:{"count":2}')).toBeInTheDocument()
  })

  it('folds again once its stack empties, as a recycled host shows the next stack', () => {
    const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => capsule(id))
    const { rerender } = showStack(seven)
    fireEvent.click(screen.getByText('selection.agent.capsule.more:{"count":2}'))

    MockUseCacheUtils.setSharedCacheValue('selection.agent_capsules.7', [])
    rerender(<SelectionCapsuleStack />)
    MockUseCacheUtils.setSharedCacheValue('selection.agent_capsules.7', seven)
    rerender(<SelectionCapsuleStack />)

    expect(screen.getByText('selection.agent.capsule.more:{"count":2}')).toBeInTheDocument()
    expect(screen.queryByText('Agent g')).not.toBeInTheDocument()
  })

  it('restores the window a capsule stands for, and closes it from the close button without restoring', () => {
    showStack([capsule('w1'), capsule('w2')])

    fireEvent.click(screen.getByText('Agent w2'))
    fireEvent.click(screen.getAllByRole('button', { name: 'common.close' })[0])

    expect(requestsTo('selection.restore_agent_window')).toEqual([['selection.restore_agent_window', 'w2']])
    expect(requestsTo('selection.close_agent_window')).toEqual([['selection.close_agent_window', 'w1']])
  })

  it('shows the step of a running turn, and the status of one that waits or has finished', () => {
    showStack([
      capsule('w1', { steps: 3 }),
      capsule('w2'),
      capsule('w3', { status: 'awaiting-approval', steps: 2 }),
      capsule('w4', { status: 'needs-input' }),
      capsule('w5', { status: 'failed', steps: 4 })
    ])

    expect(screen.getByText('selection.agent.capsule.step:{"n":3}')).toBeInTheDocument()
    expect(screen.getByText('selection.agent.capsule.running')).toBeInTheDocument()
    expect(screen.getByText('selection.agent.capsule.needs_approval')).toBeInTheDocument()
    expect(screen.getByText('selection.agent.capsule.needs_input')).toBeInTheDocument()
    expect(screen.getByText('selection.agent.capsule.failed')).toBeInTheDocument()
  })
})
