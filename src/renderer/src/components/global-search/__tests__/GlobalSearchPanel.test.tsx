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

import { GLOBAL_SEARCH_MESSAGE_PREVIEW_LIMIT } from '../globalSearchGroups'

type ReactModule = typeof React

const mocks = vi.hoisted(() => ({
  openTab: vi.fn(),
  onClose: vi.fn(),
  useQuery: vi.fn(),
  useInfiniteQuery: vi.fn(),
  queryResult: undefined as GlobalSearchResponse | undefined,
  messageQueryResult: undefined as SearchMessagesResponse | undefined,
  sessionMessageQueryResult: undefined as SearchSessionMessagesResponse | undefined,
  messageLoadNext: vi.fn(),
  sessionMessageLoadNext: vi.fn(),
  recentItems: [] as GlobalSearchRecentEntry[],
  pinnedMiniApps: [] as any[],
  openedMiniApps: [] as any[],
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
      return <div onClick={() => context?.setOpen((open) => !open)}>{children}</div>
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
  OpenClawIcon: (props: React.ComponentProps<'svg'>) => <svg aria-hidden="true" {...props} />,
  OpenClawSidebarIcon: (props: React.ComponentProps<'svg'>) => <svg aria-hidden="true" {...props} />
}))

vi.mock('@renderer/components/Icons/MiniAppIcon', () => ({
  default: ({ app }: any) => <span aria-hidden="true">{app.logo ?? 'mini-app-icon'}</span>
}))

