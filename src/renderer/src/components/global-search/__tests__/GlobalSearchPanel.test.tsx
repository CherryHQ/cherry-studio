// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { GlobalSearchResponse } from '@shared/data/api/schemas/globalSearch'
import type { SearchMessagesResponse } from '@shared/data/api/schemas/messages'
import type { SearchSessionMessagesResponse } from '@shared/data/api/schemas/sessions'
import type { GlobalSearchRecentEntry, Tab } from '@shared/data/cache/cacheValueTypes'
import type { SidebarIcon } from '@shared/data/preference/preferenceTypes'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type ReactModule = typeof React

const mocks = vi.hoisted(() => ({
  openTab: vi.fn(),
  onClose: vi.fn(),
  useQuery: vi.fn(),
  queryResult: undefined as GlobalSearchResponse | undefined,
  messageQueryResult: undefined as SearchMessagesResponse | undefined,
  sessionMessageQueryResult: undefined as SearchSessionMessagesResponse | undefined,
  recentItems: [] as GlobalSearchRecentEntry[],
  preferenceValues: {
    'app.user.name': 'JD',
    'ui.sidebar.icons.visible': ['assistants', 'agents', 'translate'] as SidebarIcon[],
    'ui.sidebar.icons.invisible': ['knowledge'] as SidebarIcon[]
  } as Record<string, unknown>,
  sortableOnSortEnd: undefined as undefined | ((event: { oldIndex: number; newIndex: number }) => void),
  setPreferences: vi.fn(),
  cacheSet: vi.fn(),
  dataApiGet: vi.fn(),
  dataApiPut: vi.fn(),
  invalidateCache: vi.fn(),
  eventEmit: vi.fn(),
  activeTab: {
    id: 'chat',
    type: 'route',
    url: '/app/chat',
    title: 'Chat'
  } as Tab,
  updateTab: vi.fn()
}))

vi.mock('@cherrystudio/ui', async () => {
  const React = await vi.importActual<ReactModule>('react')
  const DropdownMenuContext = React.createContext<{
    open: boolean
    setOpen: React.Dispatch<React.SetStateAction<boolean>>
  } | null>(null)

  return {
    Button: ({
      children,
      type = 'button',
      variant: _variant,
      ...props
    }: React.ComponentProps<'button'> & { variant?: string }) => {
      void _variant
      return (
        <button type={type} {...props}>
          {children}
        </button>
      )
    },
    DropdownMenu: ({ children }: React.ComponentProps<'div'>) => {
      const [open, setOpen] = React.useState(false)
      return (
        <DropdownMenuContext value={{ open, setOpen }}>
          <div>{children}</div>
        </DropdownMenuContext>
      )
    },
    DropdownMenuTrigger: ({ children, asChild: _asChild }: React.ComponentProps<'div'> & { asChild?: boolean }) => {
      void _asChild
      const context = React.use(DropdownMenuContext)
      if (!React.isValidElement<{ onClick?: React.MouseEventHandler }>(children)) return <>{children}</>

      const child = children as React.ReactElement<{ onClick?: React.MouseEventHandler }>
      return React.cloneElement(child, {
        onClick: (event: React.MouseEvent) => {
          child.props.onClick?.(event)
          context?.setOpen((open) => !open)
        }
      })
    },
    DropdownMenuContent: ({ children, align: _align, ...props }: React.ComponentProps<'div'> & { align?: string }) => {
      void _align
      const context = React.use(DropdownMenuContext)
      if (!context?.open) return null
      return <div {...props}>{children}</div>
    },
    DropdownMenuItem: ({
      children,
      onSelect,
      ...props
    }: React.ComponentProps<'button'> & {
      onSelect?: () => void
    }) => {
      const context = React.use(DropdownMenuContext)
      return (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onSelect?.()
            context?.setOpen(false)
          }}
          {...props}>
          {children}
        </button>
      )
    },
    Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
    Kbd: ({ children }: React.ComponentProps<'kbd'>) => <kbd>{children}</kbd>,
    KbdGroup: ({ children }: React.ComponentProps<'div'>) => <div>{children}</div>,
    SegmentedControl: ({
      options,
      value,
      onValueChange,
      ...props
    }: React.ComponentProps<'div'> & {
      options: Array<{ label: React.ReactNode; value: string }>
      value?: string
      onValueChange?: (value: string) => void
    }) => (
      <div role="radiogroup" {...props}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            onClick={() => onValueChange?.(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
    ),
    Sortable: ({
      items,
      itemKey,
      onSortEnd,
      renderItem
    }: {
      items: Array<Record<string, unknown>>
      itemKey: string
      onSortEnd: (event: { oldIndex: number; newIndex: number }) => void
      renderItem: (item: Record<string, unknown>, state: { dragging: boolean }) => React.ReactNode
    }) => {
      mocks.sortableOnSortEnd = onSortEnd
      return (
        <div data-testid="mock-sortable" data-item-key={itemKey}>
          {items.map((item) => (
            <div key={String(item[itemKey])}>{renderItem(item, { dragging: false })}</div>
          ))}
        </div>
      )
    }
  }
})

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
  useInvalidateCache: () => mocks.invalidateCache,
  useQuery: (...args: unknown[]) => mocks.useQuery(...args)
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => [mocks.preferenceValues[key], vi.fn()],
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
  dataApiService: { get: mocks.dataApiGet, put: mocks.dataApiPut }
}))

