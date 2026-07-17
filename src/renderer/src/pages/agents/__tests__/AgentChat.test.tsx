import { render, screen } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AgentChat from '../AgentChat'

const mocks = vi.hoisted(() => ({
  activeSessionId: 'session-a',
  createDefaultSession: vi.fn()
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  QuickPanelProvider: ({ children }: PropsWithChildren) => children
}))

vi.mock('@renderer/hooks/agents/useActiveAgent', () => ({
  useActiveAgent: () => ({ agent: { id: 'agent-a' }, isLoading: false })
}))

vi.mock('@renderer/hooks/agents/useAgents', () => ({
  useAgents: () => ({ agents: [{ id: 'agent-a' }], isLoading: false })
}))

vi.mock('@renderer/hooks/agents/useCreateDefaultSession', () => ({
  useCreateDefaultSession: () => ({ createDefaultSession: mocks.createDefaultSession })
}))

vi.mock('@renderer/hooks/useRuntime', () => ({
  useRuntime: () => ({
    chat: {
      activeAgentId: 'agent-a',
      activeSessionIdMap: { 'agent-a': mocks.activeSessionId },
      isMultiSelectMode: false
    }
  })
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  useNavbarPosition: () => ({ isTopNavbar: false }),
  useSettings: () => ({ messageNavigation: 'none', messageStyle: '', topicPosition: 'left' })
}))

vi.mock('@renderer/hooks/useShortcuts', () => ({ useShortcut: vi.fn() }))
vi.mock('@renderer/hooks/useStore', () => ({ useShowTopics: () => ({ showTopics: false }) }))
vi.mock('@renderer/utils', () => ({ cn: () => '' }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: PropsWithChildren) => children,
  motion: { div: ({ children }: PropsWithChildren) => <div>{children}</div> }
}))

vi.mock('@renderer/pages/home/Inputbar/components/PinnedTodoPanel', () => ({ PinnedTodoPanel: () => null }))
vi.mock('@renderer/pages/home/Messages/ChatNavigation', () => ({ default: () => null }))
vi.mock('@renderer/pages/home/Messages/NarrowLayout', () => ({
  default: ({ children }: PropsWithChildren) => children
}))
vi.mock('../components/AgentChatNavbar', () => ({ default: () => null }))
vi.mock('../components/AgentSessionInputbar', () => ({ default: () => null }))
vi.mock('../components/Sessions', () => ({ default: () => null }))
vi.mock('../components/AgentSessionMessages', () => ({
  default: ({ sessionId }: { sessionId: string }) => <div data-testid="agent-session-messages">{sessionId}</div>
}))

describe('AgentChat', () => {
  beforeEach(() => {
    mocks.activeSessionId = 'session-a'
  })

  it('remounts the message list when switching sessions', () => {
    const { rerender } = render(<AgentChat />)
    const sessionAElement = screen.getByTestId('agent-session-messages')

    mocks.activeSessionId = 'session-b'
    rerender(<AgentChat />)

    const sessionBElement = screen.getByTestId('agent-session-messages')
    expect(sessionBElement).toHaveTextContent('session-b')
    expect(sessionBElement).not.toBe(sessionAElement)

    mocks.activeSessionId = 'session-a'
    rerender(<AgentChat />)

    const restoredSessionAElement = screen.getByTestId('agent-session-messages')
    expect(restoredSessionAElement).toHaveTextContent('session-a')
    expect(restoredSessionAElement).not.toBe(sessionBElement)
  })
})
