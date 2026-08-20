import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const navigateToRoute = vi.hoisted(() => vi.fn())

vi.mock('../../../MessageListProvider', () => ({
  useOptionalMessageListActions: () => ({ navigateToRoute })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'message.tools.sessionCreate.created': 'Session created',
        'message.tools.sessionCreate.open': 'Open session',
        'message.tools.sessionCreate.untitled': 'Untitled session',
        'message.tools.sessionSend.open': 'Open session',
        'message.tools.sessionSend.sent': 'Sent to'
      })[key] ?? key
  })
}))

import { SessionResultCards } from '../SessionResultCards'

describe('SessionResultCards', () => {
  beforeEach(() => {
    navigateToRoute.mockReset()
  })

  it('renders completed session actions after the reply and opens their targets directly', async () => {
    const user = userEvent.setup()
    render(
      <SessionResultCards
        targets={[
          {
            kind: 'create',
            renderKey: 'create-call',
            sessionId: 'session-created',
            sessionName: 'Research session'
          },
          {
            agentName: 'Builder',
            kind: 'send',
            renderKey: 'send-call',
            sessionId: 'session-build',
            sessionName: 'Build session'
          }
        ]}
      />
    )

    expect(screen.getByText('Session created')).toBeInTheDocument()
    expect(screen.getAllByText('Research session')).not.toHaveLength(0)
    expect(screen.getByText('Sent to')).toBeInTheDocument()
    expect(screen.getAllByText('Builder / Build session')).not.toHaveLength(0)

    const openCreatedSession = screen.getByRole('button', { name: 'Open session: Research session' })

    await user.click(openCreatedSession)
    expect(navigateToRoute).toHaveBeenLastCalledWith({
      path: '/app/agents',
      query: { sessionId: 'session-created' }
    })

    await user.click(screen.getByRole('button', { name: 'Open session: Builder / Build session' }))
    expect(navigateToRoute).toHaveBeenLastCalledWith({
      path: '/app/agents',
      query: { sessionId: 'session-build' }
    })
  })

  it.each(['create', 'send'] as const)('labels an untitled %s target without exposing its id', (kind) => {
    render(
      <SessionResultCards
        targets={[{ kind, renderKey: `${kind}-untitled`, sessionId: 'opaque-id', sessionName: '' }]}
      />
    )

    expect(screen.getByRole('button', { name: 'Open session: Untitled session' })).toBeInTheDocument()
    expect(screen.queryByText('opaque-id')).toBeNull()
  })
})
