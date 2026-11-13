import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'agent.session_delivery.status.accepted': 'Accepted',
        'message.tools.sessionCreate.untitled': 'Untitled session',
        'message.tools.sessionSend.sent': 'Sent to',
        'message.tools.sessionSend.to': 'To',
        'message.tools.cancelled': 'Cancelled',
        'message.tools.error': 'Error'
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
        output={{
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
        }}
      />
    )

    expect(screen.getAllByText('Builder / Build session')).toHaveLength(2)
    expect(screen.getByText('Implement the reviewed plan.')).toBeInTheDocument()
    expect(screen.getByText('Accepted')).toBeInTheDocument()
  })

  it.each([
    { props: { hasError: true, status: 'error' as const }, label: 'Error' },
    { props: { status: 'cancelled' as const }, label: 'Cancelled' }
  ])('does not claim a failed or cancelled send succeeded', ({ props, label }) => {
    render(<Harness {...props} input={{ message: 'Implement it.' }} />)

    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.queryByText('Sent to')).toBeNull()
  })
})
