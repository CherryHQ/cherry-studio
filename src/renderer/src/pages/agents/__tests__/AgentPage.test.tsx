import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const agentPageMocks = vi.hoisted(() => ({
  activeSessionId: 'session-initial' as string | null,
  setActiveSessionId: vi.fn(),
  setShowSidebar: vi.fn()
}))

vi.mock('@data/hooks/usePreference', async () => {
  const React = await import('react')

  return {
    usePreference: (key: string) => {
      const [value, setValue] = React.useState<unknown>(key === 'topic.tab.show' ? false : undefined)
      const setPreference = vi.fn(async (nextValue: unknown) => {
        if (key === 'topic.tab.show') {
          agentPageMocks.setShowSidebar(nextValue)
        }
        setValue(nextValue)
      })

      return [value, setPreference]
    }
  }
})

vi.mock('@renderer/components/app/Navbar', () => ({
  Navbar: ({ children }: { children?: ReactNode }) => <nav>{children}</nav>,
  NavbarCenter: ({ children }: { children?: ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/data/hooks/useCache', async () => {
  const React = await import('react')

  return {
    useCache: (key: string) => {
      const [activeSessionId, setActiveSessionId] = React.useState(agentPageMocks.activeSessionId)
      if (key !== 'agent.active_session_id') return [undefined, vi.fn()]

      const setCache = vi.fn((nextSessionId: string | null) => {
        agentPageMocks.activeSessionId = nextSessionId
        agentPageMocks.setActiveSessionId(nextSessionId)
        setActiveSessionId(nextSessionId)
      })

      return [activeSessionId, setCache]
    }
  }
})

vi.mock('@renderer/hooks/agents/useAgentDataApi', () => ({
  useAgents: () => ({
    agents: [{ id: 'agent-a', model: 'model-a', name: 'Agent A' }]
  })
}))

vi.mock('@renderer/hooks/agents/useAgentSessionInitializer', () => ({
  useAgentSessionInitializer: vi.fn()
}))

vi.mock('@renderer/hooks/useNavbar', () => ({
  useNavbarPosition: () => ({ isLeftNavbar: false })
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({ topicPosition: 'left' })
}))

vi.mock('@renderer/hooks/useShortcuts', () => ({
  useShortcut: vi.fn()
}))

vi.mock('@renderer/pages/history/HistoryRecordsPage', () => ({
  default: ({ onClose, onRecordSelect, open }: any) =>
    open ? (
      <button
        type="button"
        onClick={() => {
          onRecordSelect?.('session-history')
          onClose?.()
        }}>
        Select history session
      </button>
    ) : null
}))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: {
    SHOW_ASSISTANTS: 'SHOW_ASSISTANTS',
    SHOW_TOPIC_SIDEBAR: 'SHOW_TOPIC_SIDEBAR'
  },
  EventEmitter: {
    emit: vi.fn()
  }
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    init: vi.fn(),
    type: '3rdParty'
  },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('../AgentChat', () => ({
  default: ({ pane, paneOpen }: { pane?: ReactNode; paneOpen?: boolean }) => (
    <section>
      <output data-testid="pane-open">{String(paneOpen)}</output>
      {pane}
    </section>
  )
}))

vi.mock('../AgentNavbar', () => ({
  default: () => <nav />
}))

vi.mock('../AgentSidePanel', () => ({
  default: ({ onOpenHistory, revealRequest }: any) => (
    <div data-reveal-request={JSON.stringify(revealRequest ?? null)} data-testid="agent-side-panel">
      <button type="button" onClick={() => onOpenHistory?.()}>
        Open agent history
      </button>
    </div>
  )
}))

vi.mock('../components/status', () => ({
  AgentEmpty: () => <div>No agents</div>
}))

import AgentPage from '../AgentPage'

describe('AgentPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    agentPageMocks.activeSessionId = 'session-initial'

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        window: {
          resetMinimumSize: vi.fn().mockResolvedValue(undefined),
          setMinimumSize: vi.fn().mockResolvedValue(undefined)
        }
      }
    })
  })

  it('opens the agent sidebar and forwards a reveal request after selecting a history session', async () => {
    render(<AgentPage />)

    expect(screen.getByTestId('pane-open')).toHaveTextContent('false')

    fireEvent.click(screen.getByRole('button', { name: 'Open agent history' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select history session' }))

    await waitFor(() => expect(agentPageMocks.setActiveSessionId).toHaveBeenCalledWith('session-history'))

    expect(agentPageMocks.setShowSidebar).toHaveBeenCalledWith(true)
    expect(screen.getByTestId('pane-open')).toHaveTextContent('true')
    expect(JSON.parse(screen.getByTestId('agent-side-panel').getAttribute('data-reveal-request') ?? 'null')).toEqual({
      clearFilters: true,
      clearQuery: true,
      itemId: 'session-history',
      requestId: 1
    })
  })
})
