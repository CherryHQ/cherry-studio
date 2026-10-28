import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MessagePartsScopeProvider } from '@renderer/components/chat/messages/blocks/MessagePartsContext'
import { buildAgentLaunchIndex } from '@renderer/components/chat/messages/tools/shared/agentToolTypes'
import type { CherryMessagePart } from '@shared/data/types/message'

import AgentSessionBackgroundTasks from '../AgentSessionBackgroundTasks'

const mocks = vi.hoisted(() => ({
  backgroundTasks: [] as Array<{ id: string; type: string; description: string; toolCallId?: string }>,
  taskEvents: {} as Record<string, Record<string, unknown>>,
  openAgentToolFlow: vi.fn(),
  launchIndex: null as null | {
    toolCallIds: ReadonlySet<string>
    childRootCallIds: ReadonlySet<string>
    dshTaskRootCallIds: ReadonlySet<string>
    parentedToolCallIds: ReadonlySet<string>
  }
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

vi.mock('@renderer/components/chat/messages/tools/agent', () => ({
  useAgentLaunchIndex: () => mocks.launchIndex
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
    mocks.launchIndex = null
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

  it('does not duplicate subagents already shown in the message footer, retaining unanchored work', () => {
    mocks.backgroundTasks = [
      { id: 'child', type: 'subagent', description: 'Review database', toolCallId: 'spawn' },
      { id: 'other', type: 'subagent', description: 'Other reply task', toolCallId: 'other-spawn' },
      { id: 'shell', type: 'local_bash', description: 'Background shell' }
    ]
    render(
      <MessagePartsScopeProvider
        messageId="reply"
        parts={[{ type: 'tool-Agent', toolCallId: 'spawn', state: 'input-available', input: {} }]}>
        <AgentSessionBackgroundTasks sessionId="session-1" />
      </MessagePartsScopeProvider>
    )
    expect(screen.queryByText('Review database')).toBeNull()
    expect(screen.getByRole('button', { name: 'Other reply task' })).toBeVisible()
    expect(screen.getByText('Background shell')).toBeVisible()
  })

  // A resumed child's content can stream under a launch id whose row sits outside the loaded
  // window: the parent link proves loaded content, not a rendered row, so the capsule stays.
  it('keeps the capsule while the row that owns the task content is outside the loaded window', () => {
    mocks.backgroundTasks = [
      { id: 'child', type: 'subagent', description: 'Review watcher freeze fix plan', toolCallId: 'call-send' }
    ]
    mocks.launchIndex = {
      toolCallIds: new Set(),
      childRootCallIds: new Set(['call-send']),
      dshTaskRootCallIds: new Set(),
      parentedToolCallIds: new Set()
    }
    render(
      <MessagePartsScopeProvider messageId="reply" parts={[{ type: 'text', text: 'done' } as never]}>
        <AgentSessionBackgroundTasks sessionId="session-1" />
      </MessagePartsScopeProvider>
    )

    expect(screen.getByRole('button', { name: 'Review watcher freeze fix plan' })).toBeVisible()
  })

  // The launch row itself is loaded, so the subtask list already owns it and the capsule would
  // only duplicate the same navigation.
  it('does not draw a capsule for a task whose loaded launch row the subtask list owns', () => {
    mocks.backgroundTasks = [
      { id: 'child', type: 'subagent', description: 'Review watcher freeze fix plan', toolCallId: 'call-send' }
    ]
    mocks.launchIndex = {
      toolCallIds: new Set(['call-send']),
      childRootCallIds: new Set(),
      dshTaskRootCallIds: new Set(),
      parentedToolCallIds: new Set()
    }
    render(
      <MessagePartsScopeProvider messageId="reply" parts={[{ type: 'text', text: 'done' } as never]}>
        <AgentSessionBackgroundTasks sessionId="session-1" />
      </MessagePartsScopeProvider>
    )

    expect(screen.queryByText('Review watcher freeze fix plan')).toBeNull()
  })

  // Before the child's content arrives the call is not a child root yet, but the runtime has already
  // bound its task to it: the list owns the row, so the capsule must not draw a second one.
  it('does not draw a capsule for a dsh task the runtime bound to its resume call', () => {
    mocks.backgroundTasks = [
      { id: 'child', type: 'subagent', description: 'Review watcher freeze fix plan', toolCallId: 'call-send' }
    ]
    mocks.launchIndex = {
      toolCallIds: new Set(),
      childRootCallIds: new Set(),
      dshTaskRootCallIds: new Set(['call-send']),
      parentedToolCallIds: new Set()
    }
    render(
      <MessagePartsScopeProvider messageId="reply" parts={[{ type: 'text', text: 'done' } as never]}>
        <AgentSessionBackgroundTasks sessionId="session-1" />
      </MessagePartsScopeProvider>
    )

    expect(screen.queryByText('Review watcher freeze fix plan')).toBeNull()
  })

  it('does not reserve message space after background work ends', () => {
    const { container } = render(<AgentSessionBackgroundTasks sessionId="session-1" />)

    expect(container).toBeEmptyDOMElement()
  })

  // A nested launch (parented under another flow) is loaded but never rendered top-level, so it
  // cannot replace the capsule for its task.
  it('keeps the capsule when the loaded launch is nested under a paged-out flow', () => {
    mocks.backgroundTasks = [
      { id: 'child', type: 'subagent', description: 'Nested review task', toolCallId: 'nested-call' }
    ]
    mocks.launchIndex = buildAgentLaunchIndex({
      earlier: [
        {
          type: 'dynamic-tool',
          toolCallId: 'nested-call',
          toolName: 'Agent',
          state: 'output-available',
          input: { description: 'Nested review task' },
          callProviderMetadata: { 'claude-code': { parentToolCallId: 'parent-call' } }
        } as unknown as CherryMessagePart
      ]
    })
    render(<AgentSessionBackgroundTasks sessionId="session-1" />)

    expect(screen.getByRole('button', { name: 'Nested review task' })).toBeVisible()
  })

  // The same rule applies to a parented part in the capsule's own message.
  it('keeps the capsule when the launch part in this message is nested', () => {
    mocks.backgroundTasks = [
      { id: 'child', type: 'subagent', description: 'Nested review task', toolCallId: 'nested-call' }
    ]
    render(
      <MessagePartsScopeProvider
        messageId="reply"
        parts={[
          {
            type: 'tool-Agent',
            toolCallId: 'nested-call',
            state: 'output-available',
            input: { description: 'Nested review task' },
            callProviderMetadata: { 'claude-code': { parentToolCallId: 'parent-call' } }
          } as unknown as CherryMessagePart
        ]}>
        <AgentSessionBackgroundTasks sessionId="session-1" />
      </MessagePartsScopeProvider>
    )

    expect(screen.getByRole('button', { name: 'Nested review task' })).toBeVisible()
  })

  it('renders a local Workflow chip without offering an empty root FlowTab', () => {
    mocks.backgroundTasks = [
      { id: 'workflow-1', type: 'local_workflow', description: 'Review PR', toolCallId: 'workflow-tool' }
    ]

    render(<AgentSessionBackgroundTasks sessionId="session-1" />)

    expect(screen.getByText('Review PR')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Review PR' })).toBeNull()
    expect(mocks.openAgentToolFlow).not.toHaveBeenCalled()
  })
})
