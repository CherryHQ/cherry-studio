import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MessageListProviderValue } from '@renderer/components/chat/messages/types'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

const messageListProviderMock = vi.hoisted(() => vi.fn(() => ({}) as MessageListProviderValue))
const messageCaptureMessagesMock = vi.hoisted(() =>
  vi.fn((options: { loadMessages: () => Promise<unknown[]> }) => {
    void options
    return {
      messages: [],
      partsByMessageId: {}
    }
  })
)
const messageCaptureHostMock = vi.hoisted(() => vi.fn())
const exportServiceMocks = vi.hoisted(() => ({
  getAgentSessionExportTitle: vi.fn(() => 'New task'),
  getAgentSessionMessagesForExport: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/components/chat/messages/hooks/useMessageImageCaptureMessages', () => ({
  useMessageImageCaptureMessages: messageCaptureMessagesMock
}))

vi.mock('@renderer/components/chat/messages/MessageImageCaptureHost', () => ({
  default: (props: unknown) => {
    messageCaptureHostMock(props)
    return <div data-testid="message-image-capture-host" />
  }
}))

vi.mock('@renderer/services/agentSessionExport', () => exportServiceMocks)

vi.mock('../agentMessageListAdapter', () => ({
  useAgentMessageListProviderValue: messageListProviderMock
}))

const { default: AgentSessionImageCaptureHost } = await import('../AgentSessionImageCaptureHost')

describe('AgentSessionImageCaptureHost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the session export title for offscreen image capture', () => {
    const session = {
      id: 'session-a',
      agentId: 'agent-a',
      name: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    } as AgentSessionEntity
    const modelFallback = {
      id: 'model-a',
      name: 'Model A',
      provider: 'provider-a'
    }

    render(<AgentSessionImageCaptureHost modelFallback={modelFallback} session={session} />)

    expect(exportServiceMocks.getAgentSessionExportTitle).toHaveBeenCalledWith(session)
    expect(messageListProviderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: expect.objectContaining({
          id: 'agent-session:session-a',
          name: 'New task'
        })
      })
    )
    expect(messageCaptureHostMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ready: true,
        testId: 'agent-session-image-capture-host'
      })
    )
  })

  it('keeps the initial capture input stable while parent data references refresh', async () => {
    const session = {
      id: 'session-a',
      agentId: 'agent-a',
      name: 'Initial',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    } as AgentSessionEntity
    const modelFallback = {
      id: 'model-a',
      name: 'Model A',
      provider: 'provider-a'
    }
    exportServiceMocks.getAgentSessionMessagesForExport.mockResolvedValue([])

    const view = render(<AgentSessionImageCaptureHost modelFallback={modelFallback} session={session} />)
    const initialLoadMessages = messageCaptureMessagesMock.mock.calls.at(-1)?.[0].loadMessages

    view.rerender(
      <AgentSessionImageCaptureHost
        modelFallback={{ ...modelFallback }}
        session={{ ...session, name: 'Refreshed object' }}
      />
    )
    const refreshedLoadMessages = messageCaptureMessagesMock.mock.calls.at(-1)?.[0].loadMessages

    expect(refreshedLoadMessages).toBe(initialLoadMessages)
    await refreshedLoadMessages?.()
    expect(exportServiceMocks.getAgentSessionMessagesForExport).toHaveBeenCalledWith(session, { modelFallback })
  })
})
