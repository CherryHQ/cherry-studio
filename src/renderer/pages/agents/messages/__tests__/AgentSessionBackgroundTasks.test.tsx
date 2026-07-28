import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AgentSessionBackgroundTasks from '../AgentSessionBackgroundTasks'

const mocks = vi.hoisted(() => ({
  backgroundTasks: [] as Array<{ id: string; type: string; description: string }>,
  taskEvents: {} as Record<string, Record<string, unknown>>,
  openAgentToolFlow: vi.fn()
}))

vi.mock('@renderer/components/HorizontalScrollContainer', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="horizontal-scroll">{children}</div>
}))

vi.mock('@renderer/components/chat/messages/MessageListProvider', () => ({
  useMessageListActions: () => ({ openAgentToolFlow: mocks.openAgentToolFlow })
}))

vi.mock('@renderer/hooks/agent/useAgentSessionBackgroundTasks', () => ({
  useAgentSessionBackgroundTasks: () => mocks.backgroundTasks
}))

vi.mock('@renderer/hooks/agent/useAgentSessionTaskEvents', () => ({
  useAgentSessionTaskEvents: () => mocks.taskEvents
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => `${key}:${options?.count ?? ''}`
  })
}))

describe('AgentSessionBackgroundTasks', () => {
  beforeEach(() => {
    mocks.backgroundTasks = []
    mocks.taskEvents = {}
    mocks.openAgentToolFlow.mockReset()
  })

  it('renders live tasks in a horizontal row and opens subagent flows', () => {
    mocks.backgroundTasks = [
      { id: 'subagent-1', type: 'subagent', description: 'Audit the codebase' },
      { id: 'shell-1', type: 'local_bash', description: 'sleep 300' }
    ]
    mocks.taskEvents = {
      'subagent-1': {
        event: 'started',
        taskId: 'subagent-1',
        toolUseId: 'tool-use-1',
        status: 'in_progress',
        title: 'Audit the codebase',
        taskType: 'subagent',
        isBackgrounded: true
      },
      'shell-1': {
        event: 'started',
        taskId: 'shell-1',
        status: 'in_progress',
        title: 'sleep 300',
        taskType: 'local_bash',
        isBackgrounded: true
      }
    }

    render(<AgentSessionBackgroundTasks sessionId="session-1" />)

    expect(screen.getByTestId('horizontal-scroll')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Audit the codebase' }))

    expect(mocks.openAgentToolFlow).toHaveBeenCalledWith({
      toolCallId: 'tool-use-1',
      title: 'Audit the codebase'
    })
    expect(screen.getByText('sleep 300').closest('button')).toBeNull()
  })

  it('does not reserve message space after background work ends', () => {
    const { container } = render(<AgentSessionBackgroundTasks sessionId="session-1" />)

    expect(container).toBeEmptyDOMElement()
  })
})
