import { Button, Input, Kbd, KbdGroup } from '@cherrystudio/ui'
import { cacheService } from '@data/CacheService'
import { dataApiService } from '@data/DataApiService'
import { usePersistCache } from '@data/hooks/useCache'
import { useQuery } from '@data/hooks/useDataApi'
import { useMultiplePreferences } from '@data/hooks/usePreference'
import EmojiIcon from '@renderer/components/EmojiIcon'
import { GroupedVirtualList, type GroupedVirtualListGroup } from '@renderer/components/VirtualList'
import {
  buildSidebarIconManagerItems,
  getDefaultSidebarIconPreferences,
  getRequiredSidebarIconsVisible,
  getSidebarIconPreferencesFromVisibleIcons,
  getSidebarMenuPath,
  REQUIRED_SIDEBAR_ICONS,
  SIDEBAR_ICON_COMPONENTS
} from '@renderer/config/sidebar'
import { useSettings } from '@renderer/hooks/useSettings'
import { useTabs } from '@renderer/hooks/useTabs'
import { mapApiTopicToRendererTopic } from '@renderer/hooks/useTopic'
import { getSidebarIconLabel } from '@renderer/i18n/label'
import { buildLibraryEditSearch, buildLibraryRouteUrl } from '@renderer/pages/library/routeSearch'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { cn } from '@renderer/utils'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import type { GlobalSearchItem } from '@shared/data/api/schemas/globalSearch'
import type { SidebarIcon } from '@shared/data/preference/preferenceTypes'
import {
  Bot,
  ChevronDown,
  Clock3,
  CornerDownLeft,
  Eye,
  EyeOff,
  FileSearch,
  Funnel,
  MessageSquare,
  MousePointerClick,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  X
} from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  buildGlobalSearchGroups,
  getGlobalSearchTypes,
  type GlobalSearchFilter,
  type GlobalSearchGroupId,
  type GlobalSearchPanelGroup,
  type GlobalSearchPanelItem
} from './globalSearchGroups'

type GlobalSearchPanelProps = {
  onClose: () => void
}

type GlobalSearchPanelMode = 'search' | 'menu-manager'

const FILTERS: GlobalSearchFilter[] = ['all', 'conversation', 'assistant', 'agent', 'knowledge']
const FILTER_LABEL_KEYS: Record<GlobalSearchFilter, string> = {
  all: 'globalSearch.filters.all',
  conversation: 'globalSearch.filters.conversation',
  assistant: 'globalSearch.filters.assistant',
  agent: 'globalSearch.filters.agent',
  knowledge: 'globalSearch.filters.knowledge'
}
const SIDEBAR_ICON_PREFERENCE_KEYS = {
  visible: 'ui.sidebar.icons.visible',
  invisible: 'ui.sidebar.icons.invisible'
} as const

const RESULT_ICONS: Record<GlobalSearchItem['type'], typeof MessageSquare> = {
  topic: MessageSquare,
  session: MousePointerClick,
  assistant: Sparkles,
  agent: Bot,
  'knowledge-base': FileSearch
}

const RECENT_ICONS = {
  route: Clock3,
  topic: MessageSquare,
  session: MousePointerClick
} as const

function getGroupLabelKey(groupId: GlobalSearchGroupId) {
  return `globalSearch.groups.${groupId}`
}

function getResultTypeLabelKey(type: GlobalSearchItem['type']) {
  return type === 'knowledge-base' ? 'common.knowledge_base' : `globalSearch.resultTypes.${type}`
}

function getFilterLabelKey(filter: GlobalSearchFilter) {
  return FILTER_LABEL_KEYS[filter]
}

function getResultSubtitle(result: GlobalSearchItem, t: (key: string) => string) {
  if (result.type === 'topic' || result.type === 'session') {
    return result.subtitle
  }

  return result.subtitle ?? t(getResultTypeLabelKey(result.type))
}

function getAssistantTargetId(target: GlobalSearchItem['target']) {
  return 'assistantId' in target && typeof target.assistantId === 'string' ? target.assistantId : undefined
}

function getAgentTargetId(target: GlobalSearchItem['target']) {
  return 'agentId' in target && typeof target.agentId === 'string' ? target.agentId : undefined
}

