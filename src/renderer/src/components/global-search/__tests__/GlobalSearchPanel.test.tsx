// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { GlobalSearchResponse } from '@shared/data/api/schemas/globalSearch'
import type { GlobalSearchRecentEntry, Tab } from '@shared/data/cache/cacheValueTypes'
import type { SidebarIcon } from '@shared/data/preference/preferenceTypes'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openTab: vi.fn(),
  onClose: vi.fn(),
  useQuery: vi.fn(),
  queryResult: undefined as GlobalSearchResponse | undefined,
  recentItems: [] as GlobalSearchRecentEntry[],
  preferenceValues: {
    'ui.sidebar.icons.visible': ['assistants', 'agents', 'translate'] as SidebarIcon[],
    'ui.sidebar.icons.invisible': ['knowledge'] as SidebarIcon[]
  } as Record<string, unknown>,
  setPreferences: vi.fn(),
  cacheSet: vi.fn(),
  dataApiGet: vi.fn(),
  eventEmit: vi.fn(),
  activeTab: {
    id: 'chat',
    type: 'route',
    url: '/app/chat',
    title: 'Chat'
  } as Tab,
  updateTab: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    type = 'button',
    variant: _variant,
    ...props
  }: React.ComponentProps<'button'> & { variant?: string }) => (
    <button type={type} {...props}>
      {children}
    </button>
  ),
  Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
  Kbd: ({ children }: React.ComponentProps<'kbd'>) => <kbd>{children}</kbd>,
  KbdGroup: ({ children }: React.ComponentProps<'div'>) => <div>{children}</div>
}))

vi.mock('@renderer/components/Icons/SVGIcon', () => ({
  OpenClawSidebarIcon: (props: React.ComponentProps<'svg'>) => <svg aria-hidden="true" {...props} />
}))

vi.mock('@renderer/components/VirtualList', () => ({
  GroupedVirtualList: ({ groups, renderGroupHeader, renderItem }: any) => (
    <div role="listbox">
      {groups.map((entry: any, groupIndex: number) => {
        const group = entry.group ?? entry
        return (
          <div key={group.id}>
            {renderGroupHeader?.(entry.header ?? group, group, groupIndex)}
            {entry.items.map((item: any, itemIndex: number) => (
              <div key={item.id}>{renderItem(item, itemIndex, group, groupIndex, itemIndex)}</div>
            ))}
          </div>
        )
      })}
    </div>
  )
}))

vi.mock('@data/hooks/useCache', () => ({
  usePersistCache: () => [mocks.recentItems, vi.fn()]
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useQuery: (...args: unknown[]) => mocks.useQuery(...args)
}))

vi.mock('@data/hooks/usePreference', () => ({
  useMultiplePreferences: (keys: Record<string, string>) => [
    Object.fromEntries(
      Object.entries(keys).map(([localKey, preferenceKey]) => [localKey, mocks.preferenceValues[preferenceKey]])
    ),
    mocks.setPreferences
  ]
}))

vi.mock('@renderer/hooks/useTabs', () => ({
  useTabs: () => ({ activeTab: mocks.activeTab, openTab: mocks.openTab, updateTab: mocks.updateTab })
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({ defaultPaintingProvider: 'zhipu' })
}))

vi.mock('@renderer/utils/routeTitle', () => ({
  getDefaultRouteTitle: (path: string) => path
}))

vi.mock('@data/CacheService', () => ({
  cacheService: { set: mocks.cacheSet }
}))

vi.mock('@data/DataApiService', () => ({
  dataApiService: { get: mocks.dataApiGet }
}))

vi.mock('@renderer/hooks/useTopic', () => ({
  mapApiTopicToRendererTopic: (topic: unknown) => topic
}))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: {
    GLOBAL_SEARCH_SELECT_TOPIC: 'GLOBAL_SEARCH_SELECT_TOPIC',
    GLOBAL_SEARCH_SELECT_AGENT_SESSION: 'GLOBAL_SEARCH_SELECT_AGENT_SESSION',
    GLOBAL_SEARCH_SELECT_KNOWLEDGE_BASE: 'GLOBAL_SEARCH_SELECT_KNOWLEDGE_BASE'
  },
  EventEmitter: { emit: mocks.eventEmit }
}))

