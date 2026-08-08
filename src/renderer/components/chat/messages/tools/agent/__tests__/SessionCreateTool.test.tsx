import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  copyText: vi.fn().mockResolvedValue(undefined),
  setCopied: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'message.tools.sessionCreate.created': 'Started a new session',
        'message.tools.sessionCreate.firstMessage': 'First message',
        'message.tools.sessionCreate.inheritedContext': 'Using this agent and workspace',
        'message.tools.sessionCreate.sessionId': 'Session ID',
        'message.tools.agent_background': 'Running in background',
        'common.copy': 'Copy',
        'common.copied': 'Copied'
      })[key] ?? key
  })
}))
vi.mock('../../../MessageListProvider', () => ({
  useOptionalMessageListActions: () => ({ copyText: mocks.copyText, notifyError: vi.fn() })
}))
vi.mock('@renderer/hooks/useTemporaryValue', () => ({
  useTemporaryValue: () => [false, mocks.setCopied]
}))
vi.mock('../../shared/GenericTools', () => ({
  useIsStreaming: () => false
}))

import { SessionCreateTool } from '../SessionCreateTool'

function Harness(props: Parameters<typeof SessionCreateTool>[0]) {
  const item = SessionCreateTool(props)
  return (
    <>
      {item.label}
      {item.children}
    </>
  )
}

describe('SessionCreateTool', () => {
  it('presents the new session as a background branch instead of raw MCP JSON', () => {
    render(
      <Harness
        input={{ title: 'Research pricing', message: 'Compare the three enterprise plans and cite each source.' }}
        output={
          {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  ok: true,
                  sessionId: 'session-research',
                  delivery: { status: 'delivering' }
                })
              }
            ]
          } as never
        }
      />
    )

    expect(screen.getAllByText('Research pricing')).toHaveLength(2)
    expect(screen.getByText('Compare the three enterprise plans and cite each source.')).toBeInTheDocument()
    expect(screen.getByText('Running in background')).toBeInTheDocument()
    expect(screen.getByText('session-research')).toBeInTheDocument()
    expect(screen.queryByText(/"sessionId"/)).not.toBeInTheDocument()
  })

  it('copies the durable session id', async () => {
    const user = userEvent.setup()
    render(
      <Harness
        input={{ message: 'Do the work.' }}
        output={
          {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ ok: true, sessionId: 'session-copy', delivery: { status: 'queued' } })
              }
            ]
          } as never
        }
      />
    )

    await user.click(screen.getByRole('button', { name: 'Copy' }))

    expect(mocks.copyText).toHaveBeenCalledWith('session-copy', { successMessage: 'Copied' })
    expect(mocks.setCopied).toHaveBeenCalledWith(true)
  })
})
