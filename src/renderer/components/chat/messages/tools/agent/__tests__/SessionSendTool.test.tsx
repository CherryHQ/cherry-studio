import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'agent.session_delivery.status.accepted': 'Accepted',
        'message.tools.sessionSend.open': 'Open session',
        'message.tools.sessionSend.sent': 'Sent to',
        'message.tools.sessionSend.to': 'To'
      })[key] ?? key
  })
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
  it('identifies the target session', () => {
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
                  status: 'accepted',
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
    expect(screen.getByText('Accepted')).toBeInTheDocument()
  })

  it('uses the streaming state supplied by the tool card', () => {
    render(<Harness isStreaming input={{ target_session_id: 'session-build', message: 'Implement it.' }} />)

    expect(screen.getByText('message.tools.sessionSend.sending')).toBeInTheDocument()
    expect(screen.queryByText('Sent to')).toBeNull()
  })
})