vi.mock('@renderer/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

vi.mock('@renderer/i18n/label', () => ({
  getSidebarIconLabel: (key: SidebarIcon) =>
    ({
      assistants: 'Chat',
      agents: 'Agent',
      store: 'Library',
      paintings: 'Paintings',
      translate: 'Translate',
      mini_app: 'Mini Apps',
      knowledge: 'Knowledge',
      files: 'Files',
      code_tools: 'Code',
      notes: 'Notes',
      openclaw: 'OpenClaw'
    })[key]
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      const label =
        {
          'globalSearch.placeholder': 'Start typing to search...',
          'globalSearch.clear': 'Clear search',
          'globalSearch.filters.label': 'Search type',
          'globalSearch.filters.all': 'All',
          'globalSearch.filters.conversation': 'Conversation',
          'globalSearch.filters.assistant': 'Assistant',
          'globalSearch.filters.agent': 'Agent',
          'globalSearch.filters.knowledge': 'Knowledge',
          'globalSearch.groups.recent': 'Recent',
          'globalSearch.groups.assistant': 'Assistant',
          'globalSearch.groups.conversation': 'Conversation',
          'globalSearch.groups.agent': 'Agent',
          'globalSearch.groups.knowledge-base': 'Knowledge',
          'globalSearch.keyboard.select': 'Select',
          'globalSearch.quickApps.hide': 'Hide {{name}}',
          'globalSearch.quickApps.manage': 'Manage',
          'globalSearch.quickApps.manager_description': 'Click the eye to hide or show',
          'globalSearch.quickApps.manager_title': 'Manage quick apps',
          'globalSearch.quickApps.reset': 'Reset',
          'globalSearch.quickApps.save_failed': 'Failed to save quick apps',
          'globalSearch.quickApps.show': 'Show {{name}}',
          'globalSearch.quickApps.title': 'Quick apps',
          'globalSearch.no_recent': 'No recent routes',
          'globalSearch.recent_hint': 'Type to search conversations, assistants, agents, and knowledge',
          'globalSearch.error': 'Search failed',
          'globalSearch.open_failed': 'Failed to open search result',
          'globalSearch.resultTypes.assistant': 'Assistant',
          'common.loading': 'Loading...',
          'common.no_results': 'No results',
          'common.open': 'Open',
          'common.close': 'Close',
          'common.unnamed': 'Unnamed'
        }[key] ?? key

      return label.replace('{{name}}', options?.name ?? 'Agent')
    }
  })
}))

