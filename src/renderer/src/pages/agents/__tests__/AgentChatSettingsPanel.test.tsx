import { fireEvent, render, screen } from '@testing-library/react'
import type { PropsWithChildren, ReactNode } from 'react'
import type * as ReactI18next from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

import AgentChat from '../AgentChat'

vi.mock('@renderer/components/chat', () => ({
  ChatAppShell: ({
    topBar,
    sidePanel,
    main,
    bottomComposer,
    overlay
  }: {
    topBar?: ReactNode
    sidePanel?: ReactNode
    main: ReactNode
    bottomComposer?: ReactNode
    overlay?: ReactNode
  }) => (
    <div>
      <div data-testid="agent-top-bar">{topBar}</div>
      <div data-testid="agent-side-panel">{sidePanel}</div>
      <div>{main}</div>
      <div>{bottomComposer}</div>
      <div>{overlay}</div>
    </div>
  ),
  LoadingState: () => <div data-testid="loading-state" />
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  QuickPanelProvider: ({ children }: PropsWithChildren) => <>{children}</>
}))

vi.mock('@renderer/data/hooks/useCache', () => ({
  useCache: () => [false]
}))

vi.mock('@renderer/hooks/agents/useAgentDataApi', () => ({
  useAgent: () => ({
    agent: { id: 'agent-1', model: 'provider:model-1' },
    isLoading: false
  }),
  useAgents: () => ({
    agents: [{ id: 'agent-1' }],
    isLoading: false
  })
}))

vi.mock('@renderer/hooks/agents/useSessionDataApi', () => ({
  useActiveSession: () => ({
    session: { id: 'session-1', agentId: 'agent-1' },
    isLoading: false
  })
}))

vi.mock('@renderer/hooks/useAgentSessionParts', () => ({
  useAgentSessionParts: () => ({
    messages: [],
    isLoading: false,
    hasOlder: false,
    loadOlder: vi.fn(),
    refresh: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useChatWithHistory', () => ({
  useChatWithHistory: () => ({
    activeExecutions: [],
    sendMessage: vi.fn(),
    stop: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useExecutionChats', () => ({
  useExecutionChats: () => new Map()
}))

vi.mock('@renderer/hooks/useExecutionMessages', () => ({
  useExecutionMessages: () => ({
    executionMessagesById: {},
    handleExecutionMessagesChange: vi.fn(),
    handleExecutionDispose: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useNavbar', () => ({
  useNavbarPosition: () => ({ isTopNavbar: false })
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({
    messageNavigation: 'none',
    messageStyle: 'message-style'
  })
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({ isPending: false })
}))

vi.mock('@renderer/utils/agentSession', () => ({
  buildAgentSessionTopicId: (sessionId: string) => `agent-session:${sessionId}`
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18next>()),
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../components/AgentChatNavbar', () => ({
  default: ({ onOpenSettings }: { onOpenSettings: () => void }) => (
    <button type="button" onClick={onOpenSettings}>
      open settings
    </button>
  )
}))

vi.mock('../components/AgentSessionInputbar', () => ({
  default: () => <div data-testid="agent-inputbar" />
}))

vi.mock('../components/AgentSessionMessages', () => ({
  default: () => <div data-testid="agent-messages" />
}))

vi.mock('../../chat-settings/SettingsPanel', () => ({
  default: ({ open, onClose }: { open: boolean; onClose: () => void }) => (
    <div data-testid="settings-panel" data-open={String(open)}>
      {open && (
        <button type="button" onClick={onClose}>
          close settings
        </button>
      )}
    </div>
  )
}))

vi.mock('../../home/Inputbar/components/PinnedTodoPanel', () => ({
  PinnedTodoPanel: () => <div data-testid="pinned-todo-panel" />
}))

vi.mock('../../home/Messages/ChatNavigation', () => ({
  default: () => <div data-testid="chat-navigation" />
}))

vi.mock('../../home/Messages/ExecutionStreamCollector', () => ({
  default: () => <div data-testid="execution-stream-collector" />
}))

vi.mock('../../home/Messages/NarrowLayout', () => ({
  default: ({ children }: PropsWithChildren) => <>{children}</>
}))

vi.mock('../../home/uiToMessage', () => ({
  uiToMessage: vi.fn()
}))

describe('AgentChat settings panel', () => {
  it('keeps the settings panel open when the settings button is clicked repeatedly', () => {
    render(<AgentChat />)

    expect(screen.getByTestId('settings-panel')).toHaveAttribute('data-open', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'open settings' }))
    expect(screen.getByTestId('settings-panel')).toHaveAttribute('data-open', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'open settings' }))
    expect(screen.getByTestId('settings-panel')).toHaveAttribute('data-open', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'close settings' }))
    expect(screen.getByTestId('settings-panel')).toHaveAttribute('data-open', 'false')
  })
})