vi.mock('@renderer/components/VirtualList', () => ({
  GroupedVirtualList: ({ groups, renderGroupHeader, renderItem, renderGroupFooter }: any) => (
    <div role="listbox">
      {groups.map((entry: any, groupIndex: number) => {
        const group = entry.group ?? entry
        return (
          <div key={group.id}>
            {renderGroupHeader?.(entry.header ?? group, group, groupIndex)}
            {entry.items.map((item: any, itemIndex: number) => (
              <div key={item.id}>{renderItem(item, itemIndex, group, groupIndex, itemIndex)}</div>
            ))}
            {entry.footer ? renderGroupFooter?.(entry.footer, group, groupIndex) : null}
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
  useInfiniteQuery: (...args: unknown[]) => mocks.useInfiniteQuery(...args),
  useInfiniteFlatItems: (pages: any[] = []) => pages.flatMap((page) => page.items),
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

vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({
    openedKeepAliveMiniApps: mocks.openedMiniApps,
    pinned: mocks.pinnedMiniApps
  })
}))

vi.mock('@renderer/utils/routeTitle', () => ({
  getDefaultRouteTitle: (path: string) =>
    ({
      '/app/mini-app': 'Apps',
      '/app/knowledge': 'Knowledge',
      '/app/paintings/zhipu': 'Paintings',
      '/app/translate': 'Translate',
      '/app/files': 'Files',
      '/app/code': 'Code',
      '/app/openclaw': 'OpenClaw',
      '/app/notes': 'Notes',
      '/app/library': 'Library'
    })[path] ?? path
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
    GLOBAL_SEARCH_SELECT_TOPIC_MESSAGE: 'GLOBAL_SEARCH_SELECT_TOPIC_MESSAGE',
    GLOBAL_SEARCH_SELECT_AGENT_SESSION: 'GLOBAL_SEARCH_SELECT_AGENT_SESSION',
    GLOBAL_SEARCH_SELECT_AGENT_SESSION_MESSAGE: 'GLOBAL_SEARCH_SELECT_AGENT_SESSION_MESSAGE',
    GLOBAL_SEARCH_SELECT_KNOWLEDGE_BASE: 'GLOBAL_SEARCH_SELECT_KNOWLEDGE_BASE'
  },
  EventEmitter: { emit: mocks.eventEmit }
}))

vi.mock('@renderer/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

vi.mock('../GlobalSearchMessagePreviewPanel', () => ({
  GlobalSearchMessagePreviewPanel: ({ target, onClose, onOpenMessage }: any) => (
    <aside aria-label="Message preview">
      <div>{target.title}</div>
      <button type="button" onClick={() => onOpenMessage(target.messageId)}>
        Open preview target
      </button>
      <button type="button" onClick={() => onOpenMessage('preview-message-other')}>
        Open preview other message
      </button>
      <button type="button" onClick={onClose}>
        Close preview
      </button>
    </aside>
  )
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
          'globalSearch.placeholder': 'Search topics, work, assistants, agents, and knowledge...',
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
          'globalSearch.groups.message': 'Messages',
          'globalSearch.groups.topic': 'Topic',
          'globalSearch.groups.session': 'Work',
          'globalSearch.groups.agent': 'Agent',
          'globalSearch.groups.knowledge-base': 'Knowledge',
          'globalSearch.keyboard.select': 'Select',
          'launchpad.apps': 'Apps',
          'launchpad.miniApps': 'Mini Apps',
          'library.title': 'Library',
          'title.apps': 'Apps',
          'title.code': 'Code',
          'title.files': 'Files',
          'title.knowledge': 'Knowledge',
          'title.notes': 'Notes',
          'title.openclaw': 'OpenClaw',
          'title.paintings': 'Paintings',
          'title.translate': 'Translate',
          'globalSearch.messageSearch.entry': 'Messages',
          'globalSearch.messageSearch.hint': 'Type to search message content',
          'globalSearch.messageSearch.jumpToMessage': 'Jump to message',
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
          'globalSearch.messageSearch.viewMore': 'View more in Messages',
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
          'globalSearch.showMore': 'Show {{count}} more',
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
          'common.back': 'Back',
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
    mocks.pinnedMiniApps = []
    mocks.openedMiniApps = []
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
    mocks.useInfiniteQuery.mockImplementation((path: string) => {
      const page =
        path === '/messages/search'
          ? mocks.messageQueryResult
          : path === '/sessions/messages/search'
            ? mocks.sessionMessageQueryResult
            : undefined

      return {
        pages: page ? [page] : [],
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        hasNext: !!page?.nextCursor,
        loadNext: path === '/messages/search' ? mocks.messageLoadNext : mocks.sessionMessageLoadNext
      }
    })
  })

  it('does not autofocus the search input when opened', () => {
    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    expect(screen.getByLabelText('Search topics, work, assistants, agents, and knowledge...')).not.toHaveFocus()
  })

  it('renders launchpad before search and hides it after typing', async () => {
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

    expect(screen.getByRole('heading', { name: 'Apps' })).toBeInTheDocument()
    for (const label of [
      'Chat',
      'Agent',
      'Library',
      'Paintings',
      'Translate',
      'Mini Apps',
      'Knowledge',
      'Files',
      'Code',
      'Notes',
      'OpenClaw'
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.queryByText('Topic recent')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Search type: Topic' })).not.toBeInTheDocument()
    expect(screen.queryByText('Select')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Search topics, work, assistants, agents, and knowledge...'), 'assistant')

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Apps' })).not.toBeInTheDocument()
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

  it('does not render quick app shortcuts after typing', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)
    await user.type(screen.getByLabelText('Search topics, work, assistants, agents, and knowledge...'), 'query')

    expect(screen.queryByText('Quick apps')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Chat' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Agent' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Manage' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search type: Topic' })).toBeInTheDocument()
  })

  it('keeps sidebar quick app management out of the default panel', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    expect(screen.queryByRole('button', { name: 'Chat' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Manage' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Messages' })).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Search topics, work, assistants, agents, and knowledge...'), 'query')

    expect(screen.queryByRole('button', { name: 'Chat' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Translate' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Manage' })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Messages' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Search type: All' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search type: Topic' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search type: Work' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Updated time' })).toBeInTheDocument()
  })

  it('updates query types when the topic filter is selected', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.type(screen.getByLabelText('Search topics, work, assistants, agents, and knowledge...'), 'plan')
    await user.click(screen.getByRole('button', { name: 'Search type: Topic' }))

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

    await user.type(screen.getByLabelText('Search topics, work, assistants, agents, and knowledge...'), 'plan')
    await user.click(screen.getByRole('button', { name: 'Search type: Work' }))

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

    await user.type(screen.getByLabelText('Search topics, work, assistants, agents, and knowledge...'), 'plan')
    const topicFilter = screen.getByRole('button', { name: 'Search type: Topic' })
    await user.click(topicFilter)
    expect(topicFilter).toHaveAttribute('aria-pressed', 'true')

    await user.click(topicFilter)
    expect(topicFilter).toHaveAttribute('aria-pressed', 'false')

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

    await user.type(screen.getByLabelText('Search topics, work, assistants, agents, and knowledge...'), 'docs')
    await user.click(screen.getByRole('button', { name: 'Search type: Knowledge' }))

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

  it('caps topic and work groups in all search and expands them on demand', async () => {
    const user = userEvent.setup()
    mocks.queryResult = {
      query: 'plan',
      groups: [
        {
          type: 'topic',
          items: Array.from({ length: 6 }, (_, index) => ({
            type: 'topic',
            id: `topic-${index}`,
            title: `Topic ${index}`,
            target: { topicId: `topic-${index}` }
          }))
        },
        {
          type: 'session',
          items: Array.from({ length: 6 }, (_, index) => ({
            type: 'session',
            id: `session-${index}`,
            title: `Work ${index}`,
            target: { sessionId: `session-${index}`, agentId: 'agent-1' }
          }))
        }
      ]
    }

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.type(screen.getByLabelText('Search topics, work, assistants, agents, and knowledge...'), 'plan')

    expect(await screen.findByRole('option', { name: /Topic 0/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Topic 4/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Topic 5/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Work 4/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Work 5/ })).not.toBeInTheDocument()

    await user.click(screen.getAllByRole('option', { name: 'Show 1 more' })[0])

    expect(screen.getByRole('option', { name: /Topic 5/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Work 5/ })).not.toBeInTheDocument()
  })

  it('shows a capped message preview group in all search and switches to message search from its footer', async () => {
    const user = userEvent.setup()
    mocks.queryResult = {
      query: 'needle',
      groups: []
    }
    mocks.messageQueryResult = {
      items: Array.from({ length: 6 }, (_, index) => ({
        messageId: `message-${index}`,
        topicId: 'topic-1',
        topicName: 'Topic A',
        topicCreatedAt: '2026-01-01T00:00:00.000Z',
        topicUpdatedAt: '2026-01-01T00:00:00.000Z',
        role: 'user' as const,
        snippet: `needle message ${index}`,
        createdAt: `2026-01-01T00:00:0${index}.000Z`
      }))
    }

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.type(screen.getByLabelText('Search topics, work, assistants, agents, and knowledge...'), 'needle')

    expect(await screen.findByText('Topic A')).toBeInTheDocument()
    expect(screen.getByText('Topic messages')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /needle message 5/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /needle message 1/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /needle message 0/ })).not.toBeInTheDocument()

    await waitFor(() => {
      expect(mocks.useInfiniteQuery).toHaveBeenCalledWith(
        '/messages/search',
        expect.objectContaining({
          enabled: true,
          limit: GLOBAL_SEARCH_MESSAGE_PREVIEW_LIMIT,
          query: expect.objectContaining({
            q: 'needle'
          })
        })
      )
    })

    await user.click(screen.getByRole('option', { name: 'View more in Messages' }))

    expect(screen.getByRole('radio', { name: 'Messages' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: 'Message source: Topic messages' })).toBeInTheDocument()
  })

  it('opens a global message preview after source filters were changed in message search', async () => {
    const user = userEvent.setup()
    mocks.queryResult = {
      query: 'needle',
      groups: []
    }
    mocks.messageQueryResult = {
      items: [
        {
          messageId: 'message-preview-target',
          topicId: 'topic-1',
          topicName: 'Topic A',
          topicCreatedAt: '2026-01-01T00:00:00.000Z',
          topicUpdatedAt: '2026-01-01T00:00:00.000Z',
          role: 'user' as const,
          snippet: 'needle target message',
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      ]
    }

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.type(screen.getByLabelText('Search topics, work, assistants, agents, and knowledge...'), 'needle')
    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    await user.click(screen.getByRole('button', { name: 'Message source: Topic messages' }))
    await user.click(screen.getByRole('radio', { name: 'All' }))
    await user.click(await screen.findByRole('option', { name: /needle target message/ }))

    expect(await screen.findByLabelText('Message preview')).toBeInTheDocument()
    expect(screen.getByText('Topic A')).toBeInTheDocument()
  })

  it('switches to message search mode without showing quick app shortcuts', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)
    await user.type(screen.getByLabelText('Search topics, work, assistants, agents, and knowledge...'), 'needle')

    const messageSearchButton = screen.getByRole('radio', { name: 'Messages' })
    const filterButton = screen.getByRole('button', { name: 'Search type: Topic' })

    expect(messageSearchButton.compareDocumentPosition(filterButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    await user.click(messageSearchButton)
    expect(screen.queryByRole('button', { name: 'Chat' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Manage' })).not.toBeInTheDocument()
    expect(messageSearchButton).toHaveAttribute('aria-checked', 'true')
    expect(
      messageSearchButton.compareDocumentPosition(
        screen.getByRole('button', { name: 'Message source: Topic messages' })
      )
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(screen.queryByRole('button', { name: 'Match mode' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Created time' })).toBeInTheDocument()

    await waitFor(() => {
      expect(mocks.useInfiniteQuery).toHaveBeenCalledWith(
        '/messages/search',
        expect.objectContaining({
          enabled: true,
          limit: 50,
          query: expect.objectContaining({
            q: 'needle'
          })
        })
      )
      expect(mocks.useInfiniteQuery).toHaveBeenCalledWith(
        '/sessions/messages/search',
        expect.objectContaining({
          enabled: true,
          limit: 50,
          query: expect.objectContaining({
            q: 'needle'
          })
        })
      )
    })
  })

  it('loads the next cursor page in message search mode', async () => {
    const user = userEvent.setup()
    mocks.messageQueryResult = {
      items: [
        {
          messageId: 'message-page-1',
          topicId: 'topic-1',
          topicName: 'Topic A',
          topicCreatedAt: '2026-01-01T00:00:00.000Z',
          topicUpdatedAt: '2026-01-01T00:00:00.000Z',
          role: 'user',
          snippet: 'needle first page',
          createdAt: '2026-01-01T00:00:01.000Z'
        }
      ],
      nextCursor: 'cursor-1'
    }

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.type(screen.getByLabelText('Search topics, work, assistants, agents, and knowledge...'), 'needle')
    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    await user.click(screen.getByRole('button', { name: 'Message source: Topic messages' }))

    expect(await screen.findByRole('option', { name: /needle first page/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show 50 more' }))

    expect(mocks.messageLoadNext).toHaveBeenCalledTimes(1)
    expect(mocks.sessionMessageLoadNext).not.toHaveBeenCalled()
  })

  it('passes selected time filter to message search queries', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.type(screen.getByLabelText('Search topics, work, assistants, agents, and knowledge...'), 'needle')
    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    await user.click(screen.getByRole('button', { name: 'Created time' }))
    await user.click(screen.getByRole('menuitem', { name: 'Last 7 days' }))

    await waitFor(() => {
      expect(mocks.useInfiniteQuery).toHaveBeenCalledWith(
        '/messages/search',
        expect.objectContaining({
          enabled: true,
          query: expect.objectContaining({
            q: 'needle',
            createdAtFrom: expect.any(String)
          })
        })
      )
      expect(mocks.useInfiniteQuery).toHaveBeenCalledWith(
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

    await user.type(screen.getByLabelText('Search topics, work, assistants, agents, and knowledge...'), 'assistant')
    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    expect(screen.getByRole('button', { name: 'Message source: Topic messages' })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'All' }))

    expect(screen.queryByRole('button', { name: 'Message source: Topic messages' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Search type: All' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search type: Topic' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search type: Work' })).toBeInTheDocument()

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

    await user.type(screen.getByLabelText('Search topics, work, assistants, agents, and knowledge...'), 'report')
    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    await user.click(screen.getByRole('button', { name: 'Message source: Work messages' }))

    await waitFor(() => {
      expect(mocks.useInfiniteQuery).toHaveBeenCalledWith(
        '/messages/search',
        expect.objectContaining({
          enabled: false
        })
      )
      expect(mocks.useInfiniteQuery).toHaveBeenCalledWith(
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

    await user.type(screen.getByLabelText('Search topics, work, assistants, agents, and knowledge...'), 'report')
    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    const sessionSourceFilter = screen.getByRole('button', { name: 'Message source: Work messages' })

    await user.click(sessionSourceFilter)
    expect(sessionSourceFilter).toHaveAttribute('aria-pressed', 'true')

    await user.click(sessionSourceFilter)
    expect(sessionSourceFilter).toHaveAttribute('aria-pressed', 'false')

    await waitFor(() => {
      expect(mocks.useInfiniteQuery).toHaveBeenCalledWith(
        '/messages/search',
        expect.objectContaining({
          enabled: true,
          query: expect.objectContaining({
            q: 'report'
          })
        })
      )
      expect(mocks.useInfiniteQuery).toHaveBeenCalledWith(
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

    await user.type(screen.getByLabelText('Search topics, work, assistants, agents, and knowledge...'), 'needle')
    await user.click(screen.getByRole('radio', { name: 'Messages' }))

    expect(await screen.findByText('Topic A')).toBeInTheDocument()
    expect(screen.getAllByText('JD')).not.toHaveLength(0)
    expect(screen.queryByRole('option', { name: /needle message one/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('option', { name: 'Show 1 more results' }))

    expect(screen.getByRole('option', { name: /needle message one/ })).toBeInTheDocument()
  })

  it('opens a topic message preview before locating the selected message', async () => {
    const user = userEvent.setup()
    const topic = {
      id: 'topic-1',
      name: 'Topic A',
      assistantId: 'assistant-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: []
    }
    mocks.dataApiGet.mockImplementation((path: string) => {
      if (path === '/topics/topic-1/path') {
        return Promise.resolve([{ id: 'message-1' }, { id: 'message-leaf' }])
      }
      return Promise.resolve(topic)
    })
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

    await user.type(screen.getByLabelText('Search topics, work, assistants, agents, and knowledge...'), 'needle')
    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    await user.click(await screen.findByRole('option', { name: /needle topic reply/ }))

    const preview = screen.getByRole('complementary', { name: 'Message preview' })
    expect(preview).toBeInTheDocument()
    expect(within(preview).getByText('Topic A')).toBeInTheDocument()
    expect(mocks.dataApiPut).not.toHaveBeenCalled()
    expect(mocks.openTab).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Open preview target' }))

    await waitFor(() => {
      expect(mocks.dataApiGet).toHaveBeenCalledWith('/topics/topic-1/path', { query: { nodeId: 'message-1' } })
      expect(mocks.dataApiPut).toHaveBeenCalledWith('/topics/topic-1/active-node', {
        body: { nodeId: 'message-leaf' }
      })
      expect(mocks.invalidateCache).toHaveBeenCalledWith('/topics/topic-1/messages')
      expect(mocks.cacheSet).toHaveBeenCalledWith(
        'topic.active',
        expect.objectContaining({ activeNodeId: 'message-leaf' })
      )
    })
    await waitFor(() => {
      expect(mocks.eventEmit).toHaveBeenCalledWith(
        'GLOBAL_SEARCH_SELECT_TOPIC_MESSAGE',
        expect.objectContaining({
          messageId: 'message-1',
          topic: expect.objectContaining({ activeNodeId: 'message-leaf', id: 'topic-1' })
        })
      )
    })
    expect(mocks.dataApiPut.mock.invocationCallOrder[0]).toBeLessThan(mocks.invalidateCache.mock.invocationCallOrder[0])
    expect(mocks.invalidateCache.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.eventEmit.mock.invocationCallOrder.at(-1) ?? Number.MAX_SAFE_INTEGER
    )
    expect(mocks.onClose).toHaveBeenCalledTimes(1)
  })

  it('jumps directly from a topic message search row action', async () => {
    const user = userEvent.setup()
    const topic = {
      id: 'topic-1',
      name: 'Topic A',
      assistantId: 'assistant-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: []
    }
    mocks.dataApiGet.mockImplementation((path: string) => {
      if (path === '/topics/topic-1/path') {
        return Promise.resolve([{ id: 'message-1' }, { id: 'message-leaf' }])
      }
      return Promise.resolve(topic)
    })
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

    await user.type(screen.getByLabelText('Search topics, work, assistants, agents, and knowledge...'), 'needle')
    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    await user.click(await screen.findByRole('button', { name: 'Jump to message' }))

    expect(screen.queryByRole('complementary', { name: 'Message preview' })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(mocks.dataApiGet).toHaveBeenCalledWith('/topics/topic-1/path', { query: { nodeId: 'message-1' } })
      expect(mocks.dataApiPut).toHaveBeenCalledWith('/topics/topic-1/active-node', {
        body: { nodeId: 'message-leaf' }
      })
      expect(mocks.eventEmit).toHaveBeenCalledWith(
        'GLOBAL_SEARCH_SELECT_TOPIC_MESSAGE',
        expect.objectContaining({
          messageId: 'message-1',
          topic: expect.objectContaining({ activeNodeId: 'message-leaf', id: 'topic-1' })
        })
      )
    })
    expect(mocks.onClose).toHaveBeenCalledTimes(1)
  })

  it('locates the clicked preview message instead of the original search hit', async () => {
    const user = userEvent.setup()
    const topic = {
      id: 'topic-1',
      name: 'Topic A',
      assistantId: 'assistant-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: []
    }
    mocks.dataApiGet.mockImplementation((path: string) => {
      if (path === '/topics/topic-1/path') {
        return Promise.resolve([{ id: 'preview-message-other' }, { id: 'preview-message-leaf' }])
      }
      return Promise.resolve(topic)
    })
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

    await user.type(screen.getByLabelText('Search topics, work, assistants, agents, and knowledge...'), 'needle')
    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    await user.click(await screen.findByRole('option', { name: /needle topic reply/ }))
    await user.click(screen.getByRole('button', { name: 'Open preview other message' }))

    await waitFor(() => {
      expect(mocks.dataApiPut).toHaveBeenCalledWith('/topics/topic-1/active-node', {
        body: { nodeId: 'preview-message-leaf' }
      })
      expect(mocks.eventEmit).toHaveBeenCalledWith(
        'GLOBAL_SEARCH_SELECT_TOPIC_MESSAGE',
        expect.objectContaining({ messageId: 'preview-message-other' })
      )
    })
    expect(mocks.eventEmit).not.toHaveBeenCalledWith(
      'GLOBAL_SEARCH_SELECT_TOPIC_MESSAGE',
      expect.objectContaining({ messageId: 'message-1' })
    )
  })

  it('opens a session message preview before routing to the agent message', async () => {
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

    await user.type(screen.getByLabelText('Search topics, work, assistants, agents, and knowledge...'), 'needle')
    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    expect(await screen.findByText('Assistant role')).toBeInTheDocument()
    await user.click(await screen.findByRole('option', { name: /needle session reply/ }))

    const preview = screen.getByRole('complementary', { name: 'Message preview' })
    expect(preview).toBeInTheDocument()
    expect(within(preview).getByText('Session A')).toBeInTheDocument()
    expect(mocks.openTab).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Open preview target' }))

    await waitFor(() => {
      expect(mocks.dataApiGet).toHaveBeenCalledWith('/sessions/session-1')
      expect(mocks.invalidateCache).toHaveBeenCalledWith([
        '/sessions',
        '/sessions/session-1',
        '/sessions/session-1/messages'
      ])
      expect(mocks.cacheSet).toHaveBeenCalledWith('agent.active_session_id', 'session-1')
      expect(mocks.openTab).toHaveBeenCalledWith('/app/agents')
      expect(mocks.eventEmit).toHaveBeenCalledWith('GLOBAL_SEARCH_SELECT_AGENT_SESSION_MESSAGE', {
        sessionId: 'session-1',
        messageId: 'session-message-1'
      })
    })
    expect(mocks.dataApiGet.mock.invocationCallOrder[0]).toBeLessThan(mocks.invalidateCache.mock.invocationCallOrder[0])
    expect(mocks.invalidateCache.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.eventEmit.mock.invocationCallOrder.at(-1) ?? Number.MAX_SAFE_INTEGER
    )
    expect(mocks.onClose).toHaveBeenCalledTimes(1)
  })

  it('jumps directly from a session message search row action', async () => {
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

    await user.type(screen.getByLabelText('Search topics, work, assistants, agents, and knowledge...'), 'needle')
    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    await user.click(await screen.findByRole('button', { name: 'Jump to message' }))

    expect(screen.queryByRole('complementary', { name: 'Message preview' })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(mocks.dataApiGet).toHaveBeenCalledWith('/sessions/session-1')
      expect(mocks.invalidateCache).toHaveBeenCalledWith([
        '/sessions',
        '/sessions/session-1',
        '/sessions/session-1/messages'
      ])
      expect(mocks.cacheSet).toHaveBeenCalledWith('agent.active_session_id', 'session-1')
      expect(mocks.openTab).toHaveBeenCalledWith('/app/agents')
      expect(mocks.eventEmit).toHaveBeenCalledWith('GLOBAL_SEARCH_SELECT_AGENT_SESSION_MESSAGE', {
        sessionId: 'session-1',
        messageId: 'session-message-1'
      })
    })
    expect(mocks.onClose).toHaveBeenCalledTimes(1)
  })

  it('closes the message preview from the panel and when clearing search', async () => {
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

    await user.type(screen.getByLabelText('Search topics, work, assistants, agents, and knowledge...'), 'needle')
    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    await user.click(await screen.findByRole('option', { name: /needle session reply/ }))

    expect(screen.getByRole('complementary', { name: 'Message preview' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close preview' }))
    expect(screen.queryByRole('complementary', { name: 'Message preview' })).not.toBeInTheDocument()

    await user.click(await screen.findByRole('option', { name: /needle session reply/ }))
    expect(screen.getByRole('complementary', { name: 'Message preview' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.queryByRole('complementary', { name: 'Message preview' })).not.toBeInTheDocument()
  })

  it('opens the active message preview with Enter', async () => {
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

    const input = screen.getByLabelText('Search topics, work, assistants, agents, and knowledge...')
    await user.type(input, 'needle')
    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    await screen.findByRole('option', { name: /needle session reply/ })
    await user.click(input)
    await user.keyboard('{Enter}')

    expect(screen.getByRole('complementary', { name: 'Message preview' })).toBeInTheDocument()
    expect(mocks.eventEmit).not.toHaveBeenCalledWith('GLOBAL_SEARCH_SELECT_AGENT_SESSION', 'session-1')

    await user.click(screen.getByRole('button', { name: 'Open preview target' }))

    await waitFor(() => {
      expect(mocks.eventEmit).toHaveBeenCalledWith('GLOBAL_SEARCH_SELECT_AGENT_SESSION_MESSAGE', {
        sessionId: 'session-1',
        messageId: 'session-message-1'
      })
    })
    expect(mocks.onClose).toHaveBeenCalledTimes(1)
  })

  it('adds updatedAtFrom when a time filter is selected', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.type(screen.getByLabelText('Search topics, work, assistants, agents, and knowledge...'), 'plan')
    await user.click(screen.getByRole('button', { name: 'Updated time' }))
    expect(screen.getByRole('menuitem', { name: 'Last 7 days' }).parentElement).toHaveClass('z-[90]')
    await user.click(screen.getByRole('menuitem', { name: 'Last 7 days' }))

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

    await user.type(screen.getByLabelText('Search topics, work, assistants, agents, and knowledge...'), 'assistant')

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

    const input = screen.getByLabelText('Search topics, work, assistants, agents, and knowledge...')
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

    const input = screen.getByLabelText('Search topics, work, assistants, agents, and knowledge...')
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

    const input = screen.getByLabelText('Search topics, work, assistants, agents, and knowledge...')
    await user.type(input, 'docs')
    await screen.findByText('Docs')
    expect(screen.getAllByText('📚')).not.toHaveLength(0)
    await user.keyboard('{Enter}')

    expect(mocks.openTab).toHaveBeenCalledWith('/app/knowledge')
    await waitFor(() => {
      expect(mocks.eventEmit).toHaveBeenCalledWith('GLOBAL_SEARCH_SELECT_KNOWLEDGE_BASE', 'knowledge-1')
    })
    expect(mocks.onClose).toHaveBeenCalledTimes(1)
  })

  it('opens an app route from the default panel', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.click(screen.getByText('Knowledge'))

    expect(mocks.openTab).toHaveBeenCalledWith('/app/knowledge', {
      forceNew: true,
      title: 'Knowledge'
    })
    expect(mocks.onClose).toHaveBeenCalledTimes(1)
  })
})