vi.mock('@renderer/hooks/useTopic', () => ({
  mapApiTopicToRendererTopic: (topic: unknown) => topic
}))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: {
    LOCATE_MESSAGE: 'LOCATE_MESSAGE',
    GLOBAL_SEARCH_SELECT_TOPIC: 'GLOBAL_SEARCH_SELECT_TOPIC',
    GLOBAL_SEARCH_SELECT_AGENT_SESSION: 'GLOBAL_SEARCH_SELECT_AGENT_SESSION',
    GLOBAL_SEARCH_SELECT_AGENT_SESSION_MESSAGE: 'GLOBAL_SEARCH_SELECT_AGENT_SESSION_MESSAGE',
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
          'globalSearch.filters.conversation': 'Work',
          'globalSearch.filters.topic': 'Topic',
          'globalSearch.filters.session': 'Work',
          'globalSearch.filters.assistant': 'Assistant',
          'globalSearch.filters.agent': 'Agent',
          'globalSearch.filters.knowledge': 'Knowledge',
          'globalSearch.groups.recent': 'Recent',
          'globalSearch.groups.assistant': 'Assistant',
          'globalSearch.groups.conversation': 'Work',
          'globalSearch.groups.topic': 'Topic',
          'globalSearch.groups.session': 'Work',
          'globalSearch.groups.agent': 'Agent',
          'globalSearch.groups.knowledge-base': 'Knowledge',
          'globalSearch.keyboard.select': 'Select',
          'globalSearch.messageSearch.entry': 'Messages',
          'globalSearch.messageSearch.hint': 'Type to search message content',
          'globalSearch.messageSearch.matchModeLabel': 'Match mode',
          'globalSearch.messageSearch.matchModes.substring': 'Substring',
          'globalSearch.messageSearch.matchModes.wholeWord': 'Whole word',
          'globalSearch.messageSearch.more': 'Show {{count}} more results',
          'globalSearch.messageSearch.open': 'Search messages',
          'globalSearch.messageSearch.roles.assistant': 'Assistant role',
          'globalSearch.messageSearch.roles.system': 'System role',
          'globalSearch.messageSearch.roles.tool': 'Tool role',
          'globalSearch.messageSearch.roles.user': 'User role',
          'globalSearch.messageSearch.sourceLabel': 'Message source',
          'globalSearch.messageSearch.sources.all': 'All messages',
          'globalSearch.messageSearch.sources.session': 'Work messages',
          'globalSearch.messageSearch.sources.topic': 'Topic messages',
          'globalSearch.quickApps.hide': 'Hide {{name}}',
          'globalSearch.quickApps.manage': 'Manage',
          'globalSearch.quickApps.manager_description': 'Drag to reorder, click the eye to hide or show',
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
          'globalSearch.timeFilters.any': 'Any time',
          'globalSearch.timeFilters.label': 'Updated time',
          'globalSearch.timeFilters.messageLabel': 'Created time',
          'globalSearch.timeFilters.month': 'Last month',
          'globalSearch.timeFilters.quarter': 'Last 3 months',
          'globalSearch.timeFilters.today': 'Today',
          'globalSearch.timeFilters.week': 'Last 7 days',
          'common.loading': 'Loading...',
          'common.no_results': 'No results',
          'common.open': 'Open',
          'common.close': 'Close',
          'common.unnamed': 'Unnamed'
        }[key] ?? key

      return label.replace('{{name}}', options?.name ?? 'Agent').replace('{{count}}', options?.count ?? '0')
    },
    i18n: { language: 'en-US' }
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
    mocks.messageQueryResult = undefined
    mocks.sessionMessageQueryResult = undefined
    mocks.preferenceValues = {
      'app.user.name': 'JD',
      'ui.sidebar.icons.visible': ['assistants', 'agents', 'translate'],
      'ui.sidebar.icons.invisible': ['knowledge']
    }
    mocks.sortableOnSortEnd = undefined
    mocks.activeTab = {
      id: 'chat',
      type: 'route',
      url: '/app/chat',
      title: 'Chat'
    }
    mocks.useQuery.mockImplementation((path: string) => ({
      data:
        path === '/messages/search'
          ? mocks.messageQueryResult
          : path === '/sessions/messages/search'
            ? mocks.sessionMessageQueryResult
            : mocks.queryResult,
      isLoading: false,
      error: undefined
    }))
  })

  it('renders recent items before search and hides them after typing', async () => {
    const user = userEvent.setup()
    const updatedAt = new Date(Date.now() - 2 * 60 * 1000).toISOString()
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
              updatedAt,
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
      expect(screen.getByRole('option', { name: /Writing Assistant/ })).toBeInTheDocument()
      expect(screen.getByText('2 minutes ago')).toBeInTheDocument()
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
    const filterButton = screen.getByRole('button', { name: 'Search type: Topic' })

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

  it('hides the quick app button area when requested', () => {
    render(<GlobalSearchPanel hideQuickApps onClose={mocks.onClose} />)

    expect(screen.queryByRole('button', { name: 'Chat' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Translate' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Manage' })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Messages' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Search type: All' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search type: Topic' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search type: Work' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Updated time' })).toBeInTheDocument()
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
    expect(screen.getByText('Drag to reorder, click the eye to hide or show')).toBeInTheDocument()
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

  it('does not hide the required assistant quick app', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.click(screen.getByRole('button', { name: 'Manage' }))
    await user.click(screen.getByRole('button', { name: 'Hide Chat' }))

    expect(mocks.setPreferences).not.toHaveBeenCalled()
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

    expect(getManagerLabels()).toEqual(['Chat', 'Translate', 'Agent', 'Knowledge'])
  })

  it('uses the persisted preference order in the manager', async () => {
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

    expect(labels).toEqual(['Translate', 'Chat', 'Knowledge', 'Agent'])
  })

  it('renders visible quick app shortcuts in persisted preference order', () => {
    mocks.preferenceValues = {
      'ui.sidebar.icons.visible': ['translate', 'agents', 'assistants'],
      'ui.sidebar.icons.invisible': ['knowledge']
    }

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    const chatButton = screen.getByRole('button', { name: 'Chat' })
    const agentButton = screen.getByRole('button', { name: 'Agent' })
    const translateButton = screen.getByRole('button', { name: 'Translate' })

    expect(translateButton.compareDocumentPosition(agentButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(agentButton.compareDocumentPosition(chatButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(mocks.setPreferences).not.toHaveBeenCalled()
  })

  it('saves dragged quick app order back to preference arrays', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.click(screen.getByRole('button', { name: 'Manage' }))
    mocks.sortableOnSortEnd?.({ oldIndex: 2, newIndex: 0 })

    expect(mocks.setPreferences).toHaveBeenCalledWith({
      visible: ['translate', 'assistants', 'agents'],
      invisible: expect.arrayContaining(['knowledge'])
    })
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

  it('updates query types when the topic filter is selected', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.click(screen.getByRole('button', { name: 'Search type: Topic' }))
    await user.type(screen.getByLabelText('Start typing to search...'), 'plan')

    await waitFor(() => {
      expect(mocks.useQuery).toHaveBeenLastCalledWith(
        '/global-search',
        expect.objectContaining({
          enabled: true,
          query: expect.objectContaining({
            q: 'plan',
            types: ['topic']
          })
        })
      )
    })
  })

  it('updates query types when the session filter is selected', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.click(screen.getByRole('button', { name: 'Search type: Work' }))
    await user.type(screen.getByLabelText('Start typing to search...'), 'plan')

    await waitFor(() => {
      expect(mocks.useQuery).toHaveBeenLastCalledWith(
        '/global-search',
        expect.objectContaining({
          enabled: true,
          query: expect.objectContaining({
            q: 'plan',
            types: ['session']
          })
        })
      )
    })
  })

  it('clears the active search type filter when clicking it again', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    const topicFilter = screen.getByRole('button', { name: 'Search type: Topic' })
    await user.click(topicFilter)
    expect(topicFilter).toHaveAttribute('aria-pressed', 'true')

    await user.click(topicFilter)
    expect(topicFilter).toHaveAttribute('aria-pressed', 'false')

    await user.type(screen.getByLabelText('Start typing to search...'), 'plan')

    await waitFor(() => {
      expect(mocks.useQuery).toHaveBeenLastCalledWith(
        '/global-search',
        expect.objectContaining({
          enabled: true,
          query: expect.objectContaining({
            q: 'plan',
            types: ['topic', 'session', 'assistant', 'agent', 'knowledge-base']
          })
        })
      )
    })
  })

  it('updates query types when the knowledge filter is selected', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.click(screen.getByRole('button', { name: 'Search type: Knowledge' }))
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

  it('switches to message search mode and keeps quick apps visible', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    const messageSearchButton = screen.getByRole('radio', { name: 'Messages' })
    const filterButton = screen.getByRole('button', { name: 'Search type: Topic' })

    expect(messageSearchButton.compareDocumentPosition(filterButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    await user.click(messageSearchButton)
    expect(screen.getByRole('button', { name: 'Chat' })).toBeInTheDocument()
    expect(messageSearchButton).toHaveAttribute('aria-checked', 'true')
    expect(
      messageSearchButton.compareDocumentPosition(
        screen.getByRole('button', { name: 'Message source: Topic messages' })
      )
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(screen.getByRole('button', { name: 'Match mode' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Created time' })).toBeInTheDocument()

    await user.type(screen.getByLabelText('Start typing to search...'), 'needle')

    await waitFor(() => {
      expect(mocks.useQuery).toHaveBeenCalledWith(
        '/messages/search',
        expect.objectContaining({
          enabled: true,
          query: expect.objectContaining({
            q: 'needle'
          })
        })
      )
      expect(mocks.useQuery).toHaveBeenCalledWith(
        '/sessions/messages/search',
        expect.objectContaining({
          enabled: true,
          query: expect.objectContaining({
            q: 'needle'
          })
        })
      )
    })
  })

  it('passes selected time filter to message search queries', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    await user.click(screen.getByRole('button', { name: 'Created time' }))
    await user.click(screen.getByRole('menuitem', { name: 'Last 7 days' }))
    await user.type(screen.getByLabelText('Start typing to search...'), 'needle')

    await waitFor(() => {
      expect(mocks.useQuery).toHaveBeenCalledWith(
        '/messages/search',
        expect.objectContaining({
          enabled: true,
          query: expect.objectContaining({
            q: 'needle',
            createdAtFrom: expect.any(String)
          })
        })
      )
      expect(mocks.useQuery).toHaveBeenCalledWith(
        '/sessions/messages/search',
        expect.objectContaining({
          enabled: true,
          query: expect.objectContaining({
            q: 'needle',
            createdAtFrom: expect.any(String)
          })
        })
      )
    })
  })

  it('switches back from message search to global search filters', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    expect(screen.getByRole('button', { name: 'Message source: Topic messages' })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'All' }))

    expect(screen.queryByRole('button', { name: 'Message source: Topic messages' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Search type: All' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search type: Topic' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search type: Work' })).toBeInTheDocument()

    await user.type(screen.getByLabelText('Start typing to search...'), 'assistant')

    await waitFor(() => {
      expect(mocks.useQuery).toHaveBeenCalledWith(
        '/global-search',
        expect.objectContaining({
          enabled: true,
          query: expect.objectContaining({
            q: 'assistant'
          })
        })
      )
    })
  })

  it('passes selected message sources to message search', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    await user.click(screen.getByRole('button', { name: 'Message source: Work messages' }))
    await user.type(screen.getByLabelText('Start typing to search...'), 'report')

    await waitFor(() => {
      expect(mocks.useQuery).toHaveBeenCalledWith(
        '/messages/search',
        expect.objectContaining({
          enabled: false
        })
      )
      expect(mocks.useQuery).toHaveBeenCalledWith(
        '/sessions/messages/search',
        expect.objectContaining({
          enabled: true,
          query: expect.objectContaining({
            q: 'report'
          })
        })
      )
    })
  })

  it('clears the active message source filter when clicking it again', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    const sessionSourceFilter = screen.getByRole('button', { name: 'Message source: Work messages' })

    await user.click(sessionSourceFilter)
    expect(sessionSourceFilter).toHaveAttribute('aria-pressed', 'true')

    await user.click(sessionSourceFilter)
    expect(sessionSourceFilter).toHaveAttribute('aria-pressed', 'false')

    await user.type(screen.getByLabelText('Start typing to search...'), 'report')

    await waitFor(() => {
      expect(mocks.useQuery).toHaveBeenCalledWith(
        '/messages/search',
        expect.objectContaining({
          enabled: true,
          query: expect.objectContaining({
            q: 'report'
          })
        })
      )
      expect(mocks.useQuery).toHaveBeenCalledWith(
        '/sessions/messages/search',
        expect.objectContaining({
          enabled: true,
          query: expect.objectContaining({
            q: 'report'
          })
        })
      )
    })
  })

  it('renders message search results as parent groups with expandable children', async () => {
    const user = userEvent.setup()
    mocks.messageQueryResult = {
      items: [
        {
          messageId: 'message-1',
          topicId: 'topic-1',
          topicName: 'Topic A',
          topicCreatedAt: '2026-01-01T00:00:00.000Z',
          topicUpdatedAt: '2026-01-01T00:00:00.000Z',
          role: 'user',
          snippet: 'needle message one',
          createdAt: '2026-01-01T00:00:04.000Z'
        },
        {
          messageId: 'message-2',
          topicId: 'topic-1',
          topicName: 'Topic A',
          topicCreatedAt: '2026-01-01T00:00:00.000Z',
          topicUpdatedAt: '2026-01-01T00:00:00.000Z',
          snippet: 'needle message two',
          createdAt: '2026-01-01T00:00:03.000Z'
        },
        {
          messageId: 'message-3',
          topicId: 'topic-1',
          topicName: 'Topic A',
          topicCreatedAt: '2026-01-01T00:00:00.000Z',
          topicUpdatedAt: '2026-01-01T00:00:00.000Z',
          snippet: 'needle message three',
          createdAt: '2026-01-01T00:00:02.000Z'
        },
        {
          messageId: 'message-4',
          topicId: 'topic-1',
          topicName: 'Topic A',
          topicCreatedAt: '2026-01-01T00:00:00.000Z',
          topicUpdatedAt: '2026-01-01T00:00:00.000Z',
          snippet: 'needle message four',
          createdAt: '2026-01-01T00:00:01.000Z'
        }
      ]
    }

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    await user.type(screen.getByLabelText('Start typing to search...'), 'needle')

    expect(await screen.findByText('Topic A')).toBeInTheDocument()
    expect(screen.getAllByText('JD')).not.toHaveLength(0)
    expect(screen.getByRole('option', { name: /needle message one/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('option', { name: /needle message four/ })).not.toBeInTheDocument()

    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('option', { name: 'Show 1 more results' })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')

    expect(screen.getByRole('option', { name: /needle message four/ })).toBeInTheDocument()
  })

  it('invalidates the topic message cache before locating a topic message result', async () => {
    const user = userEvent.setup()
    const topic = {
      id: 'topic-1',
      name: 'Topic A',
      assistantId: 'assistant-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: []
    }
    mocks.dataApiGet.mockResolvedValue(topic)
    mocks.messageQueryResult = {
      items: [
        {
          messageId: 'message-1',
          topicId: 'topic-1',
          topicName: 'Topic A',
          topicCreatedAt: '2026-01-01T00:00:00.000Z',
          topicUpdatedAt: '2026-01-01T00:00:00.000Z',
          snippet: 'needle topic reply',
          createdAt: new Date().toISOString()
        }
      ]
    }

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    await user.type(screen.getByLabelText('Start typing to search...'), 'needle')
    await user.click(await screen.findByRole('option', { name: /needle topic reply/ }))

    await waitFor(() => {
      expect(mocks.dataApiPut).toHaveBeenCalledWith('/topics/topic-1/active-node', { body: { nodeId: 'message-1' } })
      expect(mocks.invalidateCache).toHaveBeenCalledWith('/topics/topic-1/messages')
      expect(mocks.cacheSet).toHaveBeenCalledWith(
        'topic.active',
        expect.objectContaining({ activeNodeId: 'message-1' })
      )
    })
    await waitFor(() => {
      expect(mocks.eventEmit).toHaveBeenCalledWith(
        'GLOBAL_SEARCH_SELECT_TOPIC',
        expect.objectContaining({ activeNodeId: 'message-1', id: 'topic-1' })
      )
      expect(mocks.eventEmit).toHaveBeenCalledWith('LOCATE_MESSAGE:message-1', true)
    })
    expect(mocks.dataApiPut.mock.invocationCallOrder[0]).toBeLessThan(mocks.invalidateCache.mock.invocationCallOrder[0])
    expect(mocks.invalidateCache.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.eventEmit.mock.invocationCallOrder.at(-1) ?? Number.MAX_SAFE_INTEGER
    )
    expect(mocks.onClose).toHaveBeenCalledTimes(1)
  })

  it('opens session message search results through the agent route and locate event', async () => {
    const user = userEvent.setup()
    mocks.sessionMessageQueryResult = {
      items: [
        {
          messageId: 'session-message-1',
          sessionId: 'session-1',
          sessionName: 'Session A',
          agentId: 'agent-1',
          agentName: 'Agent',
          role: 'assistant',
          snippet: 'needle session reply',
          createdAt: new Date().toISOString()
        }
      ]
    }

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    await user.type(screen.getByLabelText('Start typing to search...'), 'needle')
    expect(await screen.findByText('Assistant role')).toBeInTheDocument()
    await user.click(await screen.findByRole('option', { name: /needle session reply/ }))

    await waitFor(() => {
      expect(mocks.cacheSet).toHaveBeenCalledWith('agent.active_session_id', 'session-1')
      expect(mocks.openTab).toHaveBeenCalledWith('/app/agents')
      expect(mocks.eventEmit).toHaveBeenCalledWith('GLOBAL_SEARCH_SELECT_AGENT_SESSION', 'session-1')
      expect(mocks.eventEmit).toHaveBeenCalledWith('LOCATE_MESSAGE:session-message-1', true)
    })
    expect(mocks.onClose).toHaveBeenCalledTimes(1)
  })

  it('opens the active message search result with Enter', async () => {
    const user = userEvent.setup()
    mocks.sessionMessageQueryResult = {
      items: [
        {
          messageId: 'session-message-1',
          sessionId: 'session-1',
          sessionName: 'Session A',
          snippet: 'needle session reply',
          createdAt: new Date().toISOString()
        }
      ]
    }

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    const input = screen.getByLabelText('Start typing to search...')
    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    await user.type(input, 'needle')
    await screen.findByRole('option', { name: /needle session reply/ })
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(mocks.eventEmit).toHaveBeenCalledWith('GLOBAL_SEARCH_SELECT_AGENT_SESSION', 'session-1')
      expect(mocks.eventEmit).toHaveBeenCalledWith('LOCATE_MESSAGE:session-message-1', true)
    })
    expect(mocks.onClose).toHaveBeenCalledTimes(1)
  })

  it('adds updatedAtFrom when a time filter is selected', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.click(screen.getByRole('button', { name: 'Updated time' }))
    expect(screen.getByRole('menuitem', { name: 'Last 7 days' }).parentElement).toHaveClass('z-[90]')
    await user.click(screen.getByRole('menuitem', { name: 'Last 7 days' }))
    await user.type(screen.getByLabelText('Start typing to search...'), 'plan')

    await waitFor(() => {
      const lastCall = mocks.useQuery.mock.calls.at(-1)
      expect(lastCall?.[1]).toEqual(
        expect.objectContaining({
          enabled: true,
          query: expect.objectContaining({
            q: 'plan',
            updatedAtFrom: expect.any(String)
          })
        })
      )
    })

    const options = mocks.useQuery.mock.calls.at(-1)?.[1] as { query: { updatedAtFrom: string } }
    const updatedAtFrom = options.query.updatedAtFrom
    const diffMs = Date.now() - Date.parse(updatedAtFrom)
    expect(diffMs).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1000 - 5000)
    expect(diffMs).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000 + 5000)
  })

  it('highlights matched query text in result titles and subtitles', async () => {
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
              subtitle: 'Assistant workspace',
              target: { assistantId: 'assistant-1' }
            }
          ]
        }
      ]
    }

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.type(screen.getByLabelText('Start typing to search...'), 'assistant')

    const highlights = await screen.findAllByText('Assistant', { selector: 'mark' })
    expect(highlights).toHaveLength(2)
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
    await screen.findByRole('option', { name: /Writing Assistant/ })
    await user.keyboard('{Enter}')

    expect(mocks.openTab).toHaveBeenCalledWith('/app/library?resourceType=assistant&action=edit&id=assistant-1', {
      forceNew: true
    })
    expect(mocks.onClose).toHaveBeenCalledTimes(1)
  })

  it('does not open the active result when Enter confirms an IME candidate', async () => {
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
    await screen.findByRole('option', { name: /Writing Assistant/ })

    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })

    expect(mocks.openTab).not.toHaveBeenCalled()
    expect(mocks.onClose).not.toHaveBeenCalled()
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
