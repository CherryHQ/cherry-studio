import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import AgentChat from '../AgentChat'

let terminalPanelProps: Record<string, unknown> | undefined

vi.mock('react-i18next', () => ({
  initReactI18next: {
    init: vi.fn(),
    type: '3rdParty'
  },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    create: (Component: React.ComponentType<any>) => Component,
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>
  }
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  QuickPanelProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/hooks/agents/useActiveAgent', () => ({
  useActiveAgent: () => ({
    agent: {
      id: 'agent-1',
      accessible_paths: ['/agent-workspace']
    },
    isLoading: false
  })
}))

vi.mock('@renderer/hooks/agents/useActiveSession', () => ({
  useActiveSession: () => ({
    session: {
      id: 'session-1',
      accessible_paths: ['/session-workspace']
    }
  })
}))

vi.mock('@renderer/hooks/agents/useAgents', () => ({
  useAgents: () => ({
    agents: [{ id: 'agent-1' }],
    isLoading: false
  })
}))

vi.mock('@renderer/hooks/agents/useCreateDefaultSession', () => ({
  useCreateDefaultSession: () => ({
    createDefaultSession: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useRuntime', () => ({
  useRuntime: () => ({
    chat: {
      activeAgentId: 'agent-1',
      activeSessionIdMap: {
        'agent-1': 'session-1'
      },
      isMultiSelectMode: false
    }
  })
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  useNavbarPosition: () => ({
    isTopNavbar: false
  }),
  useSettings: () => ({
    messageNavigation: 'none',
    messageStyle: '',
    topicPosition: 'left'
  })
}))

vi.mock('@renderer/hooks/useShortcuts', () => ({
  useShortcut: vi.fn()
}))

vi.mock('@renderer/hooks/useStore', () => ({
  useShowTopics: () => ({
    showTopics: false
  })
}))

vi.mock('@renderer/utils', () => ({
  cn: (...values: Array<string | Record<string, boolean> | undefined>) =>
    values
      .flatMap((value) => {
        if (!value) {
          return []
        }
        if (typeof value === 'string') {
          return [value]
        }
        return Object.entries(value)
          .filter(([, enabled]) => enabled)
          .map(([key]) => key)
      })
      .join(' ')
}))

vi.mock('@renderer/utils/agentSession', () => ({
  buildAgentSessionTopicId: (sessionId: string) => `topic-${sessionId}`
}))

vi.mock('../components/AgentChatNavbar', () => ({
  default: ({ onToggleTerminal }: { onToggleTerminal?: () => void }) => (
    <button type="button" data-testid="toggle-terminal" onClick={onToggleTerminal}>
      toggle terminal
    </button>
  )
}))

vi.mock('../components/AgentSessionInputbar', () => ({
  default: () => <div data-testid="agent-session-inputbar" />
}))

vi.mock('../components/AgentSessionMessages', () => ({
  default: () => <div data-testid="agent-session-messages" />
}))

vi.mock('../components/Sessions', () => ({
  default: () => <div data-testid="sessions-panel" />
}))

vi.mock('../components/TerminalPanel', () => ({
  default: (props: Record<string, unknown>) => {
    terminalPanelProps = props
    return <div data-testid="terminal-panel" />
  }
}))

vi.mock('../../home/Inputbar/components/PinnedTodoPanel', () => ({
  PinnedTodoPanel: () => <div data-testid="pinned-todo-panel" />
}))

vi.mock('../../home/Messages/ChatNavigation', () => ({
  default: () => <div data-testid="chat-navigation" />
}))

vi.mock('../../home/Messages/NarrowLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

describe('AgentChat', () => {
  it('passes the active session workspace to TerminalPanel', async () => {
    terminalPanelProps = undefined
    render(<AgentChat />)

    fireEvent.click(screen.getByTestId('toggle-terminal'))

    await waitFor(() => {
      expect(terminalPanelProps).toBeDefined()
    })

    expect(terminalPanelProps).toMatchObject({
      cwd: '/session-workspace',
      sessionId: 'session-1',
      visible: true
    })
  })
})
