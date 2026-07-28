import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AgentSessionBackgroundTasks from '../AgentSessionBackgroundTasks'

const mocks = vi.hoisted(() => ({
  backgroundTasks: [] as Array<{ id: string; type: string; description: string; toolCallId?: string }>,
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

  it('renders only the authoritative task level and opens a subagent from its launch receipt', () => {
    mocks.backgroundTasks = [
      { id: 'subagent-b', type: 'subagent', description: 'Current task B', toolCallId: 'tool-use-b' },
      { id: 'shell-b', type: 'local_bash', description: 'sleep 300' }
    ]
    mocks.taskEvents = {
      'subagent-a': {
        event: 'started',
        taskId: 'subagent-a',
        toolUseId: 'stale-tool-use-a',
        status: 'in_progress',
        title: 'Stale task A',
        taskType: 'subagent',
        isBackgrounded: true
      }
    }
    render(<AgentSessionBackgroundTasks sessionId="session-1" />)

    expect(screen.getByTestId('horizontal-scroll')).toBeInTheDocument()
    expect(screen.queryByText('Stale task A')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Current task B' }))

    expect(mocks.openAgentToolFlow).toHaveBeenCalledWith({
      toolCallId: 'tool-use-b',
      title: 'Current task B'
    })
    expect(screen.getByText('sleep 300').closest('button')).toBeNull()
  })

  it('does not reserve message space after background work ends', () => {
    const { container } = render(<AgentSessionBackgroundTasks sessionId="session-1" />)

    expect(container).toBeEmptyDOMElement()
  })
})
