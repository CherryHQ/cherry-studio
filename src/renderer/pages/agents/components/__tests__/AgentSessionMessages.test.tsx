import { render } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AgentSessionMessages from '../AgentSessionMessages'

const useAgentMessageListProviderValueMock = vi.hoisted(() => vi.fn(() => ({ state: {}, actions: {}, meta: {} })))

vi.mock('@renderer/components/chat/messages/MessageList', () => ({
  default: () => <div data-testid="message-list" />
}))

vi.mock('@renderer/components/chat/messages/MessageListProvider', () => ({
  MessageListProvider: ({ children }: PropsWithChildren) => <div data-testid="message-list-provider">{children}</div>
}))

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: () => ['anchor']
}))

vi.mock('@renderer/hooks/agents/useSession', () => ({
  useSession: () => ({
    session: {
      id: 'session-1',
      agentId: 'agent-1',
      name: 'Agent session',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
  })
}))

vi.mock('../../messages/agentMessageListAdapter', () => ({
  useAgentMessageListProviderValue: useAgentMessageListProviderValueMock
}))

describe('AgentSessionMessages', () => {
  beforeEach(() => {
    useAgentMessageListProviderValueMock.mockClear()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        ai: {
          prewarmAgentSession: vi.fn().mockResolvedValue(undefined),
          closeAgentSessionWarm: vi.fn().mockResolvedValue(undefined)
        }
      }
    })
  })

  it('normalizes blank agent avatars before passing the assistant profile to the message list', () => {
    render(
      <AgentSessionMessages
        agentId="agent-1"
        sessionId="session-1"
        messages={[]}
        activeAgent={{ id: 'agent-1', name: 'Blank avatar agent', configuration: { avatar: '   ' } } as any}
        partsByMessageId={{}}
        isLoading={false}
      />
    )

    expect(useAgentMessageListProviderValueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantProfile: {
          name: 'Blank avatar agent',
          avatar: '🤖'
        }
      })
    )
  })
})
