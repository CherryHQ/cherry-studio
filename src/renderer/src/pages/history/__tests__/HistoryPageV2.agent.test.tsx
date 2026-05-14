import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import type { AgentEntity } from '@shared/data/types/agent'
import { fireEvent, render, screen } from '@testing-library/react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hookMocks = vi.hoisted(() => ({
  cacheGet: vi.fn(),
  cacheGetShared: vi.fn(),
  cacheSet: vi.fn(),
  cacheSubscribe: vi.fn(),
  setActiveSessionId: vi.fn(),
  useAgents: vi.fn(),
  useAllTopics: vi.fn(),
  useAssistants: vi.fn(),
  useCache: vi.fn(),
  useSessions: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: { children?: ReactNode }) => <button {...props}>{children}</button>,
  ContextMenu: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ContextMenuContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ContextMenuTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  EmptyState: ({ description, title }: { description?: string; title: string }) => (
    <div>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </div>
  ),
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />
}))

vi.mock('@data/CacheService', () => ({
  cacheService: {
    get: hookMocks.cacheGet,
    getShared: hookMocks.cacheGetShared,
    set: hookMocks.cacheSet,
    subscribe: hookMocks.cacheSubscribe
  }
}))

vi.mock('@renderer/components/VirtualList', () => ({
  DynamicVirtualList: <T,>({ children, list }: { children: (item: T, index: number) => ReactNode; list: T[] }) => (
    <div>
      {list.map((item, index) => (
        <div key={(item as { id?: string }).id ?? index}>{children(item, index)}</div>
      ))}
    </div>
  )
}))

vi.mock('@renderer/data/hooks/useCache', () => ({
  useCache: hookMocks.useCache
}))

vi.mock('@renderer/hooks/agents/useAgentDataApi', () => ({
  useAgents: hookMocks.useAgents
}))

vi.mock('@renderer/hooks/agents/useSessionDataApi', () => ({
  useSessions: hookMocks.useSessions
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistants: hookMocks.useAssistants
}))

vi.mock('@renderer/hooks/useTopicDataApi', () => ({
  useAllTopics: hookMocks.useAllTopics
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    init: vi.fn(),
    type: '3rdParty'
  },
  useTranslation: () => ({
    t: (key: string, fallback?: string, options?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        'agent.session.group.unknown_agent': 'Unknown agent',
        'common.agent': 'Agent',
        'common.all': 'All',
        'common.close': 'Close',
        'common.unnamed': 'Untitled',
        'history.v2.agentSubtitle': '{{count}} sessions',
        'history.v2.agentTitle': 'Agent history',
        'history.v2.empty.sessionsDescription': 'No sessions for the current filters.',
        'history.v2.empty.sessionsTitle': 'No sessions',
        'history.v2.loading.sessionsDescription': 'Loading sessions.',
        'history.v2.loading.sessionsTitle': 'Loading sessions',
        'history.v2.resultCount': '{{count}} results',
        'history.v2.searchSession': 'Search sessions...',
        'history.v2.sidebar.status': 'Status',
        'history.v2.status.completed': 'Completed',
        'history.v2.status.failed': 'Failed',
        'history.v2.status.running': 'Running',
        'history.v2.table.messages': 'Messages',
        'history.v2.table.session': 'Session',
        'history.v2.table.time': 'Time'
      }
      const template = labels[key] ?? fallback ?? key
      return template.replace('{{count}}', String(options?.count ?? ''))
    }
  })
}))

import HistoryPageV2 from '../HistoryPageV2'

function createSession(overrides: Partial<AgentSessionEntity> = {}): AgentSessionEntity {
  return {
    id: 'session-alpha',
    agentId: 'agent-alpha',
    name: 'Alpha session',
    description: 'Planning notes',
    accessiblePaths: [],
    orderKey: 'a',
    createdAt: '2026-05-13T08:00:00.000Z',
    updatedAt: '2026-05-14T08:00:00.000Z',
    ...overrides
  }
}

function createAgent(overrides: Partial<AgentEntity> = {}): AgentEntity {
  return {
    id: 'agent-alpha',
    type: 'claude-code',
    model: 'model-alpha',
    modelName: 'Claude',
    name: 'Alpha agent',
    configuration: { avatar: 'A' },
    createdAt: '2026-05-13T08:00:00.000Z',
    updatedAt: '2026-05-14T08:00:00.000Z',
    ...overrides
  }
}

