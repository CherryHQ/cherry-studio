import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  navigateToRoute: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'agent.session_delivery.status.queued': 'Queued',
        'message.tools.sessionSend.open': 'Open session',
        'message.tools.sessionSend.sent': 'Sent to',
        'message.tools.sessionSend.to': 'To'
      })[key] ?? key
  })
}))
vi.mock('../../../MessageListProvider', () => ({
  useOptionalMessageListActions: () => ({ navigateToRoute: mocks.navigateToRoute })
}))
vi.mock('../../shared/GenericTools', () => ({
  useIsStreaming: () => false
}))

import { SessionSendTool } from '../SessionSendTool'

function Harness(props: Parameters<typeof SessionSendTool>[0]) {
  const item = SessionSendTool(props)
  return (
    <>
      {item.label}
      {item.children}
    </>
  )
}

describe('SessionSendTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('identifies and opens the target session', async () => {
    const user = userEvent.setup()
    render(
      <Harness
        input={{ target_session_id: 'session-build', message: 'Implement the reviewed plan.' }}
        output={
          {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  ok: true,
                  status: 'queued',
                  delivery: {
                    receiver: { agentId: 'agent-builder', sessionId: 'session-build' },
                    receiverSnapshot: { agentName: 'Builder', sessionName: 'Build session' }
                  }
                })
              }
            ]
          } as never
        }
      />
    )

    expect(screen.getAllByText('Builder / Build session')).toHaveLength(2)
    expect(screen.getByText('Implement the reviewed plan.')).toBeInTheDocument()
    expect(screen.getByText('Queued')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open session' }))

    expect(mocks.navigateToRoute).toHaveBeenCalledWith({
      path: '/app/agents',
      query: { sessionId: 'session-build' }
    })
  })
})