import { GlobalSearchPanel } from '../GlobalSearchPanel'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('GlobalSearchPanel', () => {
  beforeEach(() => {
    mocks.recentItems = [
      {
        kind: 'topic',
        topicId: 'topic-1',
        title: 'Topic recent',
        lastAccessTime: 20
      }
    ]
    mocks.queryResult = undefined
    mocks.preferenceValues = {
      'ui.sidebar.icons.visible': ['assistants', 'agents', 'translate'],
      'ui.sidebar.icons.invisible': ['knowledge']
    }
    mocks.activeTab = {
      id: 'chat',
      type: 'route',
      url: '/app/chat',
      title: 'Chat'
    }
    mocks.useQuery.mockImplementation((_path, _options) => ({
      data: mocks.queryResult,
      isLoading: false,
      error: undefined
    }))
  })

  it('renders recent items before search and hides them after typing', async () => {
    const user = userEvent.setup()
    mocks.queryResult = {
      query: 'assistant',
      groups: [
        {
          type: 'assistant',
          items: [
            {
              type: 'assistant',
              id: 'assistant-1',
              title: 'Writing Assistant',
              emoji: '🧪',
              target: { assistantId: 'assistant-1' }
            }
          ]
        }
      ]
    }

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    expect(screen.getByText('Topic recent')).toBeInTheDocument()
    expect(screen.getByText('Type to search conversations, assistants, agents, and knowledge')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Start typing to search...'), 'assistant')

    await waitFor(() => {
      expect(screen.queryByText('Topic recent')).not.toBeInTheDocument()
      expect(screen.getByText('Writing Assistant')).toBeInTheDocument()
      expect(screen.getAllByText('🧪')).not.toHaveLength(0)
    })

    expect(mocks.useQuery).toHaveBeenLastCalledWith(
      '/global-search',
      expect.objectContaining({
        enabled: true,
        query: expect.objectContaining({
          q: 'assistant',
          types: ['topic', 'session', 'assistant', 'agent', 'knowledge-base']
        })
      })
    )
  })

  it('renders visible sidebar shortcuts and opens navigation in a new tab', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    const chatButton = screen.getByRole('button', { name: 'Chat' })
    const filterButton = screen.getByRole('button', { name: 'Search type' })

    expect(screen.queryByText('Quick apps')).not.toBeInTheDocument()
    expect(chatButton.compareDocumentPosition(filterButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(chatButton).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agent' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Translate' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Agent' }))

    expect(mocks.openTab).toHaveBeenCalledWith(
      '/app/agents',
      expect.objectContaining({
        forceNew: true
      })
    )
    expect(mocks.updateTab).not.toHaveBeenCalled()
    expect(mocks.onClose).toHaveBeenCalledTimes(1)
  })

  it('opens shortcut navigation in a new tab when the active tab is pinned', async () => {
    const user = userEvent.setup()
    mocks.activeTab = {
      id: 'chat',
      type: 'route',
      url: '/app/chat',
      title: 'Chat',
      isPinned: true
    }

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.click(screen.getByRole('button', { name: 'Translate' }))

    expect(mocks.openTab).toHaveBeenCalledWith(
      '/app/translate',
      expect.objectContaining({
        forceNew: true
      })
    )
    expect(mocks.updateTab).not.toHaveBeenCalled()
    expect(mocks.onClose).toHaveBeenCalledTimes(1)
  })

  it('switches the results area to quick app management', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    const manageButton = screen.getByRole('button', { name: 'Manage' })
    await user.click(manageButton)

    expect(screen.getByText('Manage quick apps')).toBeInTheDocument()
    expect(screen.getByText('Click the eye to hide or show')).toBeInTheDocument()
    expect(screen.getByTestId('quick-app-manager-list')).toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    await user.click(manageButton)

    expect(screen.queryByText('Manage quick apps')).not.toBeInTheDocument()
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('updates sidebar icon preferences when hiding a quick app', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.click(screen.getByRole('button', { name: 'Manage' }))
    await user.click(screen.getByRole('button', { name: 'Hide Agent' }))

    expect(mocks.setPreferences).toHaveBeenCalledWith({
      visible: expect.not.arrayContaining(['agents']),
      invisible: expect.arrayContaining(['agents'])
    })
  })

  it('keeps the manager list order when toggling visibility in the open panel', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.click(screen.getByRole('button', { name: 'Manage' }))
    const getManagerLabels = () =>
      within(screen.getByTestId('quick-app-manager-list'))
        .getAllByText(/Chat|Agent|Translate|Knowledge/)
        .map((element) => element.textContent)

    expect(getManagerLabels()).toEqual(['Chat', 'Agent', 'Translate', 'Knowledge'])

    await user.click(screen.getByRole('button', { name: 'Hide Agent' }))
    mocks.preferenceValues = {
      'ui.sidebar.icons.visible': ['assistants', 'translate'],
      'ui.sidebar.icons.invisible': ['agents', 'knowledge']
    }
    rerender(<GlobalSearchPanel onClose={mocks.onClose} />)

    expect(getManagerLabels()).toEqual(['Chat', 'Agent', 'Translate', 'Knowledge'])
  })

  it('uses the fixed manager order instead of persisted array order', async () => {
    const user = userEvent.setup()
    mocks.preferenceValues = {
      'ui.sidebar.icons.visible': ['translate', 'assistants'],
      'ui.sidebar.icons.invisible': ['knowledge', 'agents']
    }

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.click(screen.getByRole('button', { name: 'Manage' }))
    const labels = within(screen.getByTestId('quick-app-manager-list'))
      .getAllByText(/Chat|Agent|Translate|Knowledge/)
      .map((element) => element.textContent)

    expect(labels).toEqual(['Chat', 'Agent', 'Translate', 'Knowledge'])
  })

  it('resets quick app management to default visible sidebar icons', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.click(screen.getByRole('button', { name: 'Manage' }))
    await user.click(screen.getByRole('button', { name: 'Reset' }))

    expect(mocks.setPreferences).toHaveBeenCalledWith({
      visible: [
        'assistants',
        'agents',
        'store',
        'paintings',
        'translate',
        'mini_app',
        'knowledge',
        'files',
        'code_tools',
        'notes'
      ],
      invisible: []
    })
  })

  it('does not open hidden search results with Enter while quick app management is active', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.click(screen.getByRole('button', { name: 'Manage' }))
    await user.click(screen.getByLabelText('Start typing to search...'))
    await user.keyboard('{Enter}')

    expect(mocks.cacheSet).not.toHaveBeenCalled()
    expect(mocks.openTab).not.toHaveBeenCalled()
    expect(mocks.updateTab).not.toHaveBeenCalled()
    expect(mocks.onClose).not.toHaveBeenCalled()
  })

  it('updates query types when the conversation filter is selected', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.click(screen.getByRole('button', { name: 'Search type' }))
    await user.click(screen.getByRole('radio', { name: 'Conversation' }))
    await user.type(screen.getByLabelText('Start typing to search...'), 'plan')

    await waitFor(() => {
      expect(mocks.useQuery).toHaveBeenLastCalledWith(
        '/global-search',
        expect.objectContaining({
          enabled: true,
          query: expect.objectContaining({
            q: 'plan',
            types: ['topic', 'session']
          })
        })
      )
    })
  })

  it('updates query types when the knowledge filter is selected', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.click(screen.getByRole('button', { name: 'Search type' }))
    await user.click(screen.getByRole('radio', { name: 'Knowledge' }))
    await user.type(screen.getByLabelText('Start typing to search...'), 'docs')

    await waitFor(() => {
      expect(mocks.useQuery).toHaveBeenLastCalledWith(
        '/global-search',
        expect.objectContaining({
          enabled: true,
          query: expect.objectContaining({
            q: 'docs',
            types: ['knowledge-base']
          })
        })
      )
    })
  })

  it('opens the active assistant result with Enter', async () => {
    const user = userEvent.setup()
    mocks.queryResult = {
      query: 'assistant',
      groups: [
        {
          type: 'assistant',
          items: [
            {
              type: 'assistant',
              id: 'assistant-1',
              title: 'Writing Assistant',
              target: { assistantId: 'assistant-1' }
            }
          ]
        }
      ]
    }

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    const input = screen.getByLabelText('Start typing to search...')
    await user.type(input, 'assistant')
    await screen.findByText('Writing Assistant')
    await user.keyboard('{Enter}')

    expect(mocks.openTab).toHaveBeenCalledWith('/app/library?resourceType=assistant&action=edit&id=assistant-1', {
      forceNew: true
    })
    expect(mocks.onClose).toHaveBeenCalledTimes(1)
  })

  it('opens the active knowledge base result with Enter', async () => {
    const user = userEvent.setup()
    mocks.queryResult = {
      query: 'docs',
      groups: [
        {
          type: 'knowledge-base',
          items: [
            {
              type: 'knowledge-base',
              id: 'knowledge-1',
              title: 'Docs',
              emoji: '📚',
              target: { knowledgeBaseId: 'knowledge-1' }
            }
          ]
        }
      ]
    }

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    const input = screen.getByLabelText('Start typing to search...')
    await user.type(input, 'docs')
    await screen.findByText('Docs')
    expect(screen.getAllByText('📚')).not.toHaveLength(0)
    await user.keyboard('{Enter}')

    expect(mocks.openTab).toHaveBeenCalledWith('/app/knowledge')
    expect(mocks.eventEmit).toHaveBeenCalledWith('GLOBAL_SEARCH_SELECT_KNOWLEDGE_BASE', 'knowledge-1')
    expect(mocks.onClose).toHaveBeenCalledTimes(1)
  })

  it('opens a recent topic through the chat route', async () => {
    const user = userEvent.setup()
    const topic = {
      id: 'topic-1',
      name: 'Topic recent',
      assistantId: 'assistant-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: []
    }
    mocks.dataApiGet.mockResolvedValue(topic)

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.click(screen.getByText('Topic recent'))

    await waitFor(() => {
      expect(mocks.dataApiGet).toHaveBeenCalledWith('/topics/topic-1')
    })
    expect(mocks.cacheSet).toHaveBeenCalledWith('topic.active', topic)
    expect(mocks.openTab).toHaveBeenCalledWith('/app/chat')
    expect(mocks.onClose).toHaveBeenCalledTimes(1)
  })
})