function setupAgentHistory({
  agents = [
    createAgent(),
    createAgent({ id: 'agent-beta', name: 'Beta agent', configuration: { avatar: 'B' } }),
    createAgent({ id: 'agent-gamma', name: 'Gamma agent', configuration: { avatar: 'G' } })
  ],
  sessions = [
    createSession(),
    createSession({
      id: 'session-beta',
      agentId: 'agent-beta',
      name: 'Beta session',
      description: 'Runbook audit',
      orderKey: 'b'
    })
  ]
}: {
  agents?: AgentEntity[]
  sessions?: AgentSessionEntity[]
} = {}) {
  hookMocks.useAgents.mockReturnValue({ agents, error: undefined, isLoading: false })
  hookMocks.useSessions.mockReturnValue({
    sessions,
    pinIdBySessionId: new Map(),
    error: undefined,
    isLoading: false
  })
  hookMocks.useCache.mockReturnValue([null, hookMocks.setActiveSessionId])

  const onClose = vi.fn()
  render(<HistoryPageV2 mode="agent" open onClose={onClose} />)

  return { onClose }
}

describe('HistoryPageV2 agent mode', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="agent-page"></div><div id="home-page"></div>'
    hookMocks.cacheGet.mockReset()
    hookMocks.cacheGet.mockReturnValue(undefined)
    hookMocks.cacheGetShared.mockReset()
    hookMocks.cacheGetShared.mockReturnValue(undefined)
    hookMocks.cacheSet.mockReset()
    hookMocks.cacheSubscribe.mockReset()
    hookMocks.cacheSubscribe.mockReturnValue(() => undefined)
    hookMocks.setActiveSessionId.mockReset()
    hookMocks.useAgents.mockReset()
    hookMocks.useAllTopics.mockReset()
    hookMocks.useAssistants.mockReset()
    hookMocks.useCache.mockReset()
    hookMocks.useSessions.mockReset()
  })

  it('renders sessions from the existing agent session list data', () => {
    setupAgentHistory()

    expect(hookMocks.useSessions).toHaveBeenCalledWith(undefined, { loadAll: true, pageSize: 50 })
    expect(hookMocks.useAllTopics).not.toHaveBeenCalled()
    expect(hookMocks.useAssistants).not.toHaveBeenCalled()
    expect(screen.getByText('Agent history')).toBeInTheDocument()
    expect(screen.getByText('Alpha session')).toBeInTheDocument()
    expect(screen.getByText('Planning notes')).toBeInTheDocument()
    expect(screen.getAllByText('Alpha agent')).toHaveLength(2)
    expect(screen.getByText('Beta session')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Gamma agent 0/ })).toBeInTheDocument()
    expect(screen.queryByText('Agent placeholder')).not.toBeInTheDocument()
  })

  it('filters sessions by selected agent source', () => {
    setupAgentHistory()

    fireEvent.click(screen.getAllByRole('button', { name: /Beta agent/ })[0])

    expect(screen.queryByText('Alpha session')).not.toBeInTheDocument()
    expect(screen.getByText('Beta session')).toBeInTheDocument()
  })

  it('restores the agent status selector and filters by existing stream status', () => {
    hookMocks.cacheGetShared.mockImplementation((key: string) => {
      if (key.includes('session-beta')) return { status: 'streaming', activeExecutions: [] }
      return undefined
    })

    setupAgentHistory()

    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Running 1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Completed 1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Failed 0/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Running 1/ }))

    expect(screen.queryByText('Alpha session')).not.toBeInTheDocument()
    expect(screen.getByText('Beta session')).toBeInTheDocument()
  })

  it('searches locally by session name, description, and agent name', () => {
    setupAgentHistory()

    fireEvent.change(screen.getByPlaceholderText('Search sessions...'), { target: { value: 'runbook' } })

    expect(screen.queryByText('Alpha session')).not.toBeInTheDocument()
    expect(screen.getByText('Beta session')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search sessions...'), { target: { value: 'alpha agent' } })

    expect(screen.getByText('Alpha session')).toBeInTheDocument()
    expect(screen.queryByText('Beta session')).not.toBeInTheDocument()
  })

  it('activates the selected session and closes history', () => {
    const { onClose } = setupAgentHistory()

    fireEvent.click(screen.getByRole('button', { name: /Beta session/ }))

    expect(hookMocks.setActiveSessionId).toHaveBeenCalledWith('session-beta')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders an empty state when there are no sessions', () => {
    setupAgentHistory({ sessions: [] })

    expect(screen.getByText('No sessions')).toBeInTheDocument()
    expect(screen.getByText('No sessions for the current filters.')).toBeInTheDocument()
  })
})
