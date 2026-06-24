// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type {
  EntitySearchResponse,
  SessionMessageContentSearchItem,
  TopicMessageContentSearchItem
} from '@shared/data/api/schemas/search'
import type { GlobalSearchRecentEntry, Tab } from '@shared/data/cache/cacheValueTypes'
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
  queryResult: undefined as EntitySearchResponse | undefined,
  messageQueryResult: undefined as { items: TopicMessageContentSearchItem[]; nextCursor?: string } | undefined,
  sessionMessageQueryResult: undefined as { items: SessionMessageContentSearchItem[]; nextCursor?: string } | undefined,
  keepStaleContentSearchData: false,
  recentItems: [] as GlobalSearchRecentEntry[],
  pinnedMiniApps: [] as any[],
  openedMiniApps: [] as any[],
  tabs: [] as Tab[],
  preferenceValues: {
    'app.user.name': 'JD',
    'ui.sidebar.favorites': ['assistants', 'agents', 'translate']
  } as Record<string, unknown>,
  persistCacheValues: {
    'ui.chat.last_used_topic_id': undefined,
    'ui.agent.last_used_session_id': undefined
  } as Record<string, unknown>,
  sortableOnSortEnd: undefined as undefined | ((event: { oldIndex: number; newIndex: number }) => void),
  setPreferences: vi.fn(),
  setActiveTab: vi.fn(),
  cacheSet: vi.fn(),
  setOpenedKeepAliveMiniApps: vi.fn(),
  updateMiniAppStatus: vi.fn(),
  removeCustomMiniApp: vi.fn(),
  dataApiGet: vi.fn(),
  dataApiPut: vi.fn(),
  invalidateCache: vi.fn(),
  eventEmit: vi.fn(),
  virtualListScrollToIndex: vi.fn(),
  loggerError: vi.fn(),
  toastError: vi.fn(),
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
  const DropdownMenuRadioContext = React.createContext<{
    value?: string
    onValueChange?: (value: string) => void
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
    DropdownMenuRadioGroup: ({
      children,
      value,
      onValueChange
    }: React.ComponentProps<'div'> & {
      value?: string
      onValueChange?: (value: string) => void
    }) => (
      <DropdownMenuRadioContext value={{ value, onValueChange }}>
        <div role="group">{children}</div>
      </DropdownMenuRadioContext>
    ),
    DropdownMenuRadioItem: ({
      children,
      value,
      ...props
    }: React.ComponentProps<'button'> & {
      value: string
    }) => {
      const menuContext = React.use(DropdownMenuContext)
      const radioContext = React.use(DropdownMenuRadioContext)
      const checked = radioContext?.value === value

      return (
        <button
          type="button"
          role="menuitemradio"
          aria-checked={checked}
          data-state={checked ? 'checked' : 'unchecked'}
          onClick={() => {
            radioContext?.onValueChange?.(value)
            menuContext?.setOpen(false)
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

vi.mock('@renderer/components/resource/dialogs', () => ({
  ResourceEditDialogHost: ({ target }: { target: { kind: string; id: string } | null }) =>
    target ? <div data-testid="resource-edit-dialog-host" data-kind={target.kind} data-id={target.id} /> : null
}))

vi.mock('@renderer/components/Icons/SvgIcon', () => ({
  OpenClawIcon: (props: React.ComponentProps<'svg'>) => <svg aria-hidden="true" {...props} />,
  OpenClawSidebarIcon: (props: React.ComponentProps<'svg'>) => <svg aria-hidden="true" {...props} />
}))

vi.mock('@renderer/components/Icons/MiniAppIcon', () => ({
  default: ({ app }: any) => <span aria-hidden="true">{app.logo ?? 'mini-app-icon'}</span>
}))

vi.mock('@renderer/features/command', () => ({
  CommandContextMenu: ({ children }: any) => children
}))

vi.mock('@renderer/components/VirtualList', async () => {
  const React = await vi.importActual<ReactModule>('react')

  return {
    GroupedVirtualList: ({
      ref,
      groups,
      renderGroupHeader,
      renderItem,
      renderGroupFooter,
      role = 'region',
      scrollerProps
    }: any) => {
      React.useImperativeHandle(ref, () => ({
        getTotalSize: () => 0,
        getVirtualIndexes: () => [],
        getVirtualItems: () => [],
        measure: () => undefined,
        resizeItem: () => undefined,
        scrollElement: () => null,
        scrollToIndex: mocks.virtualListScrollToIndex,
        scrollToOffset: () => undefined
      }))

      return (
        <div {...scrollerProps} role={role}>
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
    }
  }
})

vi.mock('@data/hooks/useCache', () => ({
  usePersistCache: (key: string) => [
    key === 'ui.global_search.recent_items' ? mocks.recentItems : mocks.persistCacheValues[key],
    vi.fn()
  ]
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useInvalidateCache: () => mocks.invalidateCache,
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
  useTabs: () => ({
    activeTab: mocks.activeTab,
    openTab: mocks.openTab,
    setActiveTab: mocks.setActiveTab,
    tabs: mocks.tabs,
    updateTab: mocks.updateTab
  })
}))

// Instance navigation goes through the conversation-nav boundary; route it to the same
// openTab spy so the existing focus-or-open assertions keep verifying the target url.
vi.mock('@renderer/hooks/useConversationNavigation', () => ({
  useConversationNavigator: () => ({
    focusExistingTab: () => false,
    openConversationTab: (appId: string, key: string, title?: string) => {
      const routePrefix = appId === 'agents' ? '/app/agents' : '/app/chat'
      const instanceAppId = appId === 'agents' ? 'agents' : 'assistants'
      return mocks.openTab(routePrefix, {
        forceNew: true,
        ...(title ? { title } : {}),
        metadata: { instanceAppId, instanceKey: key }
      })
    }
  }),
  useConversationNavigation: (appId: string) => {
    const routePrefix = appId === 'agents' ? '/app/agents' : '/app/chat'
    const instanceAppId = appId === 'agents' ? 'agents' : 'assistants'
    return {
      focusExistingTab: () => false,
      openConversationTab: (key: string, title?: string) =>
        mocks.openTab(routePrefix, {
          forceNew: true,
          ...(title ? { title } : {}),
          metadata: { instanceAppId, instanceKey: key }
        })
    }
  }
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({ defaultPaintingProvider: 'zhipu' })
}))

vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({
    miniApps: [...mocks.pinnedMiniApps, ...mocks.openedMiniApps],
    openedKeepAliveMiniApps: mocks.openedMiniApps,
    pinned: mocks.pinnedMiniApps,
    currentMiniAppId: '',
    miniAppShow: false,
    setOpenedKeepAliveMiniApps: mocks.setOpenedKeepAliveMiniApps,
    updateAppStatus: mocks.updateMiniAppStatus,
    removeCustomMiniApp: mocks.removeCustomMiniApp
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

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: mocks.loggerError
    })
  }
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
  getSidebarIconLabelKey: (key: string) =>
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
          'globalSearch.placeholder': 'Search conversations, tasks, assistants, agents, and knowledge...',
          'globalSearch.clear': 'Clear search',
          'globalSearch.filters.label': 'Search type',
          'globalSearch.filters.all': 'All',
          'globalSearch.filters.conversation': 'Conversation',
          'globalSearch.filters.topic': 'Conversation',
          'globalSearch.filters.session': 'Task',
          'globalSearch.filters.assistant': 'Assistant',
          'globalSearch.filters.agent': 'Agent',
          'globalSearch.filters.knowledge': 'Knowledge',
          'globalSearch.groups.recent': 'Recent',
          'globalSearch.groups.assistant': 'Assistant',
          'globalSearch.groups.conversation': 'Conversation',
          'globalSearch.groups.message': 'Messages',
          'globalSearch.groups.topic': 'Conversation',
          'globalSearch.groups.session': 'Task',
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
          'globalSearch.messageSearch.sources.session': 'Task messages',
          'globalSearch.messageSearch.sources.topic': 'Conversation messages',
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
          'globalSearch.recent_hint': 'Type to search conversations, tasks, assistants, agents, and knowledge',
          'globalSearch.error': 'Search failed',
          'globalSearch.open_failed': 'Failed to open search result',
          'globalSearch.resultTypes.assistant': 'Assistant',
          'globalSearch.resultTypes.session': 'Task',
          'globalSearch.resultTypes.topic': 'Conversation',
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
          'common.status.done': 'Done',
          'common.back': 'Back',
          'common.unnamed': 'Unnamed'
        }[key] ?? key

      return label.replace('{{name}}', options?.name ?? 'Agent').replace('{{count}}', options?.count ?? '0')
    },
    i18n: { language: 'en-US' }
  })
}))

