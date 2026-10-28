import { render } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { expect, it, vi } from 'vitest'

import type AgentSessionMessages from '../components/AgentSessionMessages'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  sessionMessagesProps: undefined as ComponentProps<typeof AgentSessionMessages> | undefined
}))

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('../components/AgentRightPane', () => ({ useAgentRightPaneActions: () => ({}) }))
vi.mock('../components/AgentSessionMessages', () => ({
  default: (props: ComponentProps<typeof AgentSessionMessages>) => {
    mocks.sessionMessagesProps = props
    return null
  }
}))

import AgentChatMain from '../AgentChatMain'

it('opens a fork source in place with a way back to the fork', async () => {
  render(
    <AgentChatMain
      placement="docked"
      sessionMessagesEnabled
      agentId="agent-1"
      sessionId="child"
      messages={[]}
      activeAgent={undefined}
      partsByMessageId={{}}
      streamingLayers={{ historyPartsByMessageId: {}, liveMessageIds: [] }}
      optimisticAskUserQuestionInputsByToolCallId={{}}
      isLoading={false}
      onOpenCitationsPanel={vi.fn()}
      deleteMessage={vi.fn()}
      startEditing={vi.fn()}
      editBusy={false}
      respondToolApproval={vi.fn()}
    />
  )

  await mocks.sessionMessagesProps!.navigateToForkSource!({ sourceSessionId: 'parent', returnSessionId: 'child' })
  expect(mocks.navigate).toHaveBeenCalledWith({
    to: '/app/agents',
    search: { sessionId: 'parent', forkReturnSessionId: 'child' }
  })
})