function getTopicTargetId(target: GlobalSearchItem['target']) {
  return 'topicId' in target && typeof target.topicId === 'string' ? target.topicId : undefined
}

function getSessionTargetId(target: GlobalSearchItem['target']) {
  return 'sessionId' in target && typeof target.sessionId === 'string' ? target.sessionId : undefined
}

function getKnowledgeBaseTargetId(target: GlobalSearchItem['target']) {
  return 'knowledgeBaseId' in target && typeof target.knowledgeBaseId === 'string' ? target.knowledgeBaseId : undefined
}

export function GlobalSearchPanel({ onClose }: GlobalSearchPanelProps) {
  const { t } = useTranslation()
  const { openTab } = useTabs()
  const { defaultPaintingProvider } = useSettings()
  const inputRef = useRef<HTMLInputElement>(null)
  const filterMenuRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [panelMode, setPanelMode] = useState<GlobalSearchPanelMode>('search')
  const deferredQuery = useDeferredValue(query.trim())
  const [filter, setFilter] = useState<GlobalSearchFilter>('all')
  const [filterMenuOpen, setFilterMenuOpen] = useState(false)
  const [activeItemId, setActiveItemId] = useState<string | undefined>()
  const [recentItems] = usePersistCache('ui.global_search.recent_items')
  const [sidebarIconPreferences, setSidebarIconPreferences] = useMultiplePreferences(SIDEBAR_ICON_PREFERENCE_KEYS)
  const visibleSidebarIcons = sidebarIconPreferences.visible
  const hasQuery = deferredQuery.length > 0
  const searchTypes = useMemo(() => getGlobalSearchTypes(filter), [filter])

  const { data, isLoading, error } = useQuery('/global-search', {
    enabled: hasQuery,
    query: {
      q: deferredQuery,
      types: searchTypes,
      limitPerType: 10
    }
  })

  const groups = useMemo(
    () =>
      buildGlobalSearchGroups({
        query: deferredQuery,
        filter,
        recentItems,
        response: data
      }),
    [data, deferredQuery, filter, recentItems]
  )

  const virtualGroups = useMemo<ReadonlyArray<GroupedVirtualListGroup<GlobalSearchPanelGroup, GlobalSearchPanelItem>>>(
    () =>
      groups.map((group) => ({
        group,
        header: group,
        items: group.items
      })),
    [groups]
  )

  const selectableItems = useMemo(() => groups.flatMap((group) => group.items), [groups])
  const shouldShowRecentHint =
    !hasQuery && !isLoading && !error && selectableItems.length > 0 && selectableItems.length < 3
  const sidebarPreferenceManagerIcons = useMemo(() => buildSidebarIconManagerItems(), [])
  const visibleSidebarIconSet = useMemo(
    () => new Set<SidebarIcon>(getRequiredSidebarIconsVisible(visibleSidebarIcons)),
    [visibleSidebarIcons]
  )
  const shortcutSidebarIcons = useMemo(
    () => sidebarPreferenceManagerIcons.filter((icon) => visibleSidebarIconSet.has(icon)),
    [sidebarPreferenceManagerIcons, visibleSidebarIconSet]
  )

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!filterMenuOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!filterMenuRef.current?.contains(event.target as Node)) {
        setFilterMenuOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFilterMenuOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [filterMenuOpen])

  useEffect(() => {
    if (selectableItems.length === 0) {
      setActiveItemId(undefined)
      return
    }

    setActiveItemId((current) =>
      current && selectableItems.some((item) => item.id === current) ? current : selectableItems[0].id
    )
  }, [selectableItems])

  const persistSidebarIconPreferences = useCallback(
    async ({ visible, invisible }: { visible: SidebarIcon[]; invisible: SidebarIcon[] }) => {
      try {
        await setSidebarIconPreferences({ visible, invisible })
      } catch {
        window.toast?.error(t('globalSearch.quickApps.save_failed'))
      }
    },
    [setSidebarIconPreferences, t]
  )

  const handleSidebarShortcutOpen = useCallback(
    (icon: SidebarIcon) => {
      const path = getSidebarMenuPath(icon, defaultPaintingProvider)
      if (!path) return

      openTab(path, { forceNew: true, title: getDefaultRouteTitle(path) })
      onClose()
    },
    [defaultPaintingProvider, onClose, openTab]
  )

  const handleSidebarManagerVisibilityChange = useCallback(
    (icon: SidebarIcon, nextVisible: boolean) => {
      const nextVisibleIcons = new Set(visibleSidebarIconSet)

      if (nextVisible) {
        nextVisibleIcons.add(icon)
      } else if (!REQUIRED_SIDEBAR_ICONS.includes(icon)) {
        nextVisibleIcons.delete(icon)
      }

      const preferences = getSidebarIconPreferencesFromVisibleIcons({
        visibleIcons: nextVisibleIcons
      })

      void persistSidebarIconPreferences(preferences)
    },
    [persistSidebarIconPreferences, visibleSidebarIconSet]
  )

  const handleSidebarManagerReset = useCallback(() => {
    const preferences = getDefaultSidebarIconPreferences()
    void persistSidebarIconPreferences(preferences)
  }, [persistSidebarIconPreferences])

  const handleQuickAppsManage = useCallback(() => {
    if (panelMode === 'menu-manager') {
      setPanelMode('search')
      return
    }

    setPanelMode('menu-manager')
  }, [panelMode])

  const openTopic = useCallback(
    async (topicId: string) => {
      const apiTopic = await dataApiService.get(`/topics/${topicId}`)
      const topic = mapApiTopicToRendererTopic(apiTopic)
      cacheService.set('topic.active', topic)
      openTab('/app/chat')
      window.setTimeout(() => {
        void EventEmitter.emit(EVENT_NAMES.GLOBAL_SEARCH_SELECT_TOPIC, topic)
      }, 0)
      onClose()
    },
    [onClose, openTab]
  )

  const openSession = useCallback(
    (sessionId: string) => {
      cacheService.set('agent.active_session_id', sessionId)
      openTab('/app/agents')
      window.setTimeout(() => {
        void EventEmitter.emit(EVENT_NAMES.GLOBAL_SEARCH_SELECT_AGENT_SESSION, sessionId)
      }, 0)
      onClose()
    },
    [onClose, openTab]
  )

  const openKnowledgeBase = useCallback(
    (knowledgeBaseId: string) => {
      openTab('/app/knowledge')
      window.setTimeout(() => {
        void EventEmitter.emit(EVENT_NAMES.GLOBAL_SEARCH_SELECT_KNOWLEDGE_BASE, knowledgeBaseId)
      }, 0)
      onClose()
    },
    [onClose, openTab]
  )

  const openPanelItem = useCallback(
    async (item: GlobalSearchPanelItem) => {
      try {
        if (item.kind === 'recent') {
          switch (item.recent.kind) {
            case 'route':
              openTab(item.recent.url, { title: item.recent.title, icon: item.recent.icon })
              onClose()
              return
            case 'topic':
              await openTopic(item.recent.topicId)
              return
            case 'session':
              openSession(item.recent.sessionId)
              return
          }
        }

        const result = item.result

        switch (result.type) {
          case 'assistant': {
            const assistantId = getAssistantTargetId(result.target)
            if (!assistantId) return
            openTab(buildLibraryRouteUrl(buildLibraryEditSearch('assistant', assistantId)), { forceNew: true })
            onClose()
            return
          }
          case 'agent': {
            const agentId = getAgentTargetId(result.target)
            if (!agentId) return
            openTab(buildLibraryRouteUrl(buildLibraryEditSearch('agent', agentId)), { forceNew: true })
            onClose()
            return
          }
          case 'topic': {
            const topicId = getTopicTargetId(result.target)
            if (!topicId) return
            await openTopic(topicId)
            return
          }
          case 'session': {
            const sessionId = getSessionTargetId(result.target)
            if (!sessionId) return
            openSession(sessionId)
            return
          }
          case 'knowledge-base': {
            const knowledgeBaseId = getKnowledgeBaseTargetId(result.target)
            if (!knowledgeBaseId) return
            openKnowledgeBase(knowledgeBaseId)
            return
          }
          default:
            return
        }
      } catch {
        window.toast?.error(t('globalSearch.open_failed'))
      }
    },
    [onClose, openKnowledgeBase, openSession, openTab, openTopic, t]
  )

  const moveActiveItem = useCallback(
    (direction: 1 | -1) => {
      if (selectableItems.length === 0) return

      const currentIndex = Math.max(
        0,
        selectableItems.findIndex((item) => item.id === activeItemId)
      )
      const nextIndex = (currentIndex + direction + selectableItems.length) % selectableItems.length
      setActiveItemId(selectableItems[nextIndex].id)
    },
    [activeItemId, selectableItems]
  )

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (panelMode === 'menu-manager') {
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        moveActiveItem(1)
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        moveActiveItem(-1)
        return
      }

      if (event.key === 'Enter') {
        const item = selectableItems.find((candidate) => candidate.id === activeItemId)
        if (!item) return
        event.preventDefault()
        void openPanelItem(item)
      }
    },
    [activeItemId, moveActiveItem, onClose, openPanelItem, panelMode, selectableItems]
  )

  const handleFilterSelect = useCallback((nextFilter: GlobalSearchFilter) => {
    setFilter(nextFilter)
    setFilterMenuOpen(false)
  }, [])

  const showEmptyState = !isLoading && !error && selectableItems.length === 0

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 px-5 pt-4 pb-0">
        <div className="relative">
          <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-4 size-5 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value.trimStart())
              setPanelMode('search')
            }}
            onKeyDown={handleInputKeyDown}
            placeholder={t('globalSearch.placeholder')}
            aria-label={t('globalSearch.placeholder')}
            spellCheck={false}
            className="h-11 rounded-[22px] border-border-subtle bg-muted/20 pr-11 pl-12 text-[15px] shadow-none placeholder:text-muted-foreground focus-visible:ring-1"
          />
          {query && (
            <button
              type="button"
              aria-label={t('globalSearch.clear')}
              onClick={() => {
                setQuery('')
                setPanelMode('search')
              }}
              className="-translate-y-1/2 absolute top-1/2 right-3 flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              <X className="size-4" />
            </button>
          )}
        </div>

        <GlobalSearchQuickAppsBar
          active={panelMode === 'menu-manager'}
          icons={shortcutSidebarIcons}
          onManage={handleQuickAppsManage}
          onOpen={handleSidebarShortcutOpen}
        />

        <div ref={filterMenuRef} className="relative flex h-8 items-center">
          <Button
            type="button"
            variant="ghost"
            className="h-7 gap-1.5 rounded-[8px] px-2 font-medium text-muted-foreground text-xs hover:bg-muted/50 hover:text-foreground"
            aria-expanded={filterMenuOpen}
            aria-haspopup="menu"
            aria-label={t('globalSearch.filters.label')}
            onClick={() => setFilterMenuOpen((open) => !open)}>
            <Funnel className="size-3.5" />
            <span>{t(getFilterLabelKey(filter))}</span>
            <ChevronDown className="size-3.5" />
          </Button>
          {filterMenuOpen && (
            <div className="absolute top-8 left-0 z-20 min-w-[112px] rounded-[10px] border border-border bg-popover p-1 text-popover-foreground shadow-lg">
              {FILTERS.map((filterOption) => {
                const isSelected = filter === filterOption
                return (
                  <button
                    key={filterOption}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => handleFilterSelect(filterOption)}
                    className={cn(
                      'flex h-8 w-full items-center rounded-[7px] px-2 text-left font-medium text-xs transition-colors hover:bg-accent',
                      isSelected ? 'text-foreground' : 'text-muted-foreground'
                    )}>
                    {t(getFilterLabelKey(filterOption))}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 border-border-subtle border-t">
        {panelMode === 'menu-manager' ? (
          <GlobalSearchQuickAppManager
            icons={sidebarPreferenceManagerIcons}
            visibleIcons={visibleSidebarIconSet}
            onReset={handleSidebarManagerReset}
            onVisibilityChange={handleSidebarManagerVisibilityChange}
          />
        ) : isLoading && hasQuery ? (
          <GlobalSearchState label={t('common.loading')} />
        ) : error ? (
          <GlobalSearchState label={t('globalSearch.error')} />
        ) : showEmptyState ? (
          <GlobalSearchState label={hasQuery ? t('common.no_results') : t('globalSearch.recent_hint')} />
        ) : (
          <div className="relative h-full">
            <GroupedVirtualList
              role="listbox"
              groups={virtualGroups}
              estimateGroupHeaderSize={() => 28}
              estimateItemSize={() => 52}
              className="pt-1 pb-2"
              renderGroupHeader={(group) => <GlobalSearchGroupHeader group={group} />}
              renderItem={(item) => (
                <GlobalSearchRow
                  item={item}
                  active={item.id === activeItemId}
                  onMouseEnter={() => setActiveItemId(item.id)}
                  onOpen={() => void openPanelItem(item)}
                />
              )}
            />
            {shouldShowRecentHint && (
              <GlobalSearchRecentHint
                label={t('globalSearch.recent_hint')}
                offset={4 + 28 + selectableItems.length * 52 + 8}
              />
            )}
          </div>
        )}
      </div>

      <div className="flex h-10 shrink-0 items-center gap-4 border-border-subtle border-t bg-background/95 px-5 text-muted-foreground text-xs">
        <KbdGroup>
          <Kbd className="bg-muted text-muted-foreground shadow-none">↑↓</Kbd>
          <span>{t('globalSearch.keyboard.select')}</span>
        </KbdGroup>
        <KbdGroup>
          <Kbd className="bg-muted text-muted-foreground shadow-none">
            <CornerDownLeft className="size-3" />
          </Kbd>
          <span>{t('common.open')}</span>
        </KbdGroup>
        <KbdGroup>
          <Kbd className="bg-muted text-muted-foreground shadow-none">ESC</Kbd>
          <span>{t('common.close')}</span>
        </KbdGroup>
      </div>
    </div>
  )
}

type GlobalSearchQuickAppManagerItem = {
  icon: SidebarIcon
  label: string
  visible: boolean
}

function GlobalSearchQuickAppsBar({
  active,
  icons,
  onManage,
  onOpen
}: {
  active: boolean
  icons: SidebarIcon[]
  onManage: () => void
  onOpen: (icon: SidebarIcon) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="mt-3 pb-2">
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {icons.map((icon) => {
          const Icon = SIDEBAR_ICON_COMPONENTS[icon]
          const label = getSidebarIconLabel(icon)

          return (
            <Button
              key={icon}
              type="button"
              variant="ghost"
              aria-label={label}
              onClick={() => onOpen(icon)}
              className="flex h-[66px] w-[68px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-[12px] px-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground">
              <span className="flex size-9 items-center justify-center rounded-[10px] bg-muted/60 text-muted-foreground">
                <Icon className="size-5" />
              </span>
              <span className="w-full truncate text-center font-medium text-xs">{label}</span>
            </Button>
          )
        })}
        <Button
          type="button"
          variant="ghost"
          aria-pressed={active}
          onClick={onManage}
          className={cn(
            'flex h-[66px] w-[68px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-[12px] px-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground',
            active && 'bg-muted/60 text-foreground'
          )}>
          <span
            className={cn(
              'flex size-9 items-center justify-center rounded-[10px] bg-muted/60 text-muted-foreground',
              active && 'bg-background text-foreground'
            )}>
            <Settings className="size-5" />
          </span>
          <span className="w-full truncate text-center font-medium text-xs">{t('globalSearch.quickApps.manage')}</span>
        </Button>
      </div>
    </div>
  )
}

function GlobalSearchQuickAppManager({
  icons,
  onReset,
  onVisibilityChange,
  visibleIcons
}: {
  icons: SidebarIcon[]
  visibleIcons: ReadonlySet<SidebarIcon>
  onReset: () => void
  onVisibilityChange: (icon: SidebarIcon, visible: boolean) => void
}) {
  const { t } = useTranslation()
  const items = useMemo<GlobalSearchQuickAppManagerItem[]>(
    () =>
      icons.map((icon) => ({
        icon,
        label: getSidebarIconLabel(icon),
        visible: visibleIcons.has(icon)
      })),
    [icons, visibleIcons]
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-3">
        <div className="min-w-0">
          <div className="font-medium text-foreground text-sm">{t('globalSearch.quickApps.manager_title')}</div>
          <div className="truncate text-muted-foreground text-xs">
            {t('globalSearch.quickApps.manager_description')}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          onClick={onReset}
          className="h-8 shrink-0 gap-1.5 rounded-[8px] px-2 text-muted-foreground text-xs hover:bg-muted/50 hover:text-foreground">
          <RotateCcw className="size-3.5" />
          <span>{t('globalSearch.quickApps.reset')}</span>
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
        <div className="flex w-full flex-col gap-1" data-testid="quick-app-manager-list">
          {items.map((item) => (
            <GlobalSearchQuickAppManagerRow key={item.icon} item={item} onVisibilityChange={onVisibilityChange} />
          ))}
        </div>
      </div>
    </div>
  )
}

function GlobalSearchQuickAppManagerRow({
  item,
  onVisibilityChange
}: {
  item: GlobalSearchQuickAppManagerItem
  onVisibilityChange: (icon: SidebarIcon, visible: boolean) => void
}) {
  const { t } = useTranslation()
  const Icon = SIDEBAR_ICON_COMPONENTS[item.icon]
  const isRequired = REQUIRED_SIDEBAR_ICONS.includes(item.icon)
  const nextVisible = !item.visible

  return (
    <div
      className={cn(
        'flex h-[56px] items-center gap-3 rounded-[12px] px-3 transition-colors',
        'hover:bg-muted/40',
        item.visible ? 'text-foreground' : 'text-muted-foreground opacity-60'
      )}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1 truncate font-medium text-sm">{item.label}</span>
      <Button
        type="button"
        variant="ghost"
        disabled={isRequired}
        aria-label={t(item.visible ? 'globalSearch.quickApps.hide' : 'globalSearch.quickApps.show', {
          name: item.label
        })}
        aria-pressed={item.visible}
        onClick={() => onVisibilityChange(item.icon, nextVisible)}
        className="size-8 shrink-0 rounded-[8px] p-0 text-muted-foreground hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40">
        {item.visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
      </Button>
    </div>
  )
}

function GlobalSearchGroupHeader({ group }: { group: GlobalSearchPanelGroup }) {
  const { t } = useTranslation()

  return (
    <div className="flex h-7 items-center gap-1.5 px-5 pt-1 font-medium text-muted-foreground text-sm">
      <span>{t(getGroupLabelKey(group.id))}</span>
      <span>·</span>
      <span>{group.items.length}</span>
    </div>
  )
}

function GlobalSearchRow({
  item,
  active,
  onMouseEnter,
  onOpen
}: {
  item: GlobalSearchPanelItem
  active: boolean
  onMouseEnter: () => void
  onOpen: () => void
}) {
  const { t } = useTranslation()
  const isRecent = item.kind === 'recent'
  const title = isRecent ? item.recent.title : item.result.title
  const subtitle = isRecent ? undefined : getResultSubtitle(item.result, t)
  const Icon = isRecent ? RECENT_ICONS[item.recent.kind] : RESULT_ICONS[item.result.type]
  const emoji =
    !isRecent && ['assistant', 'agent', 'knowledge-base'].includes(item.result.type) ? item.result.emoji : undefined

  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onMouseEnter={onMouseEnter}
      onClick={onOpen}
      className={cn(
        'mx-5 flex h-[48px] w-[calc(100%-2.5rem)] items-center gap-2.5 rounded-[12px] px-3 text-left transition-colors',
        active ? 'bg-muted/60 text-accent-foreground' : 'hover:bg-muted/40'
      )}>
      {emoji ? (
        <EmojiIcon emoji={emoji} size={32} fontSize={15} className="mr-0 bg-muted/50" />
      ) : (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted/50 text-muted-foreground">
          <Icon className="size-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground text-sm leading-5">
          {title || t('common.unnamed')}
        </span>
        {subtitle && <span className="block truncate text-muted-foreground text-xs leading-4">{subtitle}</span>}
      </span>
    </button>
  )
}

function GlobalSearchRecentHint({ label, offset }: { label: string; offset: number }) {
  return (
    <div className="pointer-events-none absolute right-5 left-5 text-muted-foreground text-sm" style={{ top: offset }}>
      {label}
    </div>
  )
}

function GlobalSearchState({ label }: { label: string }) {
  return <div className="flex h-full items-center justify-center text-muted-foreground text-sm">{label}</div>
}