import { GlobalSearchPanel } from '../GlobalSearchPanel'
import { getGlobalSearchOptionDomId, GLOBAL_MESSAGE_SEARCH_LOAD_MORE_ITEM_ID } from '../useGlobalSearchKeyboard'

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
    mocks.tabs = []
    mocks.queryResult = undefined
    mocks.messageQueryResult = undefined
    mocks.sessionMessageQueryResult = undefined
    mocks.preferenceValues = {
      'app.user.name': 'JD',
      'ui.sidebar.favorites': ['assistants', 'agents', 'translate']
    }
    mocks.persistCacheValues = {
      'ui.chat.last_used_topic_id': undefined,
      'ui.agent.last_used_session_id': undefined
    }
    mocks.sortableOnSortEnd = undefined
    mocks.activeTab = {
      id: 'chat',
      type: 'route',
      url: '/app/chat',
      title: 'Chat'
    }
    mocks.keepStaleContentSearchData = false
    window.toast = { error: mocks.toastError } as unknown as typeof window.toast
    mocks.useQuery.mockImplementation(
      (
        path: string,
        options?: {
          query?: { q?: string; sources?: string[] }
          swrOptions?: { keepPreviousData?: boolean }
        }
      ) => {
        if (path === '/search/entities') {
          return {
            data: mocks.queryResult,
            isLoading: false,
            isRefreshing: false,
            error: undefined
          }
        }

        if (path === '/search/contents') {
          const sources = options?.query?.sources ?? ['topic-message', 'session-message']
          const effectiveSources =
            mocks.keepStaleContentSearchData && options?.swrOptions?.keepPreviousData !== false
              ? ['topic-message', 'session-message']
              : sources
          const groups = [
            ...(effectiveSources.includes('topic-message') && mocks.messageQueryResult
              ? [
                  {
                    sourceType: 'topic-message' as const,
                    items: mocks.messageQueryResult.items,
                    nextCursor: mocks.messageQueryResult.nextCursor
                  }
                ]
              : []),
            ...(effectiveSources.includes('session-message') && mocks.sessionMessageQueryResult
              ? [
                  {
                    sourceType: 'session-message' as const,
                    items: mocks.sessionMessageQueryResult.items,
                    nextCursor: mocks.sessionMessageQueryResult.nextCursor
                  }
                ]
              : [])
          ]

          return {
            data: {
              query: options?.query?.q ?? '',
              groups
            },
            isLoading: false,
            isRefreshing: false,
            error: undefined
          }
        }

        return {
          data: undefined,
          isLoading: false,
          isRefreshing: false,
          error: undefined
        }
      }
    )
  })

  it('autofocuses the search input when opened', async () => {
    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await waitFor(() => {
      expect(screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...')).toHaveFocus()
    })
  })

  it('links the search input to the visible recent listbox', async () => {
    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    const searchInput = screen.getByRole('combobox', {
      name: 'Search conversations, tasks, assistants, agents, and knowledge...'
    })
    const listbox = screen.getByRole('listbox')
    const recentOption = screen.getByRole('option', { name: /Topic recent/ })

    await waitFor(() => {
      expect(searchInput).toHaveAttribute('aria-expanded', 'true')
      expect(searchInput).toHaveAttribute('aria-controls', listbox.id)
      expect(searchInput).toHaveAttribute('aria-activedescendant', recentOption.id)
      expect(recentOption).toHaveAttribute('id', getGlobalSearchOptionDomId('topic:topic-1'))
    })
  })

  it('renders recent results before search and search results after typing', async () => {
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

    expect(screen.queryByRole('heading', { name: 'Apps' })).not.toBeInTheDocument()
    expect(screen.getByText('Topic recent')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Manage' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Search type: Conversation' })).not.toBeInTheDocument()

    await user.type(
      screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...'),
      'assistant'
    )

    await waitFor(() => {
      const searchInput = screen.getByRole('combobox', {
        name: 'Search conversations, tasks, assistants, agents, and knowledge...'
      })
      const listbox = screen.getByRole('listbox')
      const resultOption = screen.getByRole('option', { name: /Writing Assistant/ })

      expect(screen.queryByRole('heading', { name: 'Apps' })).not.toBeInTheDocument()
      expect(resultOption).toBeInTheDocument()
      expect(screen.getByText('2 minutes ago')).toBeInTheDocument()
      expect(screen.getAllByText('🧪')).not.toHaveLength(0)
      expect(searchInput).toHaveAttribute('aria-expanded', 'true')
      expect(searchInput).toHaveAttribute('aria-controls', listbox.id)
      expect(searchInput).toHaveAttribute('aria-activedescendant', resultOption.id)
    })

    expect(mocks.useQuery).toHaveBeenLastCalledWith(
      '/search/entities',
      expect.objectContaining({
        enabled: true,
        query: expect.objectContaining({
          q: 'assistant',
          types: ['topic', 'session', 'assistant', 'agent', 'knowledge-base']
        })
      })
    )
  })

  it('scrolls the visible virtual list when keyboard selection moves', async () => {
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
            },
            {
              type: 'assistant',
              id: 'assistant-2',
              title: 'Review Assistant',
              target: { assistantId: 'assistant-2' }
            }
          ]
        }
      ]
    }

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    const input = screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...')
    await user.type(input, 'assistant')
    const secondOption = await screen.findByRole('option', { name: /Review Assistant/ })

    await waitFor(() => {
      expect(input).toHaveAttribute('aria-activedescendant', getGlobalSearchOptionDomId('assistant:assistant-1'))
    })

    mocks.virtualListScrollToIndex.mockClear()
    await user.keyboard('{ArrowDown}')

    await waitFor(() => {
      expect(input).toHaveAttribute('aria-activedescendant', secondOption.id)
      expect(mocks.virtualListScrollToIndex).toHaveBeenLastCalledWith(2, { align: 'auto' })
    })
  })

  it('wraps keyboard selection upward to the final footer row and scrolls it into view', async () => {
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
        }
      ]
    }

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    const input = screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...')
    await user.type(input, 'plan')
    const firstOption = await screen.findByRole('option', { name: /Topic 0/ })
    const footerOption = await screen.findByRole('option', { name: 'Show 1 more' })
    fireEvent.mouseEnter(firstOption)

    await waitFor(() => {
      expect(input).toHaveAttribute('aria-activedescendant', getGlobalSearchOptionDomId('topic:topic-0'))
    })

    mocks.virtualListScrollToIndex.mockClear()
    await user.keyboard('{ArrowUp}')

    await waitFor(() => {
      expect(input).toHaveAttribute('aria-activedescendant', footerOption.id)
      expect(mocks.virtualListScrollToIndex).toHaveBeenLastCalledWith(6, { align: 'auto' })
    })
  })

  it('does not render quick app shortcuts after typing', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)
    await user.type(screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...'), 'query')

    expect(screen.queryByText('Quick apps')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Chat' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Agent' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Manage' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search type: Conversation' })).toBeInTheDocument()
  })

  it('updates query types when the topic filter is selected', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.type(screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...'), 'plan')
    await user.click(screen.getByRole('button', { name: 'Search type: Conversation' }))

    await waitFor(() => {
      expect(mocks.useQuery).toHaveBeenLastCalledWith(
        '/search/entities',
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

    await user.type(screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...'), 'plan')
    await user.click(screen.getByRole('button', { name: 'Search type: Task' }))

    await waitFor(() => {
      expect(mocks.useQuery).toHaveBeenLastCalledWith(
        '/search/entities',
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

    await user.type(screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...'), 'plan')
    const topicFilter = screen.getByRole('button', { name: 'Search type: Conversation' })
    await user.click(topicFilter)
    expect(topicFilter).toHaveAttribute('aria-pressed', 'true')

    await user.click(topicFilter)
    expect(topicFilter).toHaveAttribute('aria-pressed', 'false')

    await waitFor(() => {
      expect(mocks.useQuery).toHaveBeenLastCalledWith(
        '/search/entities',
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

    await user.type(screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...'), 'docs')
    await user.click(screen.getByRole('button', { name: 'Search type: Knowledge' }))

    await waitFor(() => {
      expect(mocks.useQuery).toHaveBeenLastCalledWith(
        '/search/entities',
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

    await user.type(screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...'), 'plan')

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

    await user.type(
      screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...'),
      'needle'
    )

    expect(await screen.findByText('Topic A')).toBeInTheDocument()
    expect(screen.getByText('Conversation messages')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /needle message 5/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /needle message 1/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /needle message 0/ })).not.toBeInTheDocument()

    await waitFor(() => {
      expect(mocks.useQuery).toHaveBeenCalledWith(
        '/search/contents',
        expect.objectContaining({
          enabled: true,
          query: expect.objectContaining({
            q: 'needle',
            sources: ['topic-message', 'session-message'],
            limitPerSource: GLOBAL_SEARCH_MESSAGE_PREVIEW_LIMIT
          })
        })
      )
    })

    await user.click(screen.getByRole('option', { name: 'View more in Messages' }))

    expect(screen.getByRole('radio', { name: 'Messages' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: 'Message source: Conversation messages' })).toBeInTheDocument()
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

    await user.type(
      screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...'),
      'needle'
    )
    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    await user.click(screen.getByRole('button', { name: 'Message source: Conversation messages' }))
    await user.click(screen.getByRole('radio', { name: 'All' }))
    const searchInput = screen.getByRole('combobox', {
      name: 'Search conversations, tasks, assistants, agents, and knowledge...'
    })
    const messageOption = await screen.findByRole('option', { name: /needle target message/ })

    await waitFor(() => {
      expect(searchInput).toHaveAttribute('aria-expanded', 'true')
      expect(searchInput).toHaveAttribute('aria-controls', screen.getByRole('listbox').id)
      expect(searchInput).toHaveAttribute('aria-activedescendant', messageOption.id)
    })

    await user.click(messageOption)

    expect(await screen.findByLabelText('Message preview')).toBeInTheDocument()
    expect(screen.getByText('Topic A')).toBeInTheDocument()
    expect(searchInput).toHaveAttribute('aria-expanded', 'false')
    expect(searchInput).not.toHaveAttribute('aria-controls')
    expect(searchInput).not.toHaveAttribute('aria-activedescendant')
  })

  it('switches to message search mode without showing quick app shortcuts', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)
    await user.type(
      screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...'),
      'needle'
    )

    const messageSearchButton = screen.getByRole('radio', { name: 'Messages' })
    const filterButton = screen.getByRole('button', { name: 'Search type: Conversation' })

    expect(messageSearchButton.compareDocumentPosition(filterButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    await user.click(messageSearchButton)
    expect(screen.queryByRole('button', { name: 'Chat' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Manage' })).not.toBeInTheDocument()
    expect(messageSearchButton).toHaveAttribute('aria-checked', 'true')
    expect(
      messageSearchButton.compareDocumentPosition(
        screen.getByRole('button', { name: 'Message source: Conversation messages' })
      )
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(screen.queryByRole('button', { name: 'Match mode' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Created time: Any time' })).toBeInTheDocument()

    await waitFor(() => {
      expect(mocks.useQuery).toHaveBeenCalledWith(
        '/search/contents',
        expect.objectContaining({
          enabled: true,
          query: expect.objectContaining({
            q: 'needle',
            sources: ['topic-message', 'session-message'],
            limitPerSource: 50
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

    await user.type(
      screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...'),
      'needle'
    )
    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    await user.click(screen.getByRole('button', { name: 'Message source: Conversation messages' }))

    expect(await screen.findByRole('option', { name: /needle first page/ })).toBeInTheDocument()

    const input = screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...')
    const loadMoreOption = screen.getByRole('option', { name: 'Show 50 more' })

    expect(loadMoreOption).toHaveAttribute('id', getGlobalSearchOptionDomId(GLOBAL_MESSAGE_SEARCH_LOAD_MORE_ITEM_ID))
    expect(screen.getByRole('listbox')).toContainElement(loadMoreOption)

    await waitFor(() => {
      expect(input).toHaveAttribute('aria-activedescendant', getGlobalSearchOptionDomId('topic:topic-1:message-page-1'))
    })
    mocks.virtualListScrollToIndex.mockClear()
    input.focus()
    await user.keyboard('{ArrowUp}')

    await waitFor(() => {
      expect(input).toHaveAttribute('aria-activedescendant', loadMoreOption.id)
      expect(mocks.virtualListScrollToIndex).toHaveBeenLastCalledWith(2, { align: 'auto' })
    })
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(mocks.useQuery).toHaveBeenCalledWith(
        '/search/contents',
        expect.objectContaining({
          enabled: true,
          query: expect.objectContaining({
            q: 'needle',
            sources: ['topic-message'],
            cursors: { 'topic-message': 'cursor-1' }
          })
        })
      )
    })
  })

  it('passes selected time filter to message search queries', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.type(
      screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...'),
      'needle'
    )
    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    await user.click(screen.getByRole('button', { name: 'Created time: Any time' }))
    expect(screen.getByRole('menuitemradio', { name: 'Any time' })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('menuitemradio', { name: 'Last 7 days' }))

    await waitFor(() => {
      expect(mocks.useQuery).toHaveBeenCalledWith(
        '/search/contents',
        expect.objectContaining({
          enabled: true,
          query: expect.objectContaining({
            q: 'needle',
            createdAtFrom: expect.any(String),
            sources: ['topic-message', 'session-message']
          })
        })
      )
    })
  })

  it('switches back from message search to global search filters', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.type(
      screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...'),
      'assistant'
    )
    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    expect(screen.getByRole('button', { name: 'Message source: Conversation messages' })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'All' }))

    expect(screen.queryByRole('button', { name: 'Message source: Conversation messages' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Search type: All' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search type: Conversation' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search type: Task' })).toBeInTheDocument()

    await waitFor(() => {
      expect(mocks.useQuery).toHaveBeenCalledWith(
        '/search/entities',
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

    await user.type(
      screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...'),
      'report'
    )
    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    await user.click(screen.getByRole('button', { name: 'Message source: Task messages' }))

    await waitFor(() => {
      expect(mocks.useQuery).toHaveBeenCalledWith(
        '/search/contents',
        expect.objectContaining({
          enabled: true,
          query: expect.objectContaining({
            q: 'report',
            sources: ['session-message']
          })
        })
      )
    })
  })

  it('does not keep stale task results after filtering to conversation messages', async () => {
    const user = userEvent.setup()
    mocks.keepStaleContentSearchData = true
    mocks.messageQueryResult = {
      items: [
        {
          messageId: 'topic-message-1',
          topicId: 'topic-1',
          topicName: 'Topic A',
          topicCreatedAt: '2026-01-01T00:00:00.000Z',
          topicUpdatedAt: '2026-01-01T00:00:00.000Z',
          snippet: 'needle topic reply',
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      ]
    }
    mocks.sessionMessageQueryResult = {
      items: [
        {
          messageId: 'session-message-1',
          sessionId: 'session-1',
          sessionName: 'Session A',
          snippet: 'needle session reply',
          createdAt: '2026-01-01T00:00:01.000Z'
        }
      ]
    }

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.type(
      screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...'),
      'needle'
    )
    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    expect(await screen.findByRole('option', { name: /needle session reply/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Message source: Conversation messages' }))

    await waitFor(() => {
      expect(mocks.useQuery).toHaveBeenCalledWith(
        '/search/contents',
        expect.objectContaining({
          swrOptions: { keepPreviousData: false },
          query: expect.objectContaining({
            q: 'needle',
            sources: ['topic-message']
          })
        })
      )
      expect(screen.getByRole('option', { name: /needle topic reply/ })).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: /needle session reply/ })).not.toBeInTheDocument()
      expect(screen.queryByText('Session A')).not.toBeInTheDocument()
    })
  })

  it('clears the active message source filter when clicking it again', async () => {
    const user = userEvent.setup()

    render(<GlobalSearchPanel onClose={mocks.onClose} />)

    await user.type(
      screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...'),
      'report'
    )
    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    const sessionSourceFilter = screen.getByRole('button', { name: 'Message source: Task messages' })

    await user.click(sessionSourceFilter)
    expect(sessionSourceFilter).toHaveAttribute('aria-pressed', 'true')

    await user.click(sessionSourceFilter)
    expect(sessionSourceFilter).toHaveAttribute('aria-pressed', 'false')

    await waitFor(() => {
      expect(mocks.useQuery).toHaveBeenCalledWith(
        '/search/contents',
        expect.objectContaining({
          enabled: true,
          query: expect.objectContaining({
            q: 'report',
            sources: ['topic-message', 'session-message']
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

    await user.type(
      screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...'),
      'needle'
    )
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

    await user.type(
      screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...'),
      'needle'
    )
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
      expect(mocks.invalidateCache).toHaveBeenCalledWith(['/topics/topic-1/messages', '/topics/topic-1/tree'])
      expect(mocks.openTab).toHaveBeenCalledWith('/app/chat', {
        forceNew: true,
        metadata: { instanceAppId: 'assistants', instanceKey: 'topic-1' }
      })
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

    await user.type(
      screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...'),
      'needle'
    )
    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    const messageOption = await screen.findByRole('option', { name: /needle topic reply/ })
    expect(screen.queryByRole('button', { name: 'Jump to message' })).not.toBeInTheDocument()
    fireEvent.mouseEnter(messageOption)
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

    await user.type(
      screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...'),
      'needle'
    )
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

    await user.type(
      screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...'),
      'needle'
    )
    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    expect(await screen.findByText('Assistant role')).toBeInTheDocument()
    await user.click(await screen.findByRole('option', { name: /needle session reply/ }))

    const preview = screen.getByRole('complementary', { name: 'Message preview' })
    expect(preview).toBeInTheDocument()
    expect(within(preview).getByText('Session A')).toBeInTheDocument()
    expect(mocks.openTab).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Open preview target' }))

    await waitFor(() => {
      expect(mocks.dataApiGet).toHaveBeenCalledWith('/agent-sessions/session-1')
      expect(mocks.invalidateCache).toHaveBeenCalledWith([
        '/agent-sessions',
        '/agent-sessions/session-1',
        '/agent-sessions/session-1/messages'
      ])
      expect(mocks.openTab).toHaveBeenCalledWith('/app/agents', {
        forceNew: true,
        metadata: { instanceAppId: 'agents', instanceKey: 'session-1' }
      })
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

    await user.type(
      screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...'),
      'needle'
    )
    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    const messageOption = await screen.findByRole('option', { name: /needle session reply/ })
    fireEvent.mouseEnter(messageOption)
    await user.click(await screen.findByRole('button', { name: 'Jump to message' }))

    expect(screen.queryByRole('complementary', { name: 'Message preview' })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(mocks.dataApiGet).toHaveBeenCalledWith('/agent-sessions/session-1')
      expect(mocks.invalidateCache).toHaveBeenCalledWith([
        '/agent-sessions',
        '/agent-sessions/session-1',
        '/agent-sessions/session-1/messages'
      ])
      expect(mocks.openTab).toHaveBeenCalledWith('/app/agents', {
        forceNew: true,
        metadata: { instanceAppId: 'agents', instanceKey: 'session-1' }
      })
      expect(mocks.eventEmit).toHaveBeenCalledWith('GLOBAL_SEARCH_SELECT_AGENT_SESSION_MESSAGE', {
        sessionId: 'session-1',
        messageId: 'session-message-1'
      })
    })
    expect(mocks.onClose).toHaveBeenCalledTimes(1)
  })

  it('logs and toasts when opening a message result fails', async () => {
    const user = userEvent.setup()
    const openError = new Error('missing session')
    mocks.dataApiGet.mockRejectedValueOnce(openError)
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

    await user.type(
      screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...'),
      'needle'
    )
    await user.click(screen.getByRole('radio', { name: 'Messages' }))
    const messageOption = await screen.findByRole('option', { name: /needle session reply/ })
    fireEvent.mouseEnter(messageOption)
    await user.click(await screen.findByRole('button', { name: 'Jump to message' }))

    await waitFor(() => {
      expect(mocks.loggerError).toHaveBeenCalledWith('Failed to open global search result', openError, {
        sourceType: 'session',
        sessionId: 'session-1',
        messageId: 'session-message-1'
      })
      expect(mocks.toastError).toHaveBeenCalledWith('Failed to open search result')
    })
    expect(mocks.onClose).not.toHaveBeenCalled()
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

    await user.type(
      screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...'),
      'needle'
    )
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

    const input = screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...')
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

    await user.type(screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...'), 'plan')
    await user.click(screen.getByRole('button', { name: 'Updated time: Any time' }))
    expect(screen.getByRole('menuitemradio', { name: 'Last 7 days' }).parentElement?.parentElement).toHaveClass(
      'z-[90]'
    )
    await user.click(screen.getByRole('menuitemradio', { name: 'Last 7 days' }))

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

    await user.type(
      screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...'),
      'assistant'
    )

    const highlights = await screen.findAllByText('Assistant', { selector: 'mark' })
    expect(highlights).toHaveLength(2)
  })

  it('opens the active assistant result in the edit dialog with Enter', async () => {
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

    const input = screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...')
    await user.type(input, 'assistant')
    await screen.findByRole('option', { name: /Writing Assistant/ })
    await user.keyboard('{Enter}')

    expect(screen.getByTestId('resource-edit-dialog-host')).toHaveAttribute('data-kind', 'assistant')
    expect(screen.getByTestId('resource-edit-dialog-host')).toHaveAttribute('data-id', 'assistant-1')
    expect(mocks.openTab).not.toHaveBeenCalledWith(
      '/app/library?resourceType=assistant&action=edit&id=assistant-1',
      expect.anything()
    )
    expect(mocks.onClose).not.toHaveBeenCalled()
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

    const input = screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...')
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

    const input = screen.getByLabelText('Search conversations, tasks, assistants, agents, and knowledge...')
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
})
